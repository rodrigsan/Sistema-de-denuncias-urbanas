/**
 * Logger minimo y sin dependencias.
 *
 * Regla de seguridad: quien invoque al logger es responsable de no incluir
 * contrasenas, tokens OAuth, cookies de sesion, correos de ciudadanos,
 * URLs firmadas ni el contenido completo de denuncias.
 */
function write(level, message, meta) {
  const entry = {
    level,
    time: new Date().toISOString(),
    message,
  };

  if (meta !== undefined) {
    entry.meta = meta;
  }

  const line = JSON.stringify(entry);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(message, meta) {
    write('info', message, meta);
  },
  warn(message, meta) {
    write('warn', message, meta);
  },
  error(message, meta) {
    write('error', message, meta);
  },
};
