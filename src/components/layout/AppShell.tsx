import { useEffect, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'

export function AppShell() {
  const mainRef = useRef<HTMLElement>(null)
  const location = useLocation()

  useEffect(() => {
    mainRef.current?.focus()
  }, [location.pathname])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main ref={mainRef} className="flex-1 overflow-auto p-6 outline-none" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  )
}
