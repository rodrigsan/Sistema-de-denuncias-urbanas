import { AppError } from '../utils/errors.js';

/**
 * Servicio de moderacion (Fase 5): bandeja FIFO con sugerencias,
 * aprobacion/rechazo atomicos bajo FOR UPDATE, candidatos a duplicado con
 * PostGIS, ciclo de vida de propuestas y grupos.
 *
 * Privacidad (decision D2): las vistas incluyen unicamente el alias del
 * ciudadano. Jamas: email_private, provider_subject, administrative_code.
 */
export function createModerationService({
  complaintsRepository,
  moderationRepository,
  mediaRepository,
  config,
}) {
  function ensureOutcome(outcome) {
    if (outcome?.notFound) {
      throw new AppError(404, 'COMPLAINT_NOT_FOUND', 'La denuncia no existe.');
    }
    if (outcome?.proposalNotFound) {
      throw new AppError(404, 'DUPLICATE_PROPOSAL_NOT_FOUND', 'La propuesta no existe.');
    }
    if (outcome?.conflict === 'COMPLAINT_NOT_REVIEWABLE') {
      throw new AppError(
        409,
        'COMPLAINT_NOT_REVIEWABLE',
        'La denuncia no esta pendiente de revision.'
      );
    }
    if (outcome?.conflict === 'DUPLICATE_PROPOSAL_EXISTS') {
      throw new AppError(
        409,
        'DUPLICATE_PROPOSAL_EXISTS',
        'Ya existe una propuesta de duplicado para ese par de denuncias.'
      );
    }
    if (outcome?.conflict === 'PROPOSAL_ALREADY_RESOLVED') {
      throw new AppError(
        409,
        'PROPOSAL_ALREADY_RESOLVED',
        'La propuesta ya fue resuelta.'
      );
    }
    if (outcome?.conflict === 'COMPLAINT_ALREADY_GROUPED') {
      throw new AppError(
        409,
        'COMPLAINT_ALREADY_GROUPED',
        'Una de las denuncias ya pertenece a un grupo abierto.'
      );
    }
    if (outcome?.conflict === 'SOLUTION_ALREADY_VERIFIED') {
      throw new AppError(409, 'SOLUTION_ALREADY_VERIFIED', 'La solucion ya fue verificada.');
    }
    if (outcome?.conflict === 'CITIZEN_ALREADY_SUSPENDED') {
      throw new AppError(
        409,
        'CITIZEN_ALREADY_SUSPENDED',
        'El ciudadano ya tiene una suspension activa.'
      );
    }
    if (outcome?.solutionNotFound) {
      throw new AppError(404, 'SOLUTION_NOT_FOUND', 'La solucion no existe.');
    }
    if (outcome?.validation) {
      throw new AppError(422, outcome.validation.code, outcome.validation.message);
    }
    return outcome;
  }

  function toModerationView(complaint, { alias, evidence, suggestedUnits, assignedUnit } = {}) {
    const view = {
      id: complaint.id,
      publicCode: complaint.publicCode,
      status: complaint.status,
      title: complaint.title,
      description: complaint.description,
      category: {
        id: complaint.categoryId,
        code: complaint.categoryCode,
        name: complaint.categoryName,
      },
      subcategory: {
        id: complaint.subcategoryId,
        code: complaint.subcategoryCode,
        name: complaint.subcategoryName,
      },
      location: { latitude: complaint.latitude, longitude: complaint.longitude },
      plusCode: complaint.plusCode,
      plusCodeSource: complaint.plusCodeSource,
      locationVerificationMethod: complaint.locationVerificationMethod,
      citizenAlias: alias ?? complaint.citizenAlias ?? null,
      evidence: evidence ?? [],
      formalizedAt: complaint.formalizedAt,
      createdAt: complaint.createdAt,
    };
    if (suggestedUnits) view.suggestedUnits = suggestedUnits;
    if (assignedUnit) view.assignedUnit = assignedUnit;
    return view;
  }

  // ---- Bandeja ----

  async function listInbox(query) {
    const { page, limit, categoryId, subcategoryId, formalizedFrom, formalizedTo } = query;
    const filters = { categoryId, subcategoryId, formalizedFrom, formalizedTo };
    const offset = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      moderationRepository.findPendingReviewComplaints({ filters, limit, offset }),
      moderationRepository.countPendingReviewComplaints({ filters }),
    ]);

    const complaintIds = rows.map((row) => row.id);
    const subcategoryIds = [...new Set(rows.map((row) => row.subcategoryId))];

    const [evidenceMap, suggestionRows] = await Promise.all([
      mediaRepository.listEvidenceByComplaintIds(complaintIds),
      subcategoryIds.length > 0
        ? moderationRepository.findSuggestedUnitsForSubcategories(subcategoryIds)
        : Promise.resolve([]),
    ]);

    const suggestionsBySubcategory = {};
    for (const row of suggestionRows) {
      const list = suggestionsBySubcategory[row.subcategoryId] ?? [];
      list.push({ id: row.id, code: row.code, name: row.name, priority: row.priority });
      suggestionsBySubcategory[row.subcategoryId] = list;
    }

    return {
      complaints: rows.map((row) =>
        toModerationView(row, {
          evidence: evidenceMap[row.id] ?? [],
          suggestedUnits: suggestionsBySubcategory[row.subcategoryId] ?? [],
        })
      ),
      pagination: { page, limit, total },
    };
  }

  // ---- Aprobacion / rechazo (atomicos, FOR UPDATE) ----

  async function approve(moderator, complaintId, body) {
    const outcome = await complaintsRepository.withComplaintLock(
      complaintId,
      async (complaint, client) => {
        if (!complaint) return { notFound: true };
        if (complaint.status !== 'PENDING_REVIEW') {
          return { conflict: 'COMPLAINT_NOT_REVIEWABLE' };
        }

        const unit = await moderationRepository.findActiveMunicipalUnitById(
          body.municipalUnitId,
          client
        );
        if (!unit) {
          return {
            validation: {
              code: 'INVALID_MUNICIPAL_UNIT',
              message: 'La unidad municipal no existe o esta inactiva.',
            },
          };
        }

        await moderationRepository.insertModerationReview(client, {
          complaintId,
          moderatorUserId: moderator.id,
          decision: 'APPROVED',
          selectedUnitId: unit.id,
        });
        await moderationRepository.insertComplaintAssignment(client, {
          complaintId,
          municipalUnitId: unit.id,
          assignedByUserId: moderator.id,
        });

        const moved = await complaintsRepository.setStatusAndHistory(client, {
          complaintId,
          previousStatus: 'PENDING_REVIEW',
          newStatus: 'ASSIGNED',
          changedByUserId: moderator.id,
          reason: 'MODERATION_APPROVED',
        });
        if (!moved) {
          // Imposible bajo FOR UPDATE, pero si ocurriera hay que revertir todo.
          throw new AppError(409, 'COMPLAINT_NOT_REVIEWABLE', 'La denuncia ya no esta pendiente.');
        }

        const alias = await moderationRepository.findCitizenAlias(complaint.citizenUserId, client);
        return { complaint, alias, unit };
      }
    );

    const ensured = ensureOutcome(outcome);
    const evidence = await mediaRepository.listEvidence(complaintId);
    return toModerationView(
      { ...ensured.complaint, status: 'ASSIGNED' },
      { alias: ensured.alias, evidence, assignedUnit: ensured.unit }
    );
  }

  async function reject(moderator, complaintId, body) {
    const outcome = await complaintsRepository.withComplaintLock(
      complaintId,
      async (complaint, client) => {
        if (!complaint) return { notFound: true };
        if (complaint.status !== 'PENDING_REVIEW') {
          return { conflict: 'COMPLAINT_NOT_REVIEWABLE' };
        }

        await moderationRepository.insertModerationReview(client, {
          complaintId,
          moderatorUserId: moderator.id,
          decision: 'REJECTED',
          rejectionReason: body.rejectionReason,
        });

        const moved = await complaintsRepository.setStatusAndHistory(client, {
          complaintId,
          previousStatus: 'PENDING_REVIEW',
          newStatus: 'REJECTED',
          changedByUserId: moderator.id,
          reason: 'MODERATION_REJECTED',
        });
        if (!moved) {
          throw new AppError(409, 'COMPLAINT_NOT_REVIEWABLE', 'La denuncia ya no esta pendiente.');
        }

        const alias = await moderationRepository.findCitizenAlias(complaint.citizenUserId, client);
        return { complaint, alias };
      }
    );

    const ensured = ensureOutcome(outcome);
    const evidence = await mediaRepository.listEvidence(complaintId);
    return toModerationView(
      { ...ensured.complaint, status: 'REJECTED' },
      { alias: ensured.alias, evidence }
    );
  }

  // ---- Duplicados ----

  async function listDuplicateCandidates(moderator, complaintId) {
    const complaint = await moderationRepository.findComplaintForModerationById(complaintId);
    if (!complaint) {
      throw new AppError(404, 'COMPLAINT_NOT_FOUND', 'La denuncia no existe.');
    }

    const rows = await moderationRepository.findDuplicateCandidates({
      complaintId,
      radiusMeters: config.DUPLICATE_SEARCH_RADIUS_METERS,
      limit: 20,
    });

    return {
      candidates: rows.map((row) => ({
        id: row.id,
        publicCode: row.publicCode,
        title: row.title,
        subcategory: {
          id: row.subcategoryId,
          code: row.subcategoryCode,
          name: row.subcategoryName,
        },
        status: row.status,
        citizenAlias: row.citizenAlias,
        createdAt: row.createdAt,
        formalizedAt: row.formalizedAt,
        distanceMeters: Math.round(Number(row.distanceMeters) * 10) / 10,
      })),
    };
  }

  async function proposeDuplicate(moderator, complaintId, body) {
    if (body.candidateComplaintId === complaintId) {
      throw new AppError(
        422,
        'INVALID_DUPLICATE_CANDIDATE',
        'Una denuncia no puede ser duplicada de si misma.'
      );
    }

    const outcome = await complaintsRepository.withComplaintLock(
      complaintId,
      async (complaint, client) => {
        if (!complaint) return { notFound: true };
        if (complaint.status === 'REJECTED') {
          return { conflict: 'COMPLAINT_NOT_REVIEWABLE' };
        }

        const candidate = await moderationRepository.findComplaintForModerationById(
          body.candidateComplaintId,
          client
        );
        if (!candidate || candidate.status === 'REJECTED') {
          return {
            validation: {
              code: 'INVALID_DUPLICATE_CANDIDATE',
              message: 'La denuncia candidata no existe, fue rechazada o fue borrada.',
            },
          };
        }

        try {
          const proposal = await moderationRepository.insertDuplicateProposal(client, {
            complaintId,
            candidateComplaintId: body.candidateComplaintId,
          });
          return { proposal, candidate };
        } catch (error) {
          if (error.code === '23505' || error.code === '23514') {
            return { conflict: 'DUPLICATE_PROPOSAL_EXISTS' };
          }
          throw error;
        }
      }
    );

    const ensured = ensureOutcome(outcome);
    return {
      id: ensured.proposal.id,
      status: ensured.proposal.status,
      complaintId,
      candidateComplaintId: body.candidateComplaintId,
      candidatePublicCode: ensured.candidate.publicCode,
      createdAt: ensured.proposal.createdAt,
    };
  }

  async function listProposals(query) {
    const rows = await moderationRepository.listDuplicateProposals({ status: query?.status });
    return {
      proposals: rows.map((row) => ({
        id: row.id,
        status: row.status,
        createdAt: row.createdAt,
        reviewedAt: row.reviewedAt,
        complaint: {
          id: row.complaintId,
          publicCode: row.complaintPublicCode,
          title: row.complaintTitle,
          status: row.complaintStatus,
        },
        candidate: {
          id: row.candidateComplaintId,
          publicCode: row.candidatePublicCode,
          title: row.candidateTitle,
          status: row.candidateStatus,
        },
      })),
    };
  }

  async function resolveProposal(moderator, proposalId, body) {
    const outcome = await moderationRepository.withProposalLock(
      proposalId,
      async (proposal, client) => {
        if (!proposal) return { proposalNotFound: true };
        if (proposal.status !== 'PENDING') return { conflict: 'PROPOSAL_ALREADY_RESOLVED' };

        if (body.decision === 'CONFIRMED_GROUP') {
          const [complaint, candidate] = await Promise.all([
            moderationRepository.findComplaintForModerationById(proposal.complaintId, client),
            moderationRepository.findComplaintForModerationById(
              proposal.candidateComplaintId,
              client
            ),
          ]);

          if (!complaint || !candidate || complaint.status === 'REJECTED' || candidate.status === 'REJECTED') {
            return {
              validation: {
                code: 'INVALID_GROUP_MEMBERS',
                message: 'Alguna de las denuncias no existe, fue rechazada o fue borrada.',
              },
            };
          }

          const openMemberships = await moderationRepository.findOpenGroupMemberships(
            [proposal.complaintId, proposal.candidateComplaintId],
            client
          );
          if (openMemberships.length > 0) return { conflict: 'COMPLAINT_ALREADY_GROUPED' };

          const group = await moderationRepository.insertComplaintGroup(client, {
            title: body.title,
            createdByUserId: moderator.id,
          });
          await moderationRepository.insertGroupMembers(client, {
            groupId: group.id,
            complaintIds: [proposal.complaintId, proposal.candidateComplaintId],
            addedByUserId: moderator.id,
          });
          const resolved = await moderationRepository.resolveDuplicateProposal(client, {
            proposalId: proposal.id,
            status: 'CONFIRMED_GROUP',
            reviewedByUserId: moderator.id,
          });
          if (!resolved) return { conflict: 'PROPOSAL_ALREADY_RESOLVED' };

          return {
            proposalId: proposal.id,
            status: 'CONFIRMED_GROUP',
            group: {
              id: group.id,
              title: body.title,
              complaintIds: [proposal.complaintId, proposal.candidateComplaintId],
              createdAt: group.createdAt,
            },
          };
        }

        const resolved = await moderationRepository.resolveDuplicateProposal(client, {
          proposalId: proposal.id,
          status: body.decision,
          reviewedByUserId: moderator.id,
        });
        if (!resolved) return { conflict: 'PROPOSAL_ALREADY_RESOLVED' };
        return { proposalId: proposal.id, status: body.decision };
      }
    );

    return ensureOutcome(outcome);
  }

  async function createGroup(moderator, body) {
    const outcome = await moderationRepository.withTransaction(async (client) => {
      const found = [];
      for (const complaintId of body.complaintIds) {
        const complaint = await moderationRepository.findComplaintForModerationById(
          complaintId,
          client
        );
        if (!complaint || complaint.status === 'REJECTED') {
          return {
            validation: {
              code: 'INVALID_GROUP_MEMBERS',
              message: 'Alguna denuncia no existe, fue rechazada o fue borrada.',
            },
          };
        }
        found.push(complaint);
      }

      const openMemberships = await moderationRepository.findOpenGroupMemberships(
        body.complaintIds,
        client
      );
      if (openMemberships.length > 0) return { conflict: 'COMPLAINT_ALREADY_GROUPED' };

      const group = await moderationRepository.insertComplaintGroup(client, {
        title: body.title,
        createdByUserId: moderator.id,
      });
      await moderationRepository.insertGroupMembers(client, {
        groupId: group.id,
        complaintIds: body.complaintIds,
        addedByUserId: moderator.id,
      });
      const confirmed = await moderationRepository.confirmProposalsBetweenPairs(client, {
        complaintIds: body.complaintIds,
        reviewedByUserId: moderator.id,
      });

      return {
        group: {
          id: group.id,
          title: body.title,
          complaintIds: body.complaintIds,
          createdAt: group.createdAt,
        },
        confirmedProposals: confirmed.length,
      };
    });

    return ensureOutcome(outcome);
  }

  // ---- Fase 6: verificacion de soluciones e infracciones/suspensiones ----

  /**
   * Verificacion de una solucion SUBMITTED por el Moderador.
   * APPROVE -> denuncia RESOLVED (resolved_at); RETURN -> denuncia IN_PROGRESS
   * con comentario visible para el enlace tecnico.
   */
  async function verifySolution(moderator, solutionId, body) {
    const solution = await moderationRepository.findSolutionById(solutionId);
    if (!solution) {
      throw new AppError(404, 'SOLUTION_NOT_FOUND', 'La solucion no existe.');
    }

    const outcome = await complaintsRepository.withComplaintLock(
      solution.complaintId,
      async (complaint, client) => {
        if (!complaint) return { notFound: true };

        const fresh = await moderationRepository.findSolutionById(solutionId, client);
        if (!fresh) return { solutionNotFound: true };
        if (fresh.status !== 'SUBMITTED') return { conflict: 'SOLUTION_ALREADY_VERIFIED' };

        if (body.decision === 'APPROVE') {
          const updated = await moderationRepository.setSolutionResolution(client, {
            solutionId,
            status: 'APPROVED',
            reviewedByUserId: moderator.id,
          });
          if (!updated) return { conflict: 'SOLUTION_ALREADY_VERIFIED' };

          const moved = await complaintsRepository.setStatusAndHistory(client, {
            complaintId: complaint.id,
            previousStatus: 'SOLUTION_SUBMITTED',
            newStatus: 'RESOLVED',
            changedByUserId: moderator.id,
            reason: 'SOLUTION_VERIFIED_APPROVED',
            markResolvedAt: true,
          });
          if (!moved) {
            throw new AppError(
              409,
              'SOLUTION_ALREADY_VERIFIED',
              'La solucion ya fue verificada.'
            );
          }

          return {
            solutionId,
            solutionStatus: 'APPROVED',
            complaintId: complaint.id,
            complaintStatus: 'RESOLVED',
          };
        }

        const updated = await moderationRepository.setSolutionResolution(client, {
          solutionId,
          status: 'RETURNED',
          reviewedByUserId: moderator.id,
          reviewComment: body.reviewComment,
        });
        if (!updated) return { conflict: 'SOLUTION_ALREADY_VERIFIED' };

        const moved = await complaintsRepository.setStatusAndHistory(client, {
          complaintId: complaint.id,
          previousStatus: 'SOLUTION_SUBMITTED',
          newStatus: 'IN_PROGRESS',
          changedByUserId: moderator.id,
          reason: 'SOLUTION_RETURNED',
        });
        if (!moved) {
          throw new AppError(409, 'SOLUTION_ALREADY_VERIFIED', 'La solucion ya fue verificada.');
        }

        return {
          solutionId,
          solutionStatus: 'RETURNED',
          complaintId: complaint.id,
          complaintStatus: 'IN_PROGRESS',
        };
      }
    );

    return ensureOutcome(outcome);
  }

  /**
   * Registra una infraccion sobre el autor de la denuncia indicada y lo
   * suspende por exactamente 168 horas en una sola transaccion.
   */
  async function createViolation(moderator, body) {
    const outcome = await complaintsRepository.withComplaintLock(
      body.complaintId,
      async (complaint, client) => {
        if (!complaint) return { notFound: true };

        const activeSuspension = await moderationRepository.findActiveSuspensionByCitizen(
          complaint.citizenUserId,
          client
        );
        if (activeSuspension) return { conflict: 'CITIZEN_ALREADY_SUSPENDED' };

        try {
          const violation = await moderationRepository.insertViolation(client, {
            citizenUserId: complaint.citizenUserId,
            complaintId: complaint.id,
            moderatorUserId: moderator.id,
            description: body.description,
          });
          const suspension = await moderationRepository.insertSuspension(client, {
            citizenUserId: complaint.citizenUserId,
            violationId: violation.id,
            createdByUserId: moderator.id,
          });
          await moderationRepository.markCitizenSuspended(client, complaint.citizenUserId);

          return {
            violationId: violation.id,
            suspension: {
              id: suspension.id,
              status: suspension.status,
              startedAt: suspension.startedAt,
              endsAt: suspension.endsAt,
            },
          };
        } catch (error) {
          // Carrera entre dos moderadores: el UNIQUE parcial de suspensions.
          if (error.code === '23505') return { conflict: 'CITIZEN_ALREADY_SUSPENDED' };
          throw error;
        }
      }
    );

    return ensureOutcome(outcome);
  }

  return {
    listInbox,
    approve,
    reject,
    listDuplicateCandidates,
    proposeDuplicate,
    listProposals,
    resolveProposal,
    createGroup,
    verifySolution,
    createViolation,
  };
}
