import { Router } from 'express';
import { createCatalogsController } from '../controllers/catalogs.controller.js';
import { createRequireAuth } from '../middlewares/require-auth.js';
import { asyncHandler } from '../utils/async-handler.js';

/**
 * Rutas de catalogos (Fase 3): categorias/subcategorias y unidades
 * municipales activas. Ambas exigen sesion valida; no tienen restriccion de
 * rol porque cualquier usuario autenticado (ciudadano o admin) puede
 * consultarlas.
 */
export function createCategoriesRouter({ usersRepository, catalogsRepository }) {
  const router = Router();
  const controller = createCatalogsController({ catalogsRepository });
  const requireAuth = createRequireAuth({ usersRepository });

  router.get('/', requireAuth, asyncHandler(controller.listCategories));

  return router;
}

export function createMunicipalUnitsRouter({ usersRepository, catalogsRepository }) {
  const router = Router();
  const controller = createCatalogsController({ catalogsRepository });
  const requireAuth = createRequireAuth({ usersRepository });

  router.get('/', requireAuth, asyncHandler(controller.listMunicipalUnits));

  return router;
}
