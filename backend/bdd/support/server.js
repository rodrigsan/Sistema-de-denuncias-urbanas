/**
 * Gestor del ciclo de vida del servidor Express para pruebas BDD.
 *
 * Inicia la aplicacion en un puerto efimero antes de los escenarios y la
 * detiene al finalizar. Reutiliza la misma factoría createApp que el resto
 * del sistema, sin modificar rutas, controladores ni la base de datos.
 */
import { createApp } from '../../src/app.js';
import { db } from '../../src/config/database.js';
import { env } from '../../src/config/env.js';

let server = null;
let baseUrl = null;

export async function startServer() {
  const app = createApp({ db, config: env });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}`;
  return baseUrl;
}

export async function stopServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
    baseUrl = null;
  }
}

export function getBaseUrl() {
  if (!baseUrl) {
    throw new Error('El servidor no ha sido iniciado. Llame a startServer() primero.');
  }
  return baseUrl;
}
