/**
 * Repositorio de reportes (MVP).
 *
 * Consultas de solo lectura contra `complaints`, `categories` y
 * `subcategories`. Excluye siempre registros eliminados (`deleted_at IS NULL`).
 * Toda consulta es parametrizada; nunca interpola entrada de usuario.
 *
 * Clasificación de estados para el análisis histórico:
 * - Resueltas: status = 'RESOLVED'
 * - Pendientes o en proceso: status IN ('GRACE_PERIOD','PENDING_REVIEW','ASSIGNED','IN_PROGRESS','SOLUTION_SUBMITTED')
 * - Excluidas del conteo de pendientes: 'REJECTED' (estado terminal por rechazo,
 *   no representa una denuncia activa ni una resolución satisfactoria).
 */

const BASE_FROM = `
  FROM complaints c
  JOIN categories cat ON cat.id = c.category_id
  JOIN subcategories sub ON sub.id = c.subcategory_id
  WHERE c.deleted_at IS NULL
`;

function buildWhere(filters, params) {
  const conditions = [];
  if (filters.periodFrom) {
    params.push(filters.periodFrom);
    conditions.push(`c.created_at >= $${params.length}::timestamp`);
  }
  if (filters.periodTo) {
    params.push(filters.periodTo);
    conditions.push(`c.created_at <= $${params.length}::timestamp`);
  }
  if (filters.categoryId) {
    params.push(filters.categoryId);
    conditions.push(`c.category_id = $${params.length}::uuid`);
  }
  if (filters.subcategoryId) {
    params.push(filters.subcategoryId);
    conditions.push(`c.subcategory_id = $${params.length}::uuid`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`c.status = $${params.length}`);
  }
  return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
}

export function createReportsRepository({ db }) {
  async function getSummary(filters = {}) {
    const params = [];
    const where = buildWhere(filters, params);

    const { rows } = await db.query(
      `
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE c.status = 'RESOLVED')::int AS resolved,
          count(*) FILTER (
            WHERE c.status IN (
              'GRACE_PERIOD', 'PENDING_REVIEW', 'ASSIGNED', 'IN_PROGRESS', 'SOLUTION_SUBMITTED'
            )
          )::int AS pending,
          count(DISTINCT c.category_id)::int AS categories
        ${BASE_FROM}${where}
      `,
      params,
    );

    const row = rows[0];
    const total = Number(row.total ?? 0);
    const resolved = Number(row.resolved ?? 0);
    const pending = Number(row.pending ?? 0);
    const percentage = total > 0 ? Math.round((resolved / total) * 100) : 0;

    return { total, resolved, pending, percentage, categories: Number(row.categories ?? 0) };
  }

  async function getHeatmapPoints(filters = {}, limit = 5000) {
    const params = [];
    const where = buildWhere(filters, params);
    params.push(limit);

    const { rows } = await db.query(
      `
        SELECT c.id,
               c.public_code AS "publicCode",
               ST_Y(c.location::geometry) AS latitude,
               ST_X(c.location::geometry) AS longitude,
               c.status,
               c.category_id AS "categoryId",
               cat.name AS "categoryName",
               c.subcategory_id AS "subcategoryId",
               sub.name AS "subcategoryName",
               c.created_at AS "createdAt"
        ${BASE_FROM}${where}
          AND c.location IS NOT NULL
        ORDER BY c.created_at DESC
        LIMIT $${params.length}
      `,
      params,
    );

    return rows.map((row) => ({
      id: row.id,
      publicCode: row.publicCode,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      status: row.status,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      subcategoryId: row.subcategoryId,
      subcategoryName: row.subcategoryName,
      createdAt: row.createdAt,
    }));
  }

  async function getCategoryBreakdown(filters = {}) {
    const params = [];
    const where = buildWhere(filters, params);

    const { rows } = await db.query(
      `
        SELECT cat.id AS "categoryId",
               cat.name AS "categoryName",
               sub.id AS "subcategoryId",
               sub.name AS "subcategoryName",
               count(*)::int AS total
        ${BASE_FROM}${where}
        GROUP BY cat.id, cat.name, sub.id, sub.name
        ORDER BY total DESC, cat.name ASC, sub.name ASC
        LIMIT 50
      `,
      params,
    );

    return rows.map((row) => ({
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      subcategoryId: row.subcategoryId,
      subcategoryName: row.subcategoryName,
      total: Number(row.total ?? 0),
    }));
  }

  async function getTimeline(filters = {}, granularity = 'day') {
    const params = [];
    const where = buildWhere(filters, params);

    const dateTrunc = granularity === 'week' ? 'week' : granularity === 'month' ? 'month' : 'day';

    const { rows } = await db.query(
      `
        SELECT date_trunc($${params.length + 1}, c.created_at) AS "period",
               count(*)::int AS total
        ${BASE_FROM}${where}
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      [...params, dateTrunc],
    );

    return rows.map((row) => ({
      period: row.period,
      total: Number(row.total ?? 0),
    }));
  }

  return { getSummary, getHeatmapPoints, getCategoryBreakdown, getTimeline };
}
