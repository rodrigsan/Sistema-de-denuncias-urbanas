import { describe, expect, it } from 'vitest'
import { encodePlusCode } from '../lib/pluscode.js'

// Coordenadas de referencia (Cercado, Cochabamba).
const COCHABAMBA = { latitude: -17.3936, longitude: -66.157 }
const NORTE = { latitude: -17.27, longitude: -66.08 }
const SUR = { latitude: -17.45, longitude: -66.22 }

describe('encodePlusCode', () => {
  it('genera un Plus Code completo (10 digitos, formato OLC)', () => {
    const code = encodePlusCode(COCHABAMBA.latitude, COCHABAMBA.longitude)
    expect(code).toMatch(/^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}/)
    expect(code).toHaveLength(11)
  })

  it('genera el mismo codigo para las mismas coordenadas (determinista)', () => {
    const a = encodePlusCode(COCHABAMBA.latitude, COCHABAMBA.longitude)
    const b = encodePlusCode(COCHABAMBA.latitude, COCHABAMBA.longitude)
    expect(a).toBe(b)
  })

  it('genera codigos distintos para coordenadas distantes', () => {
    const centro = encodePlusCode(COCHABAMBA.latitude, COCHABAMBA.longitude)
    const norte = encodePlusCode(NORTE.latitude, NORTE.longitude)
    const sur = encodePlusCode(SUR.latitude, SUR.longitude)
    expect(centro).not.toBe(norte)
    expect(centro).not.toBe(sur)
    expect(norte).not.toBe(sur)
  })

  it('genera codigos dentro del prefijo de Cercado (Zona J, grid 57JM)', () => {
    const code = encodePlusCode(COCHABAMBA.latitude, COCHABAMBA.longitude)
    expect(code.startsWith('57JM')).toBe(true)
  })

  it('el codigo del sur comparte los primeros 4 caracteres con el del centro', () => {
    const centro = encodePlusCode(COCHABAMBA.latitude, COCHABAMBA.longitude)
    const sur = encodePlusCode(SUR.latitude, SUR.longitude)
    expect(centro.slice(0, 4)).toBe(sur.slice(0, 4))
  })
})
