import OpenLocationCodeModule from 'open-location-code'

// Interop CJS/ESM igual que en el backend.
const OpenLocationCode = OpenLocationCodeModule.OpenLocationCode ?? OpenLocationCodeModule
const olc = new OpenLocationCode()

/**
 * Plus Code completo (10 digitos) para unas coordenadas. El backend lo
 * revalida en servidor; aqui solo se calcula para el envio inicial.
 */
export function encodePlusCode(latitude, longitude) {
  return olc.encode(latitude, longitude)
}
