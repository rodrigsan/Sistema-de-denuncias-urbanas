import OpenLocationCodeModule from 'open-location-code';
import { AppError } from '../utils/errors.js';

// El paquete CJS puede exponer la clase como default o como propiedad.
const OpenLocationCode = OpenLocationCodeModule.OpenLocationCode ?? OpenLocationCodeModule;

export const DEFAULT_LOCATION_TOLERANCE_METERS = 100;

/**
 * Servicio de coherencia entre coordenadas y Plus Code (Open Location Code).
 *
 * Regla: el par (coordenadas, plus_code) almacenado es SIEMPRE coherente.
 * - Coherente tal cual -> MATCH (o CORRECTED si se cambia una ubicacion ya
 *   verificada).
 * - Incoherente: con source AUTOMATIC o con aceptacion explicita del usuario,
 *   el servidor recalcula el Plus Code desde las coordenadas
 *   (SERVER_RECALCULATED). En cualquier otro caso se rechaza con 422
 *   LOCATION_MISMATCH y un detalle accionable. Nunca se atesta nada desde
 *   el cliente sin revalidar en servidor.
 */
export function createPlusCodeService({
  toleranceMeters = DEFAULT_LOCATION_TOLERANCE_METERS,
} = {}) {
  const olc = new OpenLocationCode();

  function isValidFullCode(plusCode) {
    return olc.isValid(plusCode) && olc.isFull(plusCode);
  }

  function haversineMeters(aLatitude, aLongitude, bLatitude, bLongitude) {
    const toRadians = (degrees) => (degrees * Math.PI) / 180;
    const earthRadius = 6371000;
    const deltaLatitude = toRadians(bLatitude - aLatitude);
    const deltaLongitude = toRadians(bLongitude - aLongitude);
    const sine =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(toRadians(aLatitude)) *
        Math.cos(toRadians(bLatitude)) *
        Math.sin(deltaLongitude / 2) ** 2;
    return 2 * earthRadius * Math.asin(Math.sqrt(sine));
  }

  function evaluateLocation({ latitude, longitude, plusCode }) {
    const area = olc.decode(plusCode);
    const center = { latitude: area.latitudeCenter, longitude: area.longitudeCenter };
    const distanceMeters = haversineMeters(latitude, longitude, center.latitude, center.longitude);
    const cellRadiusMeters = haversineMeters(
      center.latitude,
      center.longitude,
      area.latitudeHi,
      area.longitudeHi
    );
    const allowedMeters = cellRadiusMeters + toleranceMeters;

    const insideCell =
      latitude >= area.latitudeLo &&
      latitude <= area.latitudeHi &&
      longitude >= area.longitudeLo &&
      longitude <= area.longitudeHi;

    return {
      coherent: insideCell || distanceMeters <= allowedMeters,
      distanceMeters: Math.round(distanceMeters),
      toleranceMeters: Math.round(allowedMeters),
      submittedPlusCodeCenter: center,
      suggestedPlusCode: olc.encode(latitude, longitude),
    };
  }

  function locationChanged(previous, current) {
    return (
      previous.latitude !== current.latitude ||
      previous.longitude !== current.longitude ||
      previous.plusCode !== current.plusCode
    );
  }

  /**
   * Resuelve la ubicacion definitiva de una denuncia.
   *
   * @param {object} input
   * @returns {{ plusCode: string, verificationMethod: 'MATCH'|'CORRECTED'|'SERVER_RECALCULATED' }}
   * @throws {AppError} 422 INVALID_PLUS_CODE o LOCATION_MISMATCH con detalle accionable.
   */
  function resolveLocation({
    latitude,
    longitude,
    plusCode,
    plusCodeSource,
    acceptServerPlusCode = false,
    previous = null,
  }) {
    if (!isValidFullCode(plusCode)) {
      throw new AppError(
        422,
        'INVALID_PLUS_CODE',
        'El Plus Code debe ser un codigo completo (por ejemplo, 8FVC9G8F+5W).'
      );
    }

    const evaluation = evaluateLocation({ latitude, longitude, plusCode });

    if (evaluation.coherent) {
      const changedPreviouslyVerifiedLocation =
        Boolean(previous?.verifiedAt) &&
        locationChanged(previous, { latitude, longitude, plusCode });
      return {
        plusCode,
        verificationMethod: changedPreviouslyVerifiedLocation ? 'CORRECTED' : 'MATCH',
      };
    }

    if (plusCodeSource === 'AUTOMATIC' || acceptServerPlusCode) {
      return {
        plusCode: olc.encode(latitude, longitude),
        verificationMethod: 'SERVER_RECALCULATED',
      };
    }

    const error = new AppError(
      422,
      'LOCATION_MISMATCH',
      'Las coordenadas no coinciden con el Plus Code proporcionado.'
    );
    error.details = [
      {
        path: 'plusCode',
        suggestedPlusCode: evaluation.suggestedPlusCode,
        submittedPlusCodeCenter: evaluation.submittedPlusCodeCenter,
        distanceMeters: evaluation.distanceMeters,
        toleranceMeters: evaluation.toleranceMeters,
        message:
          'Corrija el pin o el Plus Code, o reenvie aceptando el codigo sugerido (acceptServerPlusCode).',
      },
    ];
    throw error;
  }

  return { isValidFullCode, evaluateLocation, resolveLocation, haversineMeters };
}
