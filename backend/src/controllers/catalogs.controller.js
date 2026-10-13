/**
 * Controladores de catalogos (Fase 3). Solo lectura y sin PII: exponen las
 * categorias/subcategorias activas y las unidades municipales activas. La
 * logica de filtrado y ordenamiento vive en el repositorio.
 */
export function createCatalogsController({ catalogsRepository }) {
  async function listCategories(req, res) {
    const categories = await catalogsRepository.findActiveCategoriesWithSubcategories();
    res.status(200).json({ categories });
  }

  async function listMunicipalUnits(req, res) {
    const municipalUnits = await catalogsRepository.findActiveMunicipalUnits();
    res.status(200).json({ municipalUnits });
  }

  return { listCategories, listMunicipalUnits };
}
