import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '../components/complaints/StatusBadge.jsx'

describe('StatusBadge', () => {
  it('renderiza "Resuelta" con tono verde (state-success)', () => {
    render(<StatusBadge status="RESOLVED" />)
    const badge = screen.getByText('Resuelta')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('state-success')
  })

  it('renderiza "Rechazada" con tono rojo (state-danger)', () => {
    render(<StatusBadge status="REJECTED" />)
    const badge = screen.getByText('Rechazada')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('state-danger')
  })

  it('renderiza "En ventana de gracia" con tono ambar (state-caution)', () => {
    render(<StatusBadge status="GRACE_PERIOD" />)
    const badge = screen.getByText('En ventana de gracia')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('state-caution')
  })

  it('renderiza "Pendiente de revision" con tono ambar', () => {
    render(<StatusBadge status="PENDING_REVIEW" />)
    const badge = screen.getByText('Pendiente de revisión')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('state-caution')
  })

  it('renderiza "Asignada a unidad" con tono naranja (state-warning)', () => {
    render(<StatusBadge status="ASSIGNED" />)
    const badge = screen.getByText('Asignada a unidad')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('state-warning')
  })

  it('renderiza "En atencion" con tono naranja', () => {
    render(<StatusBadge status="IN_PROGRESS" />)
    const badge = screen.getByText('En atención')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('state-warning')
  })

  it('renderiza un estado desconocido con tono ambar por defecto', () => {
    render(<StatusBadge status="UNKNOWN_STATE" />)
    const badge = screen.getByText('UNKNOWN_STATE')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('state-caution')
  })

  it('renderiza un badge con mayusculas y tracking ancho (uppercase tracking-wide)', () => {
    render(<StatusBadge status="RESOLVED" />)
    const badge = screen.getByText('Resuelta')
    expect(badge.className).toContain('uppercase')
    expect(badge.className).toContain('tracking-wide')
  })
})
