import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { TopBar } from './TopBar.jsx'
import { Navbar } from './Navbar.jsx'
import { Footer } from './Footer.jsx'
import { SidebarDrawer } from './SidebarDrawer.jsx'

/**
 * Layout publico: franja institucional, navbar con toggle del menu lateral,
 * contenido de la ruta activa y pie institucional.
 */
export function PublicLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar />
      <Navbar onOpenDrawer={() => setDrawerOpen(true)} />
      <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <main className="flex-1">
        <Outlet />
      </main>

      <Footer />
    </div>
  )
}
