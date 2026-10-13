import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { PublicLayout } from './components/layout/PublicLayout.jsx'
import {
  RequireCitizen,
  RequireModerator,
  RequireLiaison,
  RequireSession,
} from './components/routing/RouteGuards.jsx'
import { LandingPage } from './pages/LandingPage.jsx'
import { AuthCallbackPage } from './pages/AuthCallbackPage.jsx'
import { AliasPage } from './pages/AliasPage.jsx'
import { NewComplaintPage } from './pages/NewComplaintPage.jsx'
import { MyComplaintsPage } from './pages/MyComplaintsPage.jsx'
import { ComplaintDetailPage } from './pages/ComplaintDetailPage.jsx'
import { NotFoundPage } from './pages/NotFoundPage.jsx'
import { PageLoader } from './components/routing/RouteGuards.jsx'

// Code-splitting: Leaflet solo se descarga al entrar a vistas administrativas.
const ModerationPage = lazy(() =>
  import('./pages/ModerationPage.jsx').then((m) => ({ default: m.ModerationPage })),
)
const TechnicalPage = lazy(() =>
  import('./pages/TechnicalPage.jsx').then((m) => ({ default: m.TechnicalPage })),
)

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route
          path="/auth/alias"
          element={
            <RequireSession>
              <AliasPage />
            </RequireSession>
          }
        />
        <Route
          path="/denuncias/nueva"
          element={
            <RequireCitizen>
              <NewComplaintPage />
            </RequireCitizen>
          }
        />
        <Route
          path="/mis-denuncias"
          element={
            <RequireCitizen>
              <MyComplaintsPage />
            </RequireCitizen>
          }
        />
        <Route
          path="/mis-denuncias/:id"
          element={
            <RequireCitizen>
              <ComplaintDetailPage />
            </RequireCitizen>
          }
        />
        <Route
          path="/moderacion"
          element={
            <RequireModerator>
              <Suspense fallback={<PageLoader label="Cargando bandeja…" />}>
                <ModerationPage />
              </Suspense>
            </RequireModerator>
          }
        />
        <Route
          path="/tecnico"
          element={
            <RequireLiaison>
              <Suspense fallback={<PageLoader label="Cargando atención técnica…" />}>
                <TechnicalPage />
              </Suspense>
            </RequireLiaison>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
