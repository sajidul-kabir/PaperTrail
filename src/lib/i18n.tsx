import React, { createContext, useContext, useState } from 'react'

type Lang = 'en' | 'bn'

const translations = {
  // Sidebar nav
  'nav.dashboard': { en: 'Dashboard', bn: 'ড্যাশবোর্ড' },
  'nav.catalog': { en: 'Paper Catalog', bn: 'কাগজের ক্যাটালগ' },
  'nav.suppliers': { en: 'Suppliers', bn: 'সরবরাহকারী' },
  'nav.purchases': { en: 'Purchases', bn: 'ক্রয়' },
  'nav.godown': { en: 'Godown', bn: 'গুদাম' },
  'nav.transfers': { en: 'Transfers', bn: 'ট্রান্সফার' },
  'nav.cuttingStock': { en: 'Cutting Stock', bn: 'কাটিং স্টক' },
  'nav.orders': { en: 'Orders', bn: 'অর্ডার' },
  'nav.bills': { en: 'Bills', bn: 'বিল' },
  'nav.customers': { en: 'Customers', bn: 'গ্রাহক' },
  'nav.payments': { en: 'Payments', bn: 'পেমেন্ট' },
  'nav.reports': { en: 'Reports', bn: 'রিপোর্ট' },
  'nav.settings': { en: 'Settings', bn: 'সেটিংস' },

  // Dashboard
  'dashboard.title': { en: 'Dashboard', bn: 'ড্যাশবোর্ড' },
  'dashboard.sales': { en: 'Sales', bn: 'বিক্রয়' },
  'dashboard.profit': { en: 'Profit', bn: 'লাভ' },
  'dashboard.avgMargin': { en: 'Avg Margin', bn: 'গড় মার্জিন' },
  'dashboard.invoices': { en: 'Orders', bn: 'অর্ডার' },
  'dashboard.todaySummary': { en: "Today's Summary", bn: 'আজকের সারসংক্ষেপ' },
  'dashboard.summaryFor': { en: 'Summary for', bn: 'সারসংক্ষেপ' },
  'dashboard.todayInvoices': { en: "Today's Orders", bn: 'আজকের অর্ডার' },
  'dashboard.invoicesOn': { en: 'Orders on', bn: 'অর্ডার তারিখ' },
  'dashboard.noInvoices': { en: 'No orders on this date.', bn: 'এই তারিখে কোনো অর্ডার নেই।' },
  'dashboard.lowStock': { en: 'Low Stock Alerts', bn: 'স্বল্প মজুদ সতর্কতা' },
  'dashboard.allStockOk': { en: 'All stock levels OK.', bn: 'সব মজুদ ঠিক আছে।' },
  'dashboard.today': { en: 'Today', bn: 'আজ' },

  // Common
  'common.search': { en: 'Search...', bn: 'খুঁজুন...' },
  'common.filter': { en: 'Filter...', bn: 'ফিল্টার...' },
  'common.loading': { en: 'Loading...', bn: 'লোড হচ্ছে...' },
  'common.save': { en: 'Save', bn: 'সংরক্ষণ' },
  'common.cancel': { en: 'Cancel', bn: 'বাতিল' },
  'common.delete': { en: 'Delete', bn: 'মুছুন' },
  'common.add': { en: 'Add', bn: 'যোগ করুন' },
  'common.date': { en: 'Date', bn: 'তারিখ' },
  'common.total': { en: 'Total', bn: 'মোট' },
  'common.cost': { en: 'Cost', bn: 'খরচ' },
  'common.profit': { en: 'Profit', bn: 'লাভ' },
  'common.margin': { en: 'Margin', bn: 'মার্জিন' },
  'common.status': { en: 'Status', bn: 'অবস্থা' },
  'common.customer': { en: 'Customer', bn: 'গ্রাহক' },
  'common.supplier': { en: 'Supplier', bn: 'সরবরাহকারী' },
  'common.notes': { en: 'Notes', bn: 'নোট' },
  'common.active': { en: 'Active', bn: 'সক্রিয়' },
  'common.void': { en: 'VOID', bn: 'বাতিল' },

  // Catalog
  'catalog.title': { en: 'Paper Catalog', bn: 'কাগজের ক্যাটালগ' },
  'catalog.brands': { en: 'Brands', bn: 'ব্র্যান্ড' },
  'catalog.gsm': { en: 'GSM', bn: 'জিএসএম' },
  'catalog.proportions': { en: 'Proportions', bn: 'সাইজ' },
  'catalog.paperTypes': { en: 'Paper Types', bn: 'কাগজের ধরন' },
  'catalog.brandName': { en: 'Brand Name', bn: 'ব্র্যান্ডের নাম' },
  'catalog.addBrand': { en: 'Add Brand', bn: 'ব্র্যান্ড যোগ করুন' },
  'catalog.addGsm': { en: 'Add GSM', bn: 'জিএসএম যোগ করুন' },
  'catalog.addProportion': { en: 'Add Proportion', bn: 'সাইজ যোগ করুন' },
  'catalog.addPaperType': { en: 'Add Paper Type', bn: 'কাগজের ধরন যোগ করুন' },
  'catalog.noBrands': { en: 'No brands yet.', bn: 'কোনো ব্র্যান্ড নেই।' },
  'catalog.noGsm': { en: 'No GSM options yet.', bn: 'কোনো জিএসএম নেই।' },
  'catalog.noProportions': { en: 'No proportions yet.', bn: 'কোনো সাইজ নেই।' },
  'catalog.noPaperTypes': { en: 'No paper types yet.', bn: 'কোনো কাগজের ধরন নেই।' },
  'catalog.width': { en: 'Width (in)', bn: 'প্রস্থ (ইঞ্চি)' },
  'catalog.height': { en: 'Height (in)', bn: 'উচ্চতা (ইঞ্চি)' },
  'catalog.combined': { en: 'Combined', bn: 'সমন্বিত' },

  // Purchases
  'purchases.title': { en: 'Purchases', bn: 'ক্রয়' },
  'purchases.subtitle': { en: 'Record paper purchases and track stock additions.', bn: 'কাগজ ক্রয় রেকর্ড করুন এবং মজুদ ট্র্যাক করুন।' },
  'purchases.new': { en: '+ New Purchase', bn: '+ নতুন ক্রয়' },
  'purchases.recordNew': { en: 'Record New Purchase', bn: 'নতুন ক্রয় রেকর্ড' },
  'purchases.paperType': { en: 'Paper Type', bn: 'কাগজের ধরন' },
  'purchases.qtyReams': { en: 'Quantity (Reams)', bn: 'পরিমাণ (রিম)' },
  'purchases.costPerReam': { en: 'Cost per Ream (BDT)', bn: 'প্রতি রিম মূল্য (টাকা)' },
  'purchases.totalCost': { en: 'Total Cost', bn: 'মোট খরচ' },
  'purchases.sheetsAdded': { en: 'Sheets added', bn: 'শিট যোগ হয়েছে' },
  'purchases.noPurchases': { en: 'No purchases recorded yet.', bn: 'কোনো ক্রয় রেকর্ড হয়নি।' },
  'purchases.savePurchase': { en: 'Save Purchase', bn: 'ক্রয় সংরক্ষণ' },

  // Invoices
  'invoices.title': { en: 'Orders', bn: 'অর্ডার' },
  'invoices.new': { en: '+ New Order', bn: '+ নতুন অর্ডার' },
  'invoices.newTitle': { en: 'New Order', bn: 'নতুন অর্ডার' },
  'invoices.details': { en: 'Order Details', bn: 'অর্ডারের বিবরণ' },
  'invoices.lineItems': { en: 'Line Items', bn: 'আইটেম' },
  'invoices.addRow': { en: 'Add Row', bn: 'সারি যোগ করুন' },
  'invoices.paperType': { en: 'Paper Type', bn: 'কাগজের ধরন' },
  'invoices.cutW': { en: 'Cut W (in)', bn: 'কাট প্রস্থ' },
  'invoices.cutH': { en: 'Cut H (in)', bn: 'কাট উচ্চতা' },
  'invoices.qty': { en: 'Qty (sheets)', bn: 'পরিমাণ (শিট)' },
  'invoices.ratePerSheet': { en: 'Rate / full sheet (৳)', bn: 'দর / পূর্ণ শিট (৳)' },
  'invoices.areaRatio': { en: 'Area Ratio', bn: 'এরিয়া অনুপাত' },
  'invoices.fullSheets': { en: 'Full Sheets', bn: 'পূর্ণ শিট' },
  'invoices.lineTotal': { en: 'Line Total', bn: 'সারি মোট' },
  'invoices.summary': { en: 'Summary', bn: 'সারসংক্ষেপ' },
  'invoices.saveInvoice': { en: 'Save Order', bn: 'অর্ডার সংরক্ষণ' },
  'invoices.voidInvoice': { en: 'Void Order', bn: 'অর্ডার বাতিল' },
  'invoices.voidReason': { en: 'Reason', bn: 'কারণ' },
  'invoices.confirmVoid': { en: 'Confirm Void', bn: 'বাতিল নিশ্চিত করুন' },
  'invoices.noInvoices': { en: 'No orders found.', bn: 'কোনো অর্ডার পাওয়া যায়নি।' },
  'invoices.noLines': { en: 'No line items found.', bn: 'কোনো আইটেম পাওয়া যায়নি।' },
  'invoices.breakdown': { en: 'Breakdown', bn: 'বিশ্লেষণ' },
  'invoices.profitBreakdown': { en: 'Profit Breakdown', bn: 'লাভের বিশ্লেষণ' },

  // Customers
  'customers.title': { en: 'Customers', bn: 'গ্রাহক' },
  'customers.addNew': { en: '+ New Customer', bn: '+ নতুন গ্রাহক' },
  'customers.name': { en: 'Name', bn: 'নাম' },
  'customers.organization': { en: 'Organization', bn: 'প্রতিষ্ঠান' },
  'customers.phone': { en: 'Phone', bn: 'ফোন' },
  'customers.address': { en: 'Address', bn: 'ঠিকানা' },
  'customers.balance': { en: 'Balance', bn: 'ব্যালেন্স' },
  'customers.noCustomers': { en: 'No customers yet.', bn: 'কোনো গ্রাহক নেই।' },
  'customers.recordPayment': { en: 'Record Payment', bn: 'পেমেন্ট রেকর্ড' },

  // Payments
  'payments.title': { en: 'Payments', bn: 'পেমেন্ট' },
  'payments.new': { en: '+ Record Payment', bn: '+ পেমেন্ট রেকর্ড' },
  'payments.amount': { en: 'Amount (BDT)', bn: 'পরিমাণ (টাকা)' },
  'payments.method': { en: 'Method', bn: 'পদ্ধতি' },
  'payments.noPayments': { en: 'No payments recorded yet.', bn: 'কোনো পেমেন্ট রেকর্ড হয়নি।' },

  // Godown / Inventory
  'godown.title': { en: 'Godown Storage', bn: 'গুদাম মজুদ' },
  'inventory.title': { en: 'Inventory', bn: 'মজুদ' },
  'inventory.reams': { en: 'Reams', bn: 'রিম' },
  'inventory.sheets': { en: 'Sheets', bn: 'শিট' },
  'inventory.avgCost': { en: 'Avg Cost/Ream', bn: 'গড় মূল্য/রিম' },
  'inventory.totalValue': { en: 'Total Value', bn: 'মোট মূল্য' },
  'inventory.noStock': { en: 'No stock data.', bn: 'কোনো মজুদ তথ্য নেই।' },

  // Reports
  'reports.title': { en: 'Reports', bn: 'রিপোর্ট' },
  'reports.salesReport': { en: 'Sales Report', bn: 'বিক্রয় রিপোর্ট' },
  'reports.profitAnalysis': { en: 'Profit Analysis', bn: 'লাভ বিশ্লেষণ' },
  'reports.stockReport': { en: 'Stock Report', bn: 'মজুদ রিপোর্ট' },
  'reports.customerBalances': { en: 'Customer Balances', bn: 'গ্রাহক ব্যালেন্স' },
} as const

type TranslationKey = keyof typeof translations

interface I18nContextType {
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: TranslationKey) => string
}

const I18nContext = createContext<I18nContextType | null>(null)

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Lang>('en')

  const t = (key: TranslationKey): string => {
    const entry = translations[key]
    if (!entry) return key
    return entry[lang] || entry['en'] || key
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}
