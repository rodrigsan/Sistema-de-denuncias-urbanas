/**
 * Step definitions para el escenario de health check.
 *
 * Utiliza fetch nativo para consumir el endpoint real de la API, sin
 * modificar rutas, controladores ni la base de datos.
 */
import { Before, After, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { startServer, stopServer, getBaseUrl } from '../support/server.js';

let response = null;
let responseBody = null;

Before(async () => {
  await startServer();
});

After(async () => {
  await stopServer();
  response = null;
  responseBody = null;
});

Given('the API server is running', function () {
  // El servidor se inicia en el hook Before. Este paso es documental.
  return undefined;
});

When('I query the endpoint {string}', async (endpoint) => {
  const baseUrl = getBaseUrl().replace(/\/$/, '');
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${path}`;
  response = await fetch(url);
  responseBody = await response.json();
});

Then('the response code is {int}', function (statusCode) {
  assert.equal(response.status, statusCode);
});

Then('the body responds with status {string}', function (expectedStatus) {
  assert.equal(responseBody.status, expectedStatus);
});

Then('the service name is {string}', function (expectedService) {
  assert.equal(responseBody.service, expectedService);
});
