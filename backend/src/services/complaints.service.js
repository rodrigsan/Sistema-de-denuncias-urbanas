import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';
import { DEFAULT_DELETION_REASON } from '../validators/complaints.validators.js';

/**
 * Servicio de denuncias (Fase 4): orquesta validadores ya aplicados,
 * reglas de negocio y repositorios. La maquina de gracia vive en
 * grace.service; la coherencia de ubicacion en plus-code.service.
 *
 * Los AppError lanzados dentro de la operacion transaccionada (por ejemplo
 * LOCATION_MISMATCH con details) propagan y provocan ROLLBACK automatico.
 *
 * Minimizacion: las respuestas jamas incluyen email, provider_subject,
 * storage keys ni datos de otros usuarios.
 */
export function createComplaintsService({
  complaintsRepository,
  mediaRepository,
  graceService,
  plusCodeService,
  config,
}) {
  function ensureOutcome(outcome) {
    if (outcome?.notFound) {
      throw new AppError(404, 'COMPLAINT_NOT_FOUND', 'La denuncia no existe.');
    }
    if (outcome?.conflict === 'COMPLAINT_FORMALIZED') {
      throw new AppError(
        409,
        'COMPLAINT_FORMALIZED',
        'La denuncia ya fue formalizada y no admite cambios.'
      );
    }
    if (outcome?.conflict === 'EDIT_SESSION_NOT_OPEN') {
      throw new AppError(
        409,
        'EDIT_SESSION_NOT_OPEN',
        'Debe iniciar la sesion de edicion antes de guardar cambios.'
      );
    }
    if (outcome?.validation) {
      throw new AppError(422, outcome.validation.code, outcome.validation.message);
    }
    return outcome;
  }

  function toComplaintResponse(complaint, evidence) {
    return {
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
      location: {
        latitude: complaint.latitude,
        longitude: complaint.longitude,
      },
      plusCode: complaint.plusCode,
      plusCodeSource: complaint.plusCodeSource,
      locationVerificationMethod: complaint.locationVerificationMethod,
      grace: {
        remainingSeconds: graceService.computeEffectiveRemaining(complaint),
        state: graceService.graceStateOf(complaint),
      },
      evidence: evidence ?? [],
      createdAt: complaint.createdAt,
    };
  }

  function ensureCitizenWithAlias(actor) {
    if (actor.userType !== 'CITIZEN') {
      throw new AppError(403, 'FORBIDDEN', 'Solo un ciudadano puede realizar esta operacion.');
    }
    if (actor.requiresAlias) {
      throw new AppError(
        409,
        'ALIAS_REQUIRED',
        'Establezca su alias antes de crear o gestionar denuncias.'
      );
    }
  }

  /**
   * Un ciudadano suspendido conserva sus lecturas, pero todas las operaciones
   * mutantes de denuncias quedan bloqueadas (403 ACCOUNT_SUSPENDED).
   */
  function ensureNotSuspended(actor) {
    if (actor.suspended) {
      throw new AppError(
        403,
        'ACCOUNT_SUSPENDED',
        'Su cuenta esta suspendida temporalmente y no puede gestionar denuncias.'
      );
    }
  }

  async function createComplaint(actor, body) {
    ensureCitizenWithAlias(actor);
    ensureNotSuspended(actor);

    const limit = await complaintsRepository.getSubmissionLimit(actor.id);
    if (limit?.nextAllowedAt && new Date(limit.dbNow) < new Date(limit.nextAllowedAt)) {
      const secondsRemaining = Math.ceil(
        (new Date(limit.nextAllowedAt) - new Date(limit.dbNow)) / 1000
      );
      const error = new AppError(
        429,
        'SUBMISSION_COOLDOWN',
        'Debe esperar antes de crear una nueva denuncia.'
      );
      error.details = [
        {
          path: 'cooldown',
          secondsRemaining,
          message: `Intente nuevamente en ${secondsRemaining} segundos.`,
        },
      ];
      throw error;
    }

    const catalog = await complaintsRepository.findActiveCategorySubcategory(
      body.categoryId,
      body.subcategoryId
    );
    if (!catalog) {
      throw new AppError(
        422,
        'INVALID_SUBCATEGORY',
        'La subcategoria no pertenece a la categoria, o alguna de las dos esta inactiva.'
      );
    }

    const resolution = plusCodeService.resolveLocation({
      latitude: body.latitude,
      longitude: body.longitude,
      plusCode: body.plusCode,
      plusCodeSource: body.plusCodeSource,
      acceptServerPlusCode: body.acceptServerPlusCode,
    });

    const created = await complaintsRepository.createComplaint({
      citizenUserId: actor.id,
      title: body.title,
      description: body.description,
      categoryId: catalog.categoryId,
      subcategoryId: catalog.subcategoryId,
      latitude: body.latitude,
      longitude: body.longitude,
      plusCode: resolution.plusCode,
      plusCodeSource: body.plusCodeSource,
      verificationMethod: resolution.verificationMethod,
      graceSeconds: graceService.GRACE_TOTAL_SECONDS,
    });

    return {
      id: created.id,
      publicCode: created.publicCode,
      status: 'GRACE_PERIOD',
      title: body.title,
      description: body.description,
      category: {
        id: catalog.categoryId,
        code: catalog.categoryCode,
        name: catalog.categoryName,
      },
      subcategory: {
        id: catalog.subcategoryId,
        code: catalog.subcategoryCode,
        name: catalog.subcategoryName,
      },
      location: { latitude: body.latitude, longitude: body.longitude },
      plusCode: resolution.plusCode,
      plusCodeSource: body.plusCodeSource,
      locationVerificationMethod: resolution.verificationMethod,
      grace: { remainingSeconds: graceService.GRACE_TOTAL_SECONDS, state: 'RUNNING' },
      evidence: [],
      createdAt: created.createdAt,
    };
  }

  async function getComplaint(actor, complaintId) {
    const outcome = await graceService.withFreshComplaint(complaintId, actor.id, (complaint) => ({
      complaint,
    }));
    ensureOutcome(outcome);
    const evidence = await mediaRepository.listEvidence(complaintId);
    return toComplaintResponse(outcome.complaint, evidence);
  }

  async function startEditSession(actor, complaintId) {
    ensureNotSuspended(actor);
    const outcome = await graceService.withFreshComplaint(
      complaintId,
      actor.id,
      async (complaint, client) => {
        if (complaint.status !== 'GRACE_PERIOD') return { conflict: 'COMPLAINT_FORMALIZED' };

        const openSession = await complaintsRepository.findOpenEditSession(client, complaintId);
        if (openSession) return { complaint }; // idempotente: ya esta pausado

        const remaining = graceService.computeEffectiveRemaining(complaint);
        await complaintsRepository.pauseClock(client, complaintId, remaining);
        await complaintsRepository.insertEditSession(client, complaintId);

        complaint.graceRemainingSeconds = remaining;
        complaint.graceRunningSince = null;
        return { complaint };
      }
    );
    return toComplaintResponse(ensureOutcome(outcome).complaint);
  }

  async function updateComplaint(actor, complaintId, body) {
    ensureNotSuspended(actor);
    const outcome = await graceService.withFreshComplaint(
      complaintId,
      actor.id,
      async (complaint, client) => {
        if (complaint.status !== 'GRACE_PERIOD') return { conflict: 'COMPLAINT_FORMALIZED' };

        const openSession = await complaintsRepository.findOpenEditSession(client, complaintId);
        if (!openSession) return { conflict: 'EDIT_SESSION_NOT_OPEN' };

        const catalog = await complaintsRepository.findActiveCategorySubcategory(
          body.categoryId,
          body.subcategoryId,
          client
        );
        if (!catalog) {
          return {
            validation: {
              code: 'INVALID_SUBCATEGORY',
              message:
                'La subcategoria no pertenece a la categoria, o alguna de las dos esta inactiva.',
            },
          };
        }

        // Lanza LOCATION_MISMATCH/INVALID_PLUS_CODE (con details) -> ROLLBACK.
        const resolution = plusCodeService.resolveLocation({
          latitude: body.latitude,
          longitude: body.longitude,
          plusCode: body.plusCode,
          plusCodeSource: body.plusCodeSource,
          acceptServerPlusCode: body.acceptServerPlusCode,
          previous: {
            latitude: complaint.latitude,
            longitude: complaint.longitude,
            plusCode: complaint.plusCode,
            verifiedAt: complaint.locationVerifiedAt,
          },
        });

        await complaintsRepository.updateComplaintFields(client, complaintId, {
          title: body.title,
          description: body.description,
          categoryId: catalog.categoryId,
          subcategoryId: catalog.subcategoryId,
          latitude: body.latitude,
          longitude: body.longitude,
          plusCode: resolution.plusCode,
          plusCodeSource: body.plusCodeSource,
          verificationMethod: resolution.verificationMethod,
        });
        await complaintsRepository.closeOpenEditSession(client, complaintId, 'SAVED');
        await complaintsRepository.resumeClock(client, complaintId);

        complaint.title = body.title;
        complaint.description = body.description;
        complaint.categoryId = catalog.categoryId;
        complaint.categoryCode = catalog.categoryCode;
        complaint.categoryName = catalog.categoryName;
        complaint.subcategoryId = catalog.subcategoryId;
        complaint.subcategoryCode = catalog.subcategoryCode;
        complaint.subcategoryName = catalog.subcategoryName;
        complaint.latitude = body.latitude;
        complaint.longitude = body.longitude;
        complaint.plusCode = resolution.plusCode;
        complaint.locationVerificationMethod = resolution.verificationMethod;
        complaint.graceRunningSince = complaint.dbNow;

        return { complaint };
      }
    );

    ensureOutcome(outcome);
    const evidence = await mediaRepository.listEvidence(complaintId);
    return toComplaintResponse(outcome.complaint, evidence);
  }

  async function cancelEditSession(actor, complaintId) {
    ensureNotSuspended(actor);
    const outcome = await graceService.withFreshComplaint(
      complaintId,
      actor.id,
      async (complaint, client) => {
        if (complaint.status !== 'GRACE_PERIOD') return { conflict: 'COMPLAINT_FORMALIZED' };

        const openSession = await complaintsRepository.findOpenEditSession(client, complaintId);
        if (!openSession) return { conflict: 'EDIT_SESSION_NOT_OPEN' };

        await complaintsRepository.closeOpenEditSession(client, complaintId, 'CANCELLED');
        await complaintsRepository.resumeClock(client, complaintId);

        complaint.graceRunningSince = complaint.dbNow;
        return { complaint };
      }
    );
    return toComplaintResponse(ensureOutcome(outcome).complaint);
  }

  async function deleteComplaint(actor, complaintId, body) {
    ensureNotSuspended(actor);
    const outcome = await graceService.withFreshComplaint(
      complaintId,
      actor.id,
      async (complaint, client) => {
        if (complaint.status !== 'GRACE_PERIOD') return { conflict: 'COMPLAINT_FORMALIZED' };

        const reason = body?.deletionReason || DEFAULT_DELETION_REASON;
        await complaintsRepository.softDelete(client, complaintId, reason);
        await complaintsRepository.closeOpenEditSession(client, complaintId, 'CANCELLED');
        return { deleted: true };
      }
    );
    ensureOutcome(outcome);
  }

  async function addEvidence(actor, complaintId, evidenceFile) {
    ensureNotSuspended(actor);
    const outcome = await graceService.withFreshComplaint(
      complaintId,
      actor.id,
      async (complaint, client) => {
        if (complaint.status !== 'GRACE_PERIOD') return { conflict: 'COMPLAINT_FORMALIZED' };

        const counts = await mediaRepository.countEvidenceByType(complaintId, client);
        const isImage = evidenceFile.mediaType === 'IMAGE';
        const maxCount = isImage ? config.EVIDENCE_MAX_IMAGES : config.EVIDENCE_MAX_VIDEOS;
        const current = counts[evidenceFile.mediaType] ?? 0;
        if (current >= maxCount) {
          return {
            validation: {
              code: 'EVIDENCE_LIMIT_REACHED',
              message: `La denuncia ya tiene el maximo de ${maxCount} ${
                isImage ? 'imagenes' : 'videos'
              } permitidos.`,
            },
          };
        }

        const storageKey = `complaints/${complaintId}/${crypto.randomUUID()}${evidenceFile.extension}`;
        const media = await mediaRepository.insertEvidenceWithJob(client, {
          complaintId,
          mediaType: evidenceFile.mediaType,
          storageKey,
          mimeType: evidenceFile.mimeType,
          sizeBytes: evidenceFile.sizeBytes,
          createdByUserId: actor.id,
        });
        return { media, storageKey };
      }
    );

    // Errores de estado: liberar el archivo temporal ANTES de lanzar.
    if (outcome.notFound || outcome.conflict || outcome.validation) {
      await evidenceFile.dispose();
      ensureOutcome(outcome);
      throw new Error('Resultado inesperado en addEvidence.');
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
      sizeBytes: outcome.media.sizeBytes,
      processingStatus: outcome.media.processingStatus,
    };
  }

  /**
   * Elimina (soft-delete) una evidencia de la denuncia durante la gracia.
   */
  async function deleteEvidence(actor, complaintId, evidenceId) {
    ensureNotSuspended(actor)
    const outcome = await graceService.withFreshComplaint(
      complaintId,
      actor.id,
      async (complaint, client) => {
        if (complaint.status !== 'GRACE_PERIOD') return { conflict: 'COMPLAINT_FORMALIZED' }

        const deleted = await mediaRepository.softDeleteEvidence(client, evidenceId)
        if (!deleted) return { validation: { code: 'EVIDENCE_NOT_FOUND', message: 'La evidencia no existe o ya fue eliminada.' } }
        return { deleted: true }
      }
    )
    ensureOutcome(outcome)
  }

  return {
    createComplaint,
    getComplaint,
    startEditSession,
    updateComplaint,
    cancelEditSession,
    deleteComplaint,
    addEvidence,
    deleteEvidence,
  };
}
