import { AppError } from '../utils/errors.js';

/**
 * Controladores del ciudadano (Fases 3 y 6). Perfil propio y modulo
 * "Mis Denuncias", ambos con minimizacion estricta de datos.
 */
export function createCitizensController({
  usersRepository,
  citizenTrackingService,
}) {
  async function getMyProfile(req, res) {
    const profile = await usersRepository.findCitizenProfile(req.user.id);

    if (!profile) {
      // ADMIN o ciudadano que todavia no fijo su alias: no hay fila en
      // citizen_profiles. El frontend distingue el caso con requiresAlias.
      throw new AppError(
        404,
        'CITIZEN_PROFILE_NOT_FOUND',
        'No existe un perfil de ciudadano para esta cuenta.'
      );
    }

    res.status(200).json(profile);
  }

  async function listMyComplaints(req, res) {
    const result = await citizenTrackingService.listMyComplaints(req.user, req.validatedQuery);
    res.status(200).json(result);
  }

  return { getMyProfile, listMyComplaints };
}
