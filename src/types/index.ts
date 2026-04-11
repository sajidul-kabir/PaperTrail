export interface Brand {
  id: string
  name: string
  created_at: string
}

export interface GsmOption {
  id: string
  value: number
  created_at: string
}

export interface Proportion {
  id: string
  width_inches: number
  height_inches: number
  created_at: string
}

export interface AccessoryType {
  id: string
  name: string
  created_at: string
}

export interface Accessory {
  id: string
  accessory_type_id: string
  brand_id: string
  gsm_id: string
  created_at: string
  // Joined fields
  accessory_name?: string
  brand_name?: string
  gsm_value?: number // Used for "Pound"
}

export interface PaperType {
  id: string
  brand_id: string
  gsm_id: string
  proportion_id: string
  created_at: string
  // Joined fields
  brand_name?: string
  gsm_value?: number
  width_inches?: number
  height_inches?: number
}

export interface StockLedgerEntry {
  id: string
  paper_type_id: string
  transaction_type: 'PURCHASE' | 'SALE' | 'ADJUSTMENT' | 'VOID_REVERSAL'
  quantity_sheets: number
  reference_id: string | null
  created_at: string
}

export interface Purchase {
  id: string
  paper_type_id: string
  quantity_reams: number
  cost_per_ream_poisha: number
  total_cost_poisha: number
  supplier_name: string | null
  purchase_date: string
  notes: string | null
  created_at: string
  // Joined
  paper_type_label?: string
}

export interface Customer {
  id: string
  name: string
  organization: string | null
  phone: string | null
  address: string | null
  is_walk_in: number
  created_at: string
  // Computed
  balance_poisha?: number
}

export interface Invoice {
  id: string
  invoice_number: string
  customer_id: string
  invoice_date: string
  subtotal_poisha: number
  total_poisha: number
  status: 'ACTIVE' | 'VOID'
  void_reason: string | null
  voided_at: string | null
  notes: string | null
  created_at: string
  // Joined
  customer_name?: string
  customer_organization?: string | null
  lines?: InvoiceLine[]
  total_profit_poisha?: number
}

export interface InvoiceLine {
  id: string
  invoice_id: string
  paper_type_id: string
  cut_width_inches: number
  cut_height_inches: number
  quantity_sheets: number
  selling_price_per_sheet_poisha: number
  line_total_poisha: number
  area_ratio: number
  full_sheets_consumed: number
  cost_per_full_sheet_poisha: number
  cost_total_poisha: number
  profit_poisha: number
  profit_margin_pct: number
  waste_sheets: number
  created_at: string
  // Joined
  paper_type_label?: string
}

export interface Payment {
  id: string
  customer_id: string
  amount_poisha: number
  payment_date: string
  payment_method: 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'OTHER'
  notes: string | null
  created_at: string
  // Joined
  customer_name?: string
}

export interface StockSummary {
  paper_type_id: string
  paper_type_label: string
  brand_name: string
  gsm_value: number
  width_inches: number
  height_inches: number
  total_sheets: number
  total_reams: number
  avg_cost_per_ream_poisha: number
  total_value_poisha: number
}

export interface DashboardSummary {
  today_sales_poisha: number
  today_profit_poisha: number
  today_avg_margin: number
  today_invoice_count: number
}

export interface Transfer {
  id: string
  transfer_number: string
  transfer_date: string
  notes: string | null
  created_at: string
  // Computed
  total_lines?: number
  total_pieces?: number
}

export interface TransferLine {
  id: string
  transfer_id: string
  paper_type_id: string | null
  accessory_id: string | null
  quantity_units: number
  quantity_sheets: number
  cut_width_inches: number | null
  cut_height_inches: number | null
  pieces_per_sheet: number
  total_cut_pieces: number
  waste_area_per_sheet: number
  created_at: string
  // Joined
  paper_type_label?: string
  accessory_name?: string
}

export interface CuttingStockEntry {
  id: string
  paper_type_id: string | null
  accessory_id: string | null
  cut_width_inches: number | null
  cut_height_inches: number | null
  quantity_pieces: number
  transaction_type: 'TRANSFER_IN' | 'SALE' | 'ADJUSTMENT' | 'VOID_REVERSAL'
  reference_id: string | null
  cost_per_piece_poisha: number
  created_at: string
}

export interface CuttingStockSummary {
  paper_type_id: string | null
  accessory_id: string | null
  cut_width_inches: number | null
  cut_height_inches: number | null
  total_pieces: number
  avg_cost_per_piece_poisha: number
  label: string
}

export interface Supplier {
  id: string
  name: string
  phone: string | null
  address: string | null
  created_at: string
}

export interface Order {
  id: string
  customer_id: string
  order_date: string
  status: 'PENDING' | 'BILLED' | 'VOID'
  invoice_id: string | null
  notes: string | null
  created_at: string
  // Joined
  customer_name?: string
  customer_organization?: string | null
  total_poisha?: number
  line_count?: number
}

export interface OrderLine {
  id: string
  order_id: string
  paper_type_id: string | null
  accessory_id: string | null
  cut_width_inches: number | null
  cut_height_inches: number | null
  quantity_pieces: number
  selling_price_per_piece_poisha: number
  line_total_poisha: number
  cost_per_piece_poisha: number
  cost_total_poisha: number
  profit_poisha: number
  profit_margin_pct: number
  label: string | null
  created_at: string
}

// For new invoice form
export interface InvoiceLineInput {
  paper_type_id: string
  paper_type_label: string
  full_width: number
  full_height: number
  cut_width_inches: number
  cut_height_inches: number
  quantity_sheets: number
  selling_price_per_sheet_poisha: number
  // Computed
  area_ratio: number
  full_sheets_consumed: number
  cost_per_full_sheet_poisha: number
  line_total_poisha: number
  cost_total_poisha: number
  profit_poisha: number
  profit_margin_pct: number
  waste_sheets: number
}
