import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, cleanup } from '@testing-library/react'
import { GraceCountdown } from '../components/complaints/GraceCountdown.jsx'

// El hook usa setInterval; para el test de render inicial no necesitamos
// avanzar el reloj, solo verificar el formato del contador en 180 s y
// el estado congelado (PAUSED_FOR_EDIT).

describe('GraceCountdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    cleanup()
  })

  it('renderiza 03:00 con 180 segundos en estado RUNNING', () => {
    render(<GraceCountdown grace={{ remainingSeconds: 180, state: 'RUNNING' }} onExpire={() => {}} />)
    expect(screen.getByText('03:00')).toBeInTheDocument()
  })

  it('renderiza 00:59 con 59 segundos', () => {
    render(<GraceCountdown grace={{ remainingSeconds: 59, state: 'RUNNING' }} onExpire={() => {}} />)
    expect(screen.getByText('00:59')).toBeInTheDocument()
  })

  it('renderiza 00:00 con 0 segundos', () => {
    render(<GraceCountdown grace={{ remainingSeconds: 0, state: 'RUNNING' }} onExpire={() => {}} />)
    expect(screen.getByText('00:00')).toBeInTheDocument()
  })

  it('muestra "Edicion en curso - tiempo congelado" en PAUSED_FOR_EDIT', () => {
    render(<GraceCountdown grace={{ remainingSeconds: 100, state: 'PAUSED_FOR_EDIT' }} onExpire={() => {}} />)
    expect(screen.getByText(/Edición en curso/)).toBeInTheDocument()
    expect(screen.getByText('01:40')).toBeInTheDocument()
  })

  it('sincroniza el contador al cancelar una edición y reanudar la gracia', () => {
    const onExpire = vi.fn()
    const { rerender, unmount } = render(
      <GraceCountdown grace={{ remainingSeconds: 180, state: 'RUNNING' }} onExpire={onExpire} />,
    )

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(screen.getByText('02:55')).toBeInTheDocument()

    rerender(
      <GraceCountdown grace={{ remainingSeconds: 170, state: 'PAUSED_FOR_EDIT' }} onExpire={onExpire} />,
    )
    expect(screen.getByText('02:50')).toBeInTheDocument()

    rerender(
      <GraceCountdown grace={{ remainingSeconds: 170, state: 'RUNNING' }} onExpire={onExpire} />,
    )
    expect(screen.getByText('02:50')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(screen.getByText('02:49')).toBeInTheDocument()
    unmount()
  })

  it('usa rojo (state-danger) cuando quedan <= 30 segundos', () => {
    render(<GraceCountdown grace={{ remainingSeconds: 25, state: 'RUNNING' }} onExpire={() => {}} />)
    const timer = screen.getByText('00:25')
    expect(timer.className).toContain('text-state-danger')
  })

  it('usa ambar (state-caution) cuando quedan > 30 segundos', () => {
    render(<GraceCountdown grace={{ remainingSeconds: 60, state: 'RUNNING' }} onExpire={() => {}} />)
    const timer = screen.getByText('01:00')
    expect(timer.className).toContain('text-state-caution')
  })

  it('dispara onExpire cuando el contador llega a cero', async () => {
    const onExpire = vi.fn()
    render(<GraceCountdown grace={{ remainingSeconds: 1, state: 'RUNNING' }} onExpire={onExpire} />)

    // Avanzar 1.5 segundos de reloj virtual para que el intervalo dispare.
    vi.advanceTimersByTime(1500)
    expect(onExpire).toHaveBeenCalled()
  })

  it('renderiza la barra de progreso con valor 180', () => {
    render(<GraceCountdown grace={{ remainingSeconds: 180, state: 'RUNNING' }} onExpire={() => {}} />)
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '180')
    expect(bar).toHaveAttribute('aria-valuemax', '180')
  })
})
