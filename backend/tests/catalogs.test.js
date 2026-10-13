import crypto from 'node:crypto';
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../src/config/database.js';
import { createTestHarness, testSub } from './helpers/fixtures.js';

// Orden esperado del seed (002_seed_catalogs.sql) por sort_order.
const EXPECTED_CATEGORY_ORDER = [
  'VIALIDAD_CALLES',
  'SERVICIOS_ILUMINACION',
  'ESPACIOS_AREAS_VERDES',
  'GESTION_AMBIENTAL_ASEO',
  'SEGURIDAD',
];

const EXPECTED_SUBCATEGORY_COUNTS = {
  VIALIDAD_CALLES: 3,
  SERVICIOS_ILUMINACION: 2,
  ESPACIOS_AREAS_VERDES: 3,
  GESTION_AMBIENTAL_ASEO: 3,
  SEGURIDAD: 2,
};

const harness = createTestHarness({ db });
let baseUrl;
let authJar;

// Fixtures de catalogo inactivos con registro de limpieza por codigo.
const createdCategories = [];
const createdSubcategories = [];
const createdUnits = [];
let fixtureCodes = null;

before(async () => {
  ({ baseUrl } = await harness.start());
  const { jar } = await harness.loginThroughGoogle({ sub: testSub('catalogs') });
  authJar = jar;
});

after(async () => {
  // Limpieza FK-safe: subcategorias antes que categorias; unidades solas.
  if (createdSubcategories.length > 0) {
    await db.query('DELETE FROM subcategories WHERE code = ANY($1)', [createdSubcategories]);
  }
  if (createdCategories.length > 0) {
    await db.query('DELETE FROM categories WHERE code = ANY($1)', [createdCategories]);
  }
  if (createdUnits.length > 0) {
    await db.query('DELETE FROM municipal_units WHERE code = ANY($1)', [createdUnits]);
  }

  await harness.stop();
});

async function fetchCategories() {
  return fetch(`${baseUrl}/api/v1/categories`, { headers: { Cookie: authJar.header() } });
}

async function fetchMunicipalUnits() {
  return fetch(`${baseUrl}/api/v1/municipal-units`, { headers: { Cookie: authJar.header() } });
}

/**
 * Inserta: una categoria inactiva con subcategoria, una categoria activa cuya
 * unica subcategoria esta inactiva, y una unidad municipal inactiva. Todas
 * con codigos unicos por sufijo aleatorio.
 */
async function insertInactiveCatalogFixtures() {
  const suffix = crypto.randomBytes(4).toString('hex');
  fixtureCodes = {
    inactiveCategory: `TEST_INACTIVE_CAT_${suffix}`,
    inactiveSubcategory: `TEST_INACTIVE_SUB_${suffix}`,
    activeCategory: `TEST_ACTIVE_CAT_${suffix}`,
    inactiveSubcategoryOfActive: `TEST_INACTIVE_SUB2_${suffix}`,
    inactiveUnit: `TEST_INACTIVE_UNIT_${suffix}`,
  };
  createdCategories.push(fixtureCodes.inactiveCategory, fixtureCodes.activeCategory);
  createdSubcategories.push(fixtureCodes.inactiveSubcategory, fixtureCodes.inactiveSubcategoryOfActive);
  createdUnits.push(fixtureCodes.inactiveUnit);

  await db.transaction(async (client) => {
    const { rows: inactiveCategoryRows } = await client.query(
      'INSERT INTO categories (code, name, active, sort_order) VALUES ($1, $2, FALSE, 1000) RETURNING id',
      [fixtureCodes.inactiveCategory, `Categoria Inactiva ${suffix}`]
    );
    await client.query(
      'INSERT INTO subcategories (category_id, code, name, active) VALUES ($1, $2, $3, FALSE)',
      [inactiveCategoryRows[0].id, fixtureCodes.inactiveSubcategory, `Subcategoria Inactiva ${suffix}`]
    );

    const { rows: activeCategoryRows } = await client.query(
      'INSERT INTO categories (code, name, sort_order) VALUES ($1, $2, 1000) RETURNING id',
      [fixtureCodes.activeCategory, `Zategoria Activa ${suffix}`]
    );
    await client.query(
      'INSERT INTO subcategories (category_id, code, name, active, sort_order) VALUES ($1, $2, $3, FALSE, 1000)',
      [activeCategoryRows[0].id, fixtureCodes.inactiveSubcategoryOfActive, `Subcategoria Oculta ${suffix}`]
    );

    await client.query(
      'INSERT INTO municipal_units (code, name, active) VALUES ($1, $2, FALSE)',
      [fixtureCodes.inactiveUnit, `Unidad Inactiva ${suffix}`]
    );
  });
}

describe('GET /api/v1/categories', () => {
  test('responde 401 sin sesion', async () => {
    const response = await fetch(`${baseUrl}/api/v1/categories`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
  });

  test('devuelve el arbol de categorias activas en orden por sort_order', async () => {
    const response = await fetchCategories();
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(Array.isArray(body.categories));

    // Orden relativo de las categorias del seed (robusto ante filas nuevas).
    const seedCategories = body.categories.filter((category) =>
      EXPECTED_CATEGORY_ORDER.includes(category.code)
    );
    assert.deepEqual(
      seedCategories.map((category) => category.code),
      EXPECTED_CATEGORY_ORDER
    );
  });

  test('agrupa y ordena las subcategorias activas por categoria', async () => {
    const body = await (await fetchCategories()).json();
    const seedCategories = body.categories.filter((category) =>
      EXPECTED_CATEGORY_ORDER.includes(category.code)
    );

    assert.equal(seedCategories.length, 5);
    for (const category of seedCategories) {
      assert.equal(
        category.subcategories.length,
        EXPECTED_SUBCATEGORY_COUNTS[category.code],
        `subcategorias de ${category.code}`
      );

      const orders = category.subcategories.map((s) => s.sortOrder);
      const sorted = [...orders].sort((a, b) => a - b);
      assert.deepEqual(orders, sorted, `orden de subcategorias de ${category.code}`);
    }

    const vialidad = seedCategories.find((c) => c.code === 'VIALIDAD_CALLES');
    assert.equal(vialidad.subcategories[0].code, 'BACHES_PAVIMENTO');
  });

  test('normaliza las claves a camelCase sin campos internos', async () => {
    const body = await (await fetchCategories()).json();
    const category = body.categories[0];

    assert.deepEqual(
      Object.keys(category).sort(),
      ['code', 'description', 'id', 'name', 'sortOrder', 'subcategories']
    );
    assert.deepEqual(
      Object.keys(category.subcategories[0]).sort(),
      ['code', 'description', 'id', 'name', 'sortOrder']
    );
  });

  test('excluye categorias y subcategorias inactivas', async () => {
    await insertInactiveCatalogFixtures();

    const body = await (await fetchCategories()).json();
    const categoryCodes = body.categories.map((category) => category.code);
    const subcategoryCodes = body.categories.flatMap((category) =>
      category.subcategories.map((s) => s.code)
    );

    assert.ok(!categoryCodes.includes(fixtureCodes.inactiveCategory));
    assert.ok(!subcategoryCodes.includes(fixtureCodes.inactiveSubcategory));

    // La categoria activa de prueba aparece, pero sin su subcategoria inactiva.
    const activeCategory = body.categories.find((c) => c.code === fixtureCodes.activeCategory);
    assert.ok(activeCategory, 'la categoria activa de prueba debe aparecer');
    assert.deepEqual(activeCategory.subcategories, []);
  });
});

describe('GET /api/v1/municipal-units', () => {
  test('responde 401 sin sesion', async () => {
    const response = await fetch(`${baseUrl}/api/v1/municipal-units`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'UNAUTHENTICATED');
  });

  test('devuelve unidades activas ordenadas por nombre', async () => {
    const response = await fetchMunicipalUnits();
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(Array.isArray(body.municipalUnits));
    assert.ok(body.municipalUnits.length >= 12);
    assert.ok(body.municipalUnits.some((unit) => unit.code === 'OBRAS_PUBLICAS'));

    // El orden coincide con el ORDER BY del repositorio (mismo SQL).
    const { rows } = await db.query(
      'SELECT code FROM municipal_units WHERE active = TRUE ORDER BY name ASC'
    );
    assert.deepEqual(
      body.municipalUnits.map((unit) => unit.code),
      rows.map((row) => row.code)
    );
  });

  test('incluye solo id, code y name por unidad', async () => {
    const body = await (await fetchMunicipalUnits()).json();
    for (const unit of body.municipalUnits) {
      assert.deepEqual(Object.keys(unit).sort(), ['code', 'id', 'name']);
    }
  });

  test('excluye unidades municipales inactivas', async () => {
    await insertInactiveCatalogFixtures();

    const body = await (await fetchMunicipalUnits()).json();
    const unitCodes = body.municipalUnits.map((unit) => unit.code);
    assert.ok(!unitCodes.includes(fixtureCodes.inactiveUnit));
  });
});

describe('minimizacion de datos en catalogos', () => {
  test('las respuestas no exponen datos privados ni de identidad', async () => {
    const categoriesText = await (await fetchCategories()).text();
    const unitsText = await (await fetchMunicipalUnits()).text();

    for (const text of [categoriesText, unitsText]) {
      assert.ok(!text.includes('@'), 'sin correos');
      assert.ok(!text.includes('email'), 'sin campo email');
      assert.ok(!text.includes('provider'), 'sin datos de proveedor de identidad');
      assert.ok(!text.includes('sub"'), 'sin provider_subject');
    }
  });
});
