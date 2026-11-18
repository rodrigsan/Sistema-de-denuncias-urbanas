/**
 * Configuracion de Cucumber para JavaScript (ES modules).
 *
 * Lee los archivos .feature de backend/bdd/features, ejecuta los pasos
 * definidos en backend/bdd/step-definitions y genera un reporte JSON
 * en backend/bdd/reports/ para integracion con herramientas de CI.
 */
export default {
  require: [
    'bdd/step-definitions/*.js',
    'bdd/support/*.js',
  ],
  features: ['bdd/features/*.feature'],
  format: [
    'progress-bar',
    'json:bdd/reports/cucumber.json',
    'html:bdd/reports/cucumber.html',
  ],
  name: [],
  tags: '',
  publishQuiet: true,
  strict: true,
};
