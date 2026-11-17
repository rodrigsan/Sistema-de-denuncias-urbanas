import { describe, expect, it } from 'vitest'
import { formatDateTime, formatFileSize, formatSeconds } from '../lib/utils.js'

describe('formatDateTime', () => {
  it('formatea una fecha ISO en locale es-BO', () => {
    const result = formatDateTime('2026-10-12T10:30:00Z')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('devuelve guion em para null/undefined/vacio', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(formatDateTime('')).toBe('—')
  })

  it('no lanza para fechas validas', () => {
    expect(() => formatDateTime(new Date().toISOString())).not.toThrow()
  })
})

describe('formatFileSize', () => {
  it('formatea bytes', () => {
    expect(formatFileSize(500)).toBe('500 B')
    expect(formatFileSize(1023)).toBe('1023 B')
  })

  it('formatea kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB')
    expect(formatFileSize(512 * 1024)).toBe('512.0 KB')
  })

  it('formatea megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB')
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('devuelve cadena vacia para valores no finitos', () => {
    expect(formatFileSize(null)).toBe('')
    expect(formatFileSize(undefined)).toBe('')
    expect(formatFileSize(NaN)).toBe('')
  })
})

describe('formatSeconds', () => {
  it('formatea 180 segundos como 03:00', () => {
    expect(formatSeconds(180)).toBe('03:00')
  })

  it('formatea 0 segundos como 00:00', () => {
    expect(formatSeconds(0)).toBe('00:00')
  })

  it('formatea 59 segundos como 00:59', () => {
    expect(formatSeconds(59)).toBe('00:59')
  })

  it('formatea 65 segundos como 01:05', () => {
    expect(formatSeconds(65)).toBe('01:05')
  })

  it('congela negativos a 00:00', () => {
    expect(formatSeconds(-5)).toBe('00:00')
    expect(formatSeconds(-100)).toBe('00:00')
  })

  it('trunca decimales al entero inferior', () => {
    expect(formatSeconds(59.9)).toBe('00:59')
    expect(formatSeconds(180.7)).toBe('03:00')
  })
})
