/**
 * Shared cost computation: running weighted-average cost per sheet/piece
 * Used by both GodownPage and NewOrderPage to ensure consistent cost display.
 */

export const LEDGER_COST_SQL = `
SELECT sl.paper_type_id, sl.accessory_id, sl.quantity_sheets, sl.transaction_type,
  p.total_cost_poisha as purchase_total_cost
FROM stock_ledger sl
LEFT JOIN purchases p ON sl.reference_id = p.id AND sl.transaction_type = 'PURCHASE'
ORDER BY datetime(sl.created_at) ASC, sl.rowid ASC
`

export interface LedgerCostRow {
  paper_type_id: string | null
  accessory_id: string | null
  quantity_sheets: number
  transaction_type: string
  purchase_total_cost: number | null
}

/**
 * Compute running weighted-average cost per sheet by replaying the stock_ledger chronologically.
 * When stock hits 0, the average resets — only "current era" purchases count.
 */
export function computeRunningAvgCost(
  rows: LedgerCostRow[],
  getKey: (r: LedgerCostRow) => string | null
): Map<string, number> {
  const grouped = new Map<string, LedgerCostRow[]>()
  for (const row of rows) {
    const key = getKey(row)
    if (!key) continue
    const arr = grouped.get(key) || []
    arr.push(row)
    grouped.set(key, arr)
  }

  const result = new Map<string, number>()
  for (const [key, entries] of grouped) {
    let stock = 0
    let avgCost = 0 // per sheet/piece

    for (const e of entries) {
      if (e.transaction_type === 'PURCHASE' && e.purchase_total_cost != null && e.quantity_sheets > 0) {
        const costPerSheet = e.purchase_total_cost / e.quantity_sheets
        if (stock <= 0) {
          avgCost = costPerSheet
        } else {
          avgCost = (stock * avgCost + e.quantity_sheets * costPerSheet) / (stock + e.quantity_sheets)
        }
        stock += e.quantity_sheets
      } else {
        stock += e.quantity_sheets // negative for outgoing
        if (stock <= 0) { stock = 0; avgCost = 0 }
      }
    }

    result.set(key, avgCost)
  }
  return result
}
