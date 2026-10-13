import { AppError } from '../utils/errors.js';

/**
 * Servicio "Mis Denuncias" (Fase 6): listado paginado del ciudadano con
 * minimizacion estricta. Sin evidencias multimedia (ni del ciudadano ni de
 * la unidad tecnica): solo texto, estado y contexto de seguimiento.
 */
export function createCitizenTrackingService({ citizenComplaintsRepository }) {
  function ensureCitizen(actor) {
    if (actor.userType !== 'CITIZEN') {
      throw new AppError(
        403,
        'FORBIDDEN',
        'Solo un ciudadano puede consultar el modulo de denuncias propias.'
      );
    }
  }

  function toCitizenComplaintView(row) {
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
      rejectionReason: row.rejectionReason ?? null,
      assignedUnit: row.assignedUnitId
        ? {
            id: row.assignedUnitId,
            code: row.assignedUnitCode,
            name: row.assignedUnitName,
            assignedAt: row.assignedAt,
          }
        : null,
      solution: row.solutionId
        ? {
            description: row.solutionDescription,
            submittedAt: row.solutionSubmittedAt,
            reviewedAt: row.solutionReviewedAt,
          }
        : null,
    };
  }

  async function listMyComplaints(actor, query) {
    ensureCitizen(actor);

    const { page, limit, status } = query;
    const offset = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      citizenComplaintsRepository.findOwnComplaints({
        citizenUserId: actor.id,
        status,
        limit,
        offset,
      }),
      citizenComplaintsRepository.countOwnComplaints({
        citizenUserId: actor.id,
        status,
      }),
    ]);

    return {
      complaints: rows.map(toCitizenComplaintView),
      pagination: { page, limit, total },
    };
  }

  return { listMyComplaints };
}
