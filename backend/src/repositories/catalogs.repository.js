/**
 * Repositorio de catalogos (Fase 3). Consultas de solo lectura contra
 * categorias, subcategorias y unidades municipales activas. Sin PII.
 *
 * El filtrado por `active = TRUE` y el ordenamiento (sort_order con desempate
 * por name; en municipal_units, que no tiene sort_order, por name) son parte
 * del contrato del repositorio. Toda consulta es parametrizada, aunque estas
 * no reciben entrada del usuario.
 */
export function createCatalogsRepository({ db }) {
  /**
   * Arbol de categorias activas con sus subcategorias activas agrupadas
   * y ordenadas por sort_order (desempate alfabetico por nombre).
   */
  async function findActiveCategoriesWithSubcategories() {
    const { rows: categoryRows } = await db.query(
      `SELECT id, code, name, description, sort_order
         FROM categories
        WHERE active = TRUE
        ORDER BY sort_order ASC, name ASC`
    );

    const { rows: subcategoryRows } = await db.query(
      `SELECT id, category_id, code, name, description, sort_order
         FROM subcategories
        WHERE active = TRUE
        ORDER BY sort_order ASC, name ASC`
    );

    const subcategoriesByCategory = new Map();
    for (const row of subcategoryRows) {
      const group = subcategoriesByCategory.get(row.category_id) ?? [];
      group.push({
        id: row.id,
        code: row.code,
        name: row.name,
        description: row.description,
        sortOrder: row.sort_order,
      });
      subcategoriesByCategory.set(row.category_id, group);
    }

    return categoryRows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      sortOrder: row.sort_order,
      subcategories: subcategoriesByCategory.get(row.id) ?? [],
    }));
  }

  /**
   * Unidades municipales activas. Por decision de diseño, la respuesta solo
   * incluye id, code y name: las descripciones del seed son notas operativas
   * de moderacion, no informacion para ciudadanos.
   */
  async function findActiveMunicipalUnits() {
    const { rows } = await db.query(
      `SELECT id, code, name
         FROM municipal_units
        WHERE active = TRUE
        ORDER BY name ASC`
    );
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
    }));
  }

  return { findActiveCategoriesWithSubcategories, findActiveMunicipalUnits };
}
