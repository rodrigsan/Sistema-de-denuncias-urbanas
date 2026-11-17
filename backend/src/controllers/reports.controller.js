/**
 * Controladores de reportes (MVP). Capa fina: HTTP -> servicio.
 * Toda la logica de acceso a datos vive en reports.repository.
 */
export function createReportsController({ reportsService }) {
  async function getSummary(req, res) {
    const summary = await reportsService.getSummary(req.validatedQuery ?? {});
    res.status(200).json(summary);
  }

  async function getHeatmap(req, res) {
    const points = await reportsService.getHeatmap(req.validatedQuery ?? {});
    res.status(200).json({ points, count: points.length });
  }

  async function getCategories(req, res) {
    const categories = await reportsService.getCategoryBreakdown(req.validatedQuery ?? {});
    res.status(200).json(categories);
  }

  async function getTimeline(req, res) {
    const filters = req.validatedQuery ?? {};
    const granularity = filters.granularity ?? 'day';
    const timeline = await reportsService.getTimeline(filters, granularity);
    res.status(200).json(timeline);
  }

  return { getSummary, getHeatmap, getCategories, getTimeline };
}
