/**
 * Servicio de reportes (MVP).
 *
 * Orquesta el repositorio de reportes para proveer estadísticas históricas
 * y datos geográficos de calor sin exponer información personal de ciudadanos.
 */
export function createReportsService({ reportsRepository }) {
  async function getSummary(filters = {}) {
    return reportsRepository.getSummary(filters);
  }

  async function getHeatmap(filters = {}) {
    return reportsRepository.getHeatmapPoints(filters);
  }

  async function getCategoryBreakdown(filters = {}) {
    return reportsRepository.getCategoryBreakdown(filters);
  }

  async function getTimeline(filters = {}, granularity = 'day') {
    return reportsRepository.getTimeline(filters, granularity);
  }

  return { getSummary, getHeatmap, getCategoryBreakdown, getTimeline };
}
