/**
 * Utilidades para las pruebas de integracion: arranque de la app en un puerto
 * efimero, cookie-jar manual (fetch de Node no guarda cookies) y lectura de
 * cookies firmadas de cookie-parser para extraer el state del flujo OAuth.
 */

/**
 * Decodifica el contenido de una cookie firmada por cookie-parser
 * (formato "s:<payload>.<firma>"). Devuelve el payload ya parseado.
 */
export function parseSignedCookieValue(rawValue) {
  if (!rawValue) return null;
  const withoutPrefix = rawValue.startsWith('s:') ? rawValue.slice(2) : rawValue;
  const signatureIndex = withoutPrefix.lastIndexOf('.');
  if (signatureIndex === -1) return null;
  try {
    return JSON.parse(withoutPrefix.slice(0, signatureIndex));
  } catch {
    return null;
  }
}

export class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  absorb(response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(';');
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex === -1) continue;

      const name = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      const isExpired = /expires=thu, 01 jan 1970/i.test(header) || /max-age=0/i.test(header);

      if (isExpired) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, decodeURIComponent(value));
      }
    }
  }

  get(name) {
    return this.cookies.get(name) ?? null;
  }

  has(name) {
    return this.cookies.has(name);
  }

  setRaw(name, value) {
    this.cookies.set(name, value);
  }

  header() {
    return [...this.cookies]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join('; ');
  }
}

export async function listenApp(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}
