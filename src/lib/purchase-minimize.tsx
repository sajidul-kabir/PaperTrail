import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

interface MinimizedPurchase {
  label: string
  formData: any // serialized form state from PurchasesPage
}

interface PurchaseMinimizeContextType {
  minimized: MinimizedPurchase | null
  minimize: (label: string, formData: any) => void
  restore: () => MinimizedPurchase | null
}

const PurchaseMinimizeContext = createContext<PurchaseMinimizeContextType>({
  minimized: null,
  minimize: () => {},
  restore: () => null,
})

export function PurchaseMinimizeProvider({ children }: { children: ReactNode }) {
  const [minimized, setMinimized] = useState<MinimizedPurchase | null>(null)

  const minimize = useCallback((label: string, formData: any) => {
    setMinimized({ label, formData })
  }, [])

  const restore = useCallback(() => {
    const data = minimized
    setMinimized(null)
    return data
  }, [minimized])

  return (
    <PurchaseMinimizeContext.Provider value={{ minimized, minimize, restore }}>
      {children}
    </PurchaseMinimizeContext.Provider>
  )
}

export function usePurchaseMinimize() {
  return useContext(PurchaseMinimizeContext)
}
