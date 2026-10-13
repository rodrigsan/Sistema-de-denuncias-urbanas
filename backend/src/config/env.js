import dotenv from 'dotenv';

// Carga .env en desarrollo. En produccion las variables se inyectan por el entorno.
dotenv.config();

const REQUIRED_KEYS = ['DATABASE_URL', 'SESSION_SECRET'];
const PRODUCTION_REQUIRED_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
];
const DEFAULT_SESSION_COOKIE_NAME = 'denuncias_session';
const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';
const PLACEHOLDER_SECRET = 'REEMPLAZAR_POR_UN_SECRETO_LARGO_ALEATORIO';

const OPTIONAL_INTEGER_SETTINGS = [
  { key: 'SESSION_TTL_SECONDS', defaultValue: 28800, min: 60, max: 2592000 },
  { key: 'GENERAL_RATE_LIMIT_MAX', defaultValue: 100, min: 1, max: 100000 },
  { key: 'AUTH_RATE_LIMIT_MAX', defaultValue: 10, min: 1, max: 100000 },
  { key: 'EVIDENCE_MAX_IMAGES', defaultValue: 3, min: 1, max: 10 },
  { key: 'EVIDENCE_MAX_IMAGE_MB', defaultValue: 5, min: 1, max: 100 },
  { key: 'EVIDENCE_MAX_VIDEOS', defaultValue: 1, min: 1, max: 10 },
  { key: 'EVIDENCE_MAX_VIDEO_MB', defaultValue: 50, min: 1, max: 2048 },
  { key: 'EVIDENCE_MAX_VIDEO_SECONDS', defaultValue: 30, min: 5, max: 600 },
  { key: 'DUPLICATE_SEARCH_RADIUS_METERS', defaultValue: 100, min: 10, max: 500 },
];

const DEFAULT_STORAGE_DIRECTORY = './storage';

function parseBooleanSetting(source, { key, defaultValue }) {
  const raw = source[key];
  if (raw === undefined || String(raw).trim() === '') return defaultValue;
  const value = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(value)) return true;
  if (['false', '0', 'no'].includes(value)) return false;
  const error = new Error(`Configuracion invalida: ${key} debe ser true o false.`);
  error.code = 'INVALID_CONFIG';
  throw error;
}

function parseIntegerSetting(source, { key, defaultValue, min, max }) {
  const raw = source[key];
  if (raw === undefined || String(raw).trim() === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    const error = new Error(
      `Configuracion invalida: ${key} debe ser un numero entero entre ${min} y ${max}.`
    );
    error.code = 'INVALID_CONFIG';
    throw error;
  }
  return value;
}

/**
 * Construye y valida la configuracion de la aplicacion sin exponer secretos.
 *
 * @param {NodeJS.ProcessEnv|Record<string,string|undefined>} source
 */
export function loadEnv(source = process.env) {
  const missing = REQUIRED_KEYS.filter((key) => {
    const value = source[key];
    return value === undefined || String(value).trim() === '';
  });

  if (missing.length > 0) {
    // Solo se nombran las variables faltantes: nunca se imprimen sus valores.
    const error = new Error(
      `Configuracion invalida: faltan variables de entorno requeridas: ${missing.join(', ')}`
    );
    error.code = 'INVALID_CONFIG';
    throw error;
  }

  const nodeEnv = source.NODE_ENV || 'development';
  const sessionSecret = String(source.SESSION_SECRET);
  const isProduction = nodeEnv === 'production';

  if (isProduction && sessionSecret === PLACEHOLDER_SECRET) {
    const error = new Error(
      'Configuracion invalida: SESSION_SECRET no puede usar el valor de ejemplo en produccion.'
    );
    error.code = 'INVALID_CONFIG';
    throw error;
  }

  // Las credenciales de Google son obligatorias solo en produccion. En
  // desarrollo se permiten vacias: /auth/google/login responde 503 hasta que
  // se configuren, y las pruebas usan un servicio simulado.
  if (isProduction) {
    const missingGoogle = PRODUCTION_REQUIRED_KEYS.filter((key) => {
      const value = source[key];
      return value === undefined || String(value).trim() === '';
    });
    if (missingGoogle.length > 0) {
      const error = new Error(
        `Configuracion invalida: en produccion se requieren las variables: ${missingGoogle.join(', ')}`
      );
      error.code = 'INVALID_CONFIG';
      throw error;
    }
  }

  const port = Number(source.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    const error = new Error('Configuracion invalida: PORT debe ser un numero de puerto valido.');
    error.code = 'INVALID_CONFIG';
    throw error;
  }

  const settings = {};
  for (const setting of OPTIONAL_INTEGER_SETTINGS) {
    settings[setting.key] = parseIntegerSetting(source, setting);
  }

  return Object.freeze({
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: String(source.DATABASE_URL),
    FRONTEND_ORIGIN: source.FRONTEND_ORIGIN || DEFAULT_FRONTEND_ORIGIN,
    SESSION_COOKIE_NAME: source.SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME,
    SESSION_SECRET: sessionSecret,
    GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID || '',
    GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET || '',
    GOOGLE_REDIRECT_URI:
      source.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/v1/auth/google/callback',
    STORAGE_DIRECTORY: source.STORAGE_DIRECTORY || DEFAULT_STORAGE_DIRECTORY,
    GRACE_SWEEP_ENABLED: parseBooleanSetting(source, {
      key: 'GRACE_SWEEP_ENABLED',
      defaultValue: true,
    }),
    isProduction,
    ...settings,
  });
}

// Configuracion validada al importar. Falla rapido y con mensaje claro si falta algo.
export const env = loadEnv();
