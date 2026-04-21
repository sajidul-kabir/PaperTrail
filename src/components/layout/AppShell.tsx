import { useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { usePurchaseMinimize } from '@/lib/purchase-minimize'

export function AppShell() {
  const mainRef = useRef<HTMLElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { minimized } = usePurchaseMinimize()

  useEffect(() => {
    mainRef.current?.focus()
  }, [location.pathname])

  function handleRestore() {
    // Navigate to purchases — the component will detect minimized state and restore
    if (location.pathname !== '/purchases') {
      navigate('/purchases', { state: { restorePurchase: true } })
    } else {
      // Already on purchases page — trigger a re-render by navigating with state
      navigate('/purchases', { state: { restorePurchase: true }, replace: true })
    }
  }

  return (
    <div className="flex h-screen overflow-hidden print:h-auto print:overflow-visible print:block">
      <div className="print-hide h-full"><Sidebar /></div>
      <main ref={mainRef} className="flex-1 overflow-auto p-6 outline-none print-main" tabIndex={-1}>
        <Outlet />
      </main>
      {minimized && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-primary text-primary-foreground rounded-lg shadow-lg px-5 py-2.5 flex items-center gap-3 cursor-pointer animate-in slide-in-from-bottom-4 fade-in duration-200 hover:brightness-110 transition-all print-hide"
          onClick={handleRestore}
        >
          <span className="text-sm font-semibold">{minimized.label}</span>
          <span className="text-xs opacity-80">Click to resume</span>
        </div>
      )}
    </div>
  )
}
