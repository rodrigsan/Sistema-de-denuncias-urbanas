import { describe, expect, it } from 'vitest'
import { aliasSchema, complaintFormSchema, validateSchema } from '../lib/validation.js'
import { EVIDENCE_LIMITS } from '../lib/constants.js'

describe('aliasSchema', () => {
  it('acepta un alias de 3 caracteres', () => {
    const result = aliasSchema.safeParse('abc')
    expect(result.success).toBe(true)
  })

  it('acepta un alias de 60 caracteres', () => {
    const result = aliasSchema.safeParse('a'.repeat(60))
    expect(result.success).toBe(true)
  })

  it('rechaza un alias de 2 caracteres', () => {
    const result = aliasSchema.safeParse('ab')
    expect(result.success).toBe(false)
  })

  it('rechaza un alias de 61 caracteres', () => {
    const result = aliasSchema.safeParse('a'.repeat(61))
    expect(result.success).toBe(false)
  })

  it('hace trim de espacios al inicio y fin', () => {
    const result = aliasSchema.safeParse('  alias  ')
    expect(result.success).toBe(true)
    expect(result.data).toBe('alias')
  })

  it('rechaza cadena vacia o solo espacios', () => {
    expect(aliasSchema.safeParse('').success).toBe(false)
    expect(aliasSchema.safeParse('   ').success).toBe(false)
  })
})

describe('complaintFormSchema', () => {
  const VALID = {
    title: 'Bache en la avenida',
    description: 'Hay un bache grande en la via principal.',
    categoryId: '00000000-0000-0000-0000-000000000001',
    subcategoryId: '00000000-0000-0000-0000-000000000002',
    latitude: -17.39,
    longitude: -66.15,
  }

  it('acepta datos validos completos', () => {
    const result = complaintFormSchema.safeParse(VALID)
    expect(result.success).toBe(true)
  })

  describe('titulo (3-180)', () => {
    it('rechaza titulo de 2 caracteres', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, title: 'ab' })
      expect(result.success).toBe(false)
    })

    it('acepta titulo de 3 caracteres', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, title: 'abc' })
      expect(result.success).toBe(true)
    })

    it('acepta titulo de 180 caracteres', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, title: 'a'.repeat(180) })
      expect(result.success).toBe(true)
    })

    it('rechaza titulo de 181 caracteres', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, title: 'a'.repeat(181) })
      expect(result.success).toBe(false)
    })
  })

  describe('descripcion (10-5000)', () => {
    it('rechaza descripcion de 9 caracteres', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, description: 'a'.repeat(9) })
      expect(result.success).toBe(false)
    })

    it('acepta descripcion de 10 caracteres', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, description: 'a'.repeat(10) })
      expect(result.success).toBe(true)
    })

    it('acepta descripcion de 5000 caracteres', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, description: 'a'.repeat(5000) })
      expect(result.success).toBe(true)
    })

    it('rechaza descripcion de 5001 caracteres', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, description: 'a'.repeat(5001) })
      expect(result.success).toBe(false)
    })
  })

  describe('coordenadas', () => {
    it('rechaza latitud fuera de rango', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, latitude: 95 })
      expect(result.success).toBe(false)
    })

    it('rechaza longitud fuera de rango', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, longitude: -200 })
      expect(result.success).toBe(false)
    })

    it('acepta latitud y longitud validas de Cercado', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, latitude: -17.39, longitude: -66.16 })
      expect(result.success).toBe(true)
    })
  })

  describe('categoria y subcategoria', () => {
    it('rechaza categoryId vacio', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, categoryId: '' })
      expect(result.success).toBe(false)
    })

    it('rechaza subcategoryId vacio', () => {
      const result = complaintFormSchema.safeParse({ ...VALID, subcategoryId: '' })
      expect(result.success).toBe(false)
    })
  })
})

describe('validateSchema', () => {
  it('devuelve ok:true y data para valores validos', () => {
    const result = validateSchema(aliasSchema, '  Vecino  ')
    expect(result.ok).toBe(true)
    expect(result.data).toBe('Vecino')
    expect(result.fieldErrors).toBeNull()
  })

  it('devuelve ok:false y fieldErrors para valores invalidos', () => {
    const result = validateSchema(aliasSchema, 'ab')
    expect(result.ok).toBe(false)
    expect(result.data).toBeNull()
    expect(result.fieldErrors).toBeTruthy()
    expect(typeof result.fieldErrors).toBe('object')
  })
})

describe('EVIDENCE_LIMITS', () => {
  it('limite de 3 imagenes', () => {
    expect(EVIDENCE_LIMITS.maxImages).toBe(3)
  })

  it('limite de 1 video', () => {
    expect(EVIDENCE_LIMITS.maxVideos).toBe(1)
  })

  it('limite de 5 MB por imagen', () => {
    expect(EVIDENCE_LIMITS.maxImageMb).toBe(5)
  })

  it('limite de 50 MB por video', () => {
    expect(EVIDENCE_LIMITS.maxVideoMb).toBe(50)
  })

  it('limite de 30 segundos de video', () => {
    expect(EVIDENCE_LIMITS.maxVideoSeconds).toBe(30)
  })
})
