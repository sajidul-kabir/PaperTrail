import React from 'react'
import ReactDOM from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { I18nProvider } from '@/lib/i18n'
import { ToastProvider } from '@/components/ui/toast'
import { PurchaseMinimizeProvider } from '@/lib/purchase-minimize'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <I18nProvider>
        <ToastProvider>
          <PurchaseMinimizeProvider>
            <App />
          </PurchaseMinimizeProvider>
        </ToastProvider>
      </I18nProvider>
    </HashRouter>
  </React.StrictMode>
)
