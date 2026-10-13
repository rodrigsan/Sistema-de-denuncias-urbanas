import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';

/**
 * Servicio del Enlace Tecnico/Supervisor (Fase 6): bandeja por unidad,
 * inicio de atencion, registro de soluciones y evidencias privadas de
 * solucion. Todas las mutaciones ocurren en transacciones con FOR UPDATE.
 *
 * Minimizacion (decision confirmada): las vistas no incluyen alias ni datos
 * del ciudadano; solo la denuncia, su unidad y la ultima solucion.
 */
const DEFAULT_WORK_STATUSES = ['ASSIGNED', 'IN_PROGRESS', 'SOLUTION_SUBMITTED'];

export function createTechnicalService({
  complaintsRepository,
  technicalRepository,
  moderationRepository,
  mediaRepository,
  config,
}) {
  function ensureOutcome(outcome) {
    if (outcome?.notFound) {
      throw new AppError(404, 'COMPLAINT_NOT_FOUND', 'La denuncia no existe.');
    }
    if (outcome?.solutionNotFound) {
      throw new AppError(404, 'SOLUTION_NOT_FOUND', 'La solucion no existe.');
    }
    if (outcome?.conflict === 'COMPLAINT_NOT_ASSIGNABLE') {
      throw new AppError(
        409,
        'COMPLAINT_NOT_ASSIGNABLE',
        'La denuncia no esta asignada o ya esta en atencion.'
      );
    }
    if (outcome?.conflict === 'COMPLAINT_NOT_IN_PROGRESS') {
      throw new AppError(
        409,
        'COMPLAINT_NOT_IN_PROGRESS',
        'Debe iniciar la atencion antes de registrar la solucion.'
      );
    }
    if (outcome?.conflict === 'SOLUTION_NOT_EDITABLE') {
      throw new AppError(
        409,
        'SOLUTION_NOT_EDITABLE',
        'La solucion ya fue revisada y no admite mas evidencias.'
      );
    }
    if (outcome?.validation) {
      throw new AppError(422, outcome.validation.code, outcome.validation.message);
    }
    return outcome;
  }

  function toTechnicalView(row, { latestSolution, evidence }) {
    return {
      id: row.id,
      publicCode: row.publicCode,
      status: row.status,
      title: row.title,
      description: row.description,
      category: {
        id: row.categoryId,
        code: row.categoryCode,
        name: row.categoryName,
      },
      subcategory: {
        id: row.subcategoryId,
        code: row.subcategoryCode,
        name: row.subcategoryName,
      },
      location: { latitude: row.latitude, longitude: row.longitude },
      plusCode: row.plusCode,
      createdAt: row.createdAt,
      formalizedAt: row.formalizedAt,
      assignedUnit: {
        id: row.assignedUnitId,
        code: row.assignedUnitCode,
        name: row.assignedUnitName,
        assignedAt: row.assignedAt,
      },
      latestSolution: latestSolution
        ? {
            id: latestSolution.id,
            status: latestSolution.status,
            description: latestSolution.description,
            submittedAt: latestSolution.submittedAt,
            reviewComment: latestSolution.reviewComment ?? null,
            reviewedAt: latestSolution.reviewedAt ?? null,
          }
        : null,
      evidence: evidence ?? [],
    };
  }

  async function listAssignedComplaints(liaison, query) {
    const { page, limit, status } = query;
    const offset = (page - 1) * limit;
    const statuses = status ? [status] : DEFAULT_WORK_STATUSES;

    const memberships = await technicalRepository.findActiveUnitMemberships(liaison.id);
    const unitIds = memberships.map((membership) => membership.id);

    if (unitIds.length === 0) {
      return { complaints: [], pagination: { page, limit, total: 0 } };
    }

    const [rows, total] = await Promise.all([
      technicalRepository.findAssignedComplaints({ unitIds, statuses, limit, offset }),
      technicalRepository.countAssignedComplaints({ unitIds, statuses }),
    ]);

    const complaintIds = rows.map((row) => row.id);
    const [solutionMap, evidenceMap] = await Promise.all([
      technicalRepository.findLatestSolutionsByComplaintIds(complaintIds),
      mediaRepository.listEvidenceByComplaintIds(complaintIds),
    ]);

    return {
      complaints: rows.map((row) =>
        toTechnicalView(row, {
          latestSolution: solutionMap[row.id] ?? null,
          evidence: evidenceMap[row.id] ?? [],
        })
      ),
      pagination: { page, limit, total },
    };
  }

  async function startProcess(liaison, complaintId) {
    const memberships = await technicalRepository.findActiveUnitMemberships(liaison.id);
    const unitIds = memberships.map((membership) => membership.id);

    const outcome = await complaintsRepository.withComplaintLock(
      complaintId,
      async (complaint, client) => {
        if (!complaint) return { notFound: true };

        const assignment = await technicalRepository.findActiveAssignmentInUnits(
          complaintId,
          unitIds,
          client
        );
        if (!assignment) return { notFound: true };

        if (complaint.status !== 'ASSIGNED') return { conflict: 'COMPLAINT_NOT_ASSIGNABLE' };

        const assignmentUnit = await technicalRepository.findActiveAssignmentUnit(
          complaintId,
          client
        );

        const moved = await complaintsRepository.setStatusAndHistory(client, {
          complaintId,
          previousStatus: 'ASSIGNED',
          newStatus: 'IN_PROGRESS',
          changedByUserId: liaison.id,
          reason: 'TECHNICAL_WORK_STARTED',
        });
        if (!moved) {
          throw new AppError(
            409,
            'COMPLAINT_NOT_ASSIGNABLE',
            'La denuncia no esta asignada o ya esta en atencion.'
          );
        }

        return { complaint, assignmentUnit };
      }
    );

    const ensured = ensureOutcome(outcome);
    const unit = ensured.assignmentUnit;
    return toTechnicalView(
      {
        ...ensured.complaint,
        status: 'IN_PROGRESS',
        assignedUnitId: unit?.id,
        assignedUnitCode: unit?.code,
        assignedUnitName: unit?.name,
        assignedAt: unit?.assignedAt,
      },
      {}
    );
  }

  async function submitSolution(liaison, complaintId, body) {
    const memberships = await technicalRepository.findActiveUnitMemberships(liaison.id);
    const unitIds = memberships.map((membership) => membership.id);

    const outcome = await complaintsRepository.withComplaintLock(
      complaintId,
      async (complaint, client) => {
        if (!complaint) return { notFound: true };

        const assignment = await technicalRepository.findActiveAssignmentInUnits(
          complaintId,
          unitIds,
          client
        );
        if (!assignment) return { notFound: true };

        // Maquina de estados estricta: solo desde IN_PROGRESS.
        if (complaint.status !== 'IN_PROGRESS') return { conflict: 'COMPLAINT_NOT_IN_PROGRESS' };

        const assignmentUnit = await technicalRepository.findActiveAssignmentUnit(
          complaintId,
          client
        );

        const solution = await technicalRepository.insertComplaintSolution(client, {
          complaintId,
          submittedByUserId: liaison.id,
          description: body.description,
        });

        const moved = await complaintsRepository.setStatusAndHistory(client, {
          complaintId,
          previousStatus: 'IN_PROGRESS',
          newStatus: 'SOLUTION_SUBMITTED',
          changedByUserId: liaison.id,
          reason: 'SOLUTION_SUBMITTED_BY_TECHNICAL',
        });
        if (!moved) {
          throw new AppError(
            409,
            'COMPLAINT_NOT_IN_PROGRESS',
            'Debe iniciar la atencion antes de registrar la solucion.'
          );
        }

        return { complaint, solution, assignmentUnit };
      }
    );

    const ensured = ensureOutcome(outcome);
    const unit = ensured.assignmentUnit;
    return {
      id: ensured.solution.id,
      status: ensured.solution.status,
      description: body.description,
      submittedAt: ensured.solution.submittedAt,
      complaint: toTechnicalView(
        {
          ...ensured.complaint,
          status: 'SOLUTION_SUBMITTED',
          assignedUnitId: unit?.id,
          assignedUnitCode: unit?.code,
          assignedUnitName: unit?.name,
          assignedAt: unit?.assignedAt,
        },
        {
          latestSolution: {
            id: ensured.solution.id,
            status: ensured.solution.status,
            description: body.description,
            submittedAt: ensured.solution.submittedAt,
            reviewComment: null,
            reviewedAt: null,
          },
        }
      ),
    };
  }

  async function addSolutionEvidence(liaison, solutionId, evidenceFile) {
    const memberships = await technicalRepository.findActiveUnitMemberships(liaison.id);
    const unitIds = memberships.map((membership) => membership.id);

    const solution = await moderationRepository.findSolutionById(solutionId);
    if (!solution) {
      await evidenceFile.dispose();
      throw new AppError(404, 'SOLUTION_NOT_FOUND', 'La solucion no existe.');
    }

    const outcome = await complaintsRepository.withComplaintLock(
      solution.complaintId,
      async (complaint, client) => {
        if (!complaint) return { notFound: true };

        const assignment = await technicalRepository.findActiveAssignmentInUnits(
          complaint.id,
          unitIds,
          client
        );
        if (!assignment) return { notFound: true };

        const freshSolution = await moderationRepository.findSolutionById(solutionId, client);
        if (!freshSolution) return { solutionNotFound: true };
        if (freshSolution.status !== 'SUBMITTED') return { conflict: 'SOLUTION_NOT_EDITABLE' };

        const counts = await mediaRepository.countSolutionEvidenceByType(solutionId, client);
        const isImage = evidenceFile.mediaType === 'IMAGE';
        const maxCount = isImage ? config.EVIDENCE_MAX_IMAGES : config.EVIDENCE_MAX_VIDEOS;
        const current = counts[evidenceFile.mediaType] ?? 0;
        if (current >= maxCount) {
          return {
            validation: {
              code: 'EVIDENCE_LIMIT_REACHED',
              message: `La solucion ya tiene el maximo de ${maxCount} ${
                isImage ? 'imagenes' : 'videos'
              } permitidos.`,
            },
          };
        }

        const storageKey = `solutions/${solutionId}/${crypto.randomUUID()}${evidenceFile.extension}`;
        const media = await mediaRepository.insertEvidenceWithJob(client, {
          solutionId,
          mediaType: evidenceFile.mediaType,
          storageKey,
          mimeType: evidenceFile.mimeType,
          sizeBytes: evidenceFile.sizeBytes,
          createdByUserId: liaison.id,
        });
        return { media, storageKey };
      }
    );

    if (outcome.notFound || outcome.solutionNotFound || outcome.conflict || outcome.validation) {
      await evidenceFile.dispose();
      return ensureOutcome(outcome);
    }

    try {
      await evidenceFile.persistTo(outcome.storageKey);
    } catch {
      await evidenceFile.dispose();
      await mediaRepository.markEvidenceFailed(outcome.media.id);
      throw new AppError(500, 'EVIDENCE_STORAGE_FAILED', 'No se pudo almacenar el archivo.');
    }

    return {
      id: outcome.media.id,
      mediaType: outcome.media.mediaType,
      mimeType: outcome.media.mimeType,
      sizeBytes: Number(outcome.media.sizeBytes),
      processingStatus: outcome.media.processingStatus,
    };
  }

  return { listAssignedComplaints, startProcess, submitSolution, addSolutionEvidence };
}
