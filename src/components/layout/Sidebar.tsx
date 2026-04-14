import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  FileText,
  Receipt,
  ShoppingCart,
  Truck,
  Warehouse,
  ArrowRightLeft,
  Scissors,
  ClipboardList,
  Users,
  CreditCard,
  BarChart3,
  Layers,
  Settings,
  Moon,
  Sun,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'

const navItems = [
  { to: '/', icon: LayoutDashboard, tKey: 'nav.dashboard' as const },
  { to: '/catalog', icon: Layers, tKey: 'nav.catalog' as const },
  { to: '/suppliers', icon: Truck, tKey: 'nav.suppliers' as const },
  { to: '/purchases', icon: ShoppingCart, tKey: 'nav.purchases' as const },
  { to: '/godown', icon: Warehouse, tKey: 'nav.godown' as const },
  { to: '/transfers', icon: ArrowRightLeft, tKey: 'nav.transfers' as const },
  { to: '/cutting-stock', icon: Scissors, tKey: 'nav.cuttingStock' as const },
  { to: '/orders', icon: ClipboardList, tKey: 'nav.orders' as const },
  { to: '/bills', icon: Receipt, tKey: 'nav.bills' as const },
  { to: '/customers', icon: Users, tKey: 'nav.customers' as const },
  { to: '/payments', icon: CreditCard, tKey: 'nav.payments' as const },
  { to: '/reports', icon: BarChart3, tKey: 'nav.reports' as const },
  { to: '/settings', icon: Settings, tKey: 'nav.settings' as const },
]

export function Sidebar() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  const { lang, setLang, t } = useI18n()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])

  return (
    <aside className="w-52 border-r bg-card flex flex-col shrink-0">
      <div className="h-12 flex items-center justify-between px-4 border-b">
        <h1 className="text-base font-bold text-primary tracking-tight">PaperTrail</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setLang(lang === 'en' ? 'bn' : 'en')}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors text-xs font-semibold"
            title={lang === 'en' ? 'Switch to Bangla' : 'Switch to English'}
          >
            {lang === 'en' ? 'বা' : 'EN'}
          </button>
          <button
            onClick={() => setDark(d => !d)}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <nav className="flex-1 py-2 space-y-0.5 px-2">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {t(item.tKey)}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-2 border-t">
        <span className="text-[10px] text-muted-foreground">v{APP_VERSION}</span>
      </div>
    </aside>
  )
}
