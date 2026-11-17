import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { HistoricalMapPage } from '../pages/HistoricalMapPage.jsx'

const { heatLayerAddTo, map } = vi.hoisted(() => {
  const heatLayerAddTo = vi.fn()
  const map = { fitBounds: vi.fn(), removeLayer: vi.fn() }
  return { heatLayerAddTo, map }
})

vi.mock('../lib/api.js', () => ({
  apiFetch: vi.fn(),
}))

vi.mock('leaflet.heat', () => ({
  HeatLayer: vi.fn(
    class HeatLayerMock {
      addTo = heatLayerAddTo
    },
  ),
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => <div data-testid="map">{children}</div>,
  TileLayer: () => null,
  useMap: () => map,
}))

import { apiFetch } from '../lib/api.js'
import { HeatLayer } from 'leaflet.heat'

describe('HistoricalMapPage', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renderiza el mapa y crea la capa de calor cuando hay puntos históricos', async () => {
    vi.mocked(apiFetch).mockImplementation((path) => {
      if (path === '/categories') {
        return Promise.resolve({
          ok: true,
          data: {
            categories: [
              {
                id: 'roads',
                name: 'Vías',
                subcategories: [{ id: 'potholes', name: 'Baches' }],
              },
            ],
          },
        })
      }
      if (path.startsWith('/reports/summary')) {
        return Promise.resolve({
          ok: true,
          data: { total: 1, resolved: 0, percentage: 0, categories: 1 },
        })
      }
      if (path.startsWith('/reports/heatmap')) {
        return Promise.resolve({
          ok: true,
          data: { points: [{ latitude: -17.39, longitude: -66.15 }] },
        })
      }
      if (path.startsWith('/reports/categories')) {
        return Promise.resolve({ ok: true, data: [] })
      }
      return Promise.resolve({ ok: true, data: [] })
    })

    render(
      <MemoryRouter>
        <HistoricalMapPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Mapa Histórico de Denuncias')).toBeInTheDocument()
    expect(await screen.findByTestId('map')).toBeInTheDocument()
    expect(await screen.findByRole('option', { name: 'Vías' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Baches' })).toBeInTheDocument()

    await waitFor(() => {
      expect(HeatLayer).toHaveBeenCalledWith(
        [[-17.39, -66.15, 1]],
        expect.objectContaining({ radius: 22, blur: 14 }),
      )
      expect(heatLayerAddTo).toHaveBeenCalledWith(map)
    })
  })
})
