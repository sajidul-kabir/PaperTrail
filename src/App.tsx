import { Routes, Route } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPage } from '@/components/dashboard/DashboardPage'
import { CatalogPage } from '@/components/catalog/CatalogPage'
import { SuppliersPage } from '@/components/suppliers/SuppliersPage'
import { PurchasesPage } from '@/components/purchases/PurchasesPage'
import { GodownPage } from '@/components/inventory/GodownPage'
import { TransfersPage } from '@/components/transfers/TransfersPage'
import { NewTransferPage } from '@/components/transfers/NewTransferPage'
import { TransferReceiptPage } from '@/components/transfers/TransferReceiptPage'
import { CuttingInventoryPage } from '@/components/inventory/CuttingInventoryPage'
import { OrdersPage } from '@/components/orders/OrdersPage'
import { NewOrderPage } from '@/components/orders/NewOrderPage'
import { OrderDetailPage } from '@/components/orders/OrderDetailPage'
import { BillsPage } from '@/components/bills/BillsPage'
import { MemoPage } from '@/components/bills/MemoPage'
import { BillPrintPage } from '@/components/bills/BillPrintPage'
import { InvoiceDetailPage } from '@/components/sales/InvoiceDetailPage'
import { CustomersPage } from '@/components/customers/CustomersPage'
import { CustomerDetailPage } from '@/components/customers/CustomerDetailPage'
import { PaymentsPage } from '@/components/payments/PaymentsPage'
import { ReportsPage } from '@/components/reports/ReportsPage'
import { SettingsPage } from '@/components/settings/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/catalog" element={<CatalogPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/purchases" element={<PurchasesPage />} />
        <Route path="/godown" element={<GodownPage />} />
        {/* <Route path="/transfers" element={<TransfersPage />} /> */}
        {/* <Route path="/transfers/new" element={<NewTransferPage />} /> */}
        <Route path="/transfers/receipt" element={<TransferReceiptPage />} />
        {/* <Route path="/cutting-stock" element={<CuttingInventoryPage />} /> */}
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/new" element={<NewOrderPage />} />
        <Route path="/orders/:id" element={<OrderDetailPage />} />
        <Route path="/bills" element={<BillsPage />} />
        <Route path="/bills/memo" element={<MemoPage />} />
        <Route path="/bills/:id/print" element={<BillPrintPage />} />
        <Route path="/bills/:id" element={<InvoiceDetailPage />} />
        <Route path="/customers" element={<CustomersPage />} />
        <Route path="/customers/:id" element={<CustomerDetailPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
