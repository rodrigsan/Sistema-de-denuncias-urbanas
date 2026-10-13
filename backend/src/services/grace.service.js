/**
 * Motor de la ventana de gracia (tiempo efectivo de 180 segundos).
 *
 * Invariantes:
 * - `grace_running_since` no nulo  <=>  el reloj corre (estado RUNNING).
 * - Sesion de edicion abierta      <=>  el reloj esta pausado (remaining congelado).
 * - El par (estado, formalized_at) cumple el CHECK del esquema: solo
 *   GRACE_PERIOD puede no tener formalized_at.
 * - Toda mutacion de estado ocurre dentro de una transaccion con
 *   SELECT ... FOR UPDATE sobre la fila de la denuncia.
 *
 * El reloj de referencia es `now()` de PostgreSQL (dbNow), leido en la misma
 * consulta que bloquea la fila: elimina desvios app/BD y permite pruebas
 * deterministas manipulando el tiempo con SQL.
 */
export const GRACE_TOTAL_SECONDS = 180;
export const MAX_EDIT_SESSION_MINUTES = 10;
export const FORMALIZATION_COOLDOWN_MINUTES = 60;
export const GRACE_SWEEP_INTERVAL_MS = 30 * 1000;

export function createGraceService({ complaintsRepository }) {
  /**
   * Tiempo efectivo restante en segundos. Pausado: el valor congelado;
   * corriendo: remaining - transcurrido; formalizado: 0.
   */
  function computeEffectiveRemaining(complaint) {
    if (complaint.status !== 'GRACE_PERIOD') return 0;
    if (!complaint.graceRunningSince) return complaint.graceRemainingSeconds;

    const elapsedMs = new Date(complaint.dbNow) - new Date(complaint.graceRunningSince);
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    return Math.max(0, complaint.graceRemainingSeconds - elapsedSeconds);
  }

  /**
   * Estado legible para el cliente.
   */
  function graceStateOf(complaint) {
    if (complaint.status !== 'GRACE_PERIOD') return 'FORMALIZED';
    return complaint.graceRunningSince ? 'RUNNING' : 'PAUSED_FOR_EDIT';
  }

  /**
   * Carga la denuncia con bloqueo, cierra sesiones de edicion huerfanas
   * (> MAX_EDIT_SESSION_MINUTES, end_reason TIMEOUT), reanuda su reloj y
   * formaliza automaticamente si el tiempo efectivo llego a 0. Luego delega
   * la operacion especifica con la fila fresca. Verifica existencia y
   * propiedad ANTES de tocar estado: una peticion no autorizada nunca muta.
   *
   * @param {string} complaintId
   * @param {string} ownerId id interno del ciudadano dueño.
   * @param {(complaint: object, client: import('pg').PoolClient) => Promise<object>} operation
   */
  async function withFreshComplaint(complaintId, ownerId, operation) {
    return complaintsRepository.withComplaintLock(complaintId, async (complaint, client) => {
      if (!complaint) return { notFound: true };
      if (complaint.citizenUserId !== ownerId) return { notFound: true };

      if (complaint.status === 'GRACE_PERIOD') {
        const swept = await complaintsRepository.closeStaleEditSession(
          client,
          complaint.id,
          MAX_EDIT_SESSION_MINUTES
        );
        if (swept) {
          await complaintsRepository.resumeClock(client, complaint.id);
          complaint.graceRunningSince = complaint.dbNow;
        }

        if (computeEffectiveRemaining(complaint) <= 0) {
          await complaintsRepository.formalizeLocked(
            client,
            complaint,
            FORMALIZATION_COOLDOWN_MINUTES
          );
          complaint.status = 'PENDING_REVIEW';
          complaint.formalizedAt = complaint.dbNow;
          complaint.graceRemainingSeconds = 0;
          complaint.graceRunningSince = null;
        }
      }

      return operation(complaint, client);
    });
  }

  /**
   * Barrido por lotes para el temporizador de server.js: cierra sesiones
   * huerfanas, reanuda relojes y formaliza las expiradas.
   */
  async function sweepExpired({ limit = 100 } = {}) {
    return complaintsRepository.sweepExpired({
      staleMinutes: MAX_EDIT_SESSION_MINUTES,
      cooldownMinutes: FORMALIZATION_COOLDOWN_MINUTES,
      limit,
    });
  }

  return {
    GRACE_TOTAL_SECONDS,
    MAX_EDIT_SESSION_MINUTES,
    FORMALIZATION_COOLDOWN_MINUTES,
    GRACE_SWEEP_INTERVAL_MS,
    computeEffectiveRemaining,
    graceStateOf,
    withFreshComplaint,
    sweepExpired,
  };
}
