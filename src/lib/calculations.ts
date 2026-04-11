/**
 * Core business logic for cut ratios, profit, and waste calculations.
 */

export interface CutCalculation {
  area_ratio: number
  full_sheets_consumed: number       // ceiled integer
  cost_total_poisha: number
  profit_poisha: number
  profit_margin_pct: number
  waste_sheets: number
  line_total_poisha: number          // ceiled to whole taka (nearest 100 poisha)
  selling_price_per_sheet_poisha: number
}

/**
 * Calculate area ratio: proportion of a full sheet used by the cut size.
 */
export function areaRatio(
  cutWidth: number,
  cutHeight: number,
  fullWidth: number,
  fullHeight: number
): number {
  return (cutWidth * cutHeight) / (fullWidth * fullHeight)
}

/**
 * Calculate how many full sheets are consumed to produce the requested cut sheets.
 * Result is CEILED to integer — you can't consume a fraction of a sheet.
 */
export function fullSheetsConsumed(quantitySheets: number, ratio: number): number {
  return Math.ceil(quantitySheets * ratio)
}

/**
 * Full line item calculation.
 *
 * @param ratePer1000Poisha - selling price per 1000 CUT sheets (in poisha)
 * @param costPerFullSheetPoisha - our cost per full sheet (in poisha)
 *
 * Total = quantitySheets × (ratePer1000 / 1000), ceiled to whole taka.
 * The rate is what the customer pays per 1000 cut sheets they receive.
 */
export function calculateLineItem(
  cutWidth: number,
  cutHeight: number,
  fullWidth: number,
  fullHeight: number,
  quantitySheets: number,
  ratePer1000Poisha: number,
  costPerFullSheetPoisha: number
): CutCalculation {
  const ratio = areaRatio(cutWidth, cutHeight, fullWidth, fullHeight)
  const consumed = fullSheetsConsumed(quantitySheets, ratio)   // ceiled

  // Selling price per cut sheet = ratePer1000 / 1000
  const sellingPerCutSheet = ratePer1000Poisha / 1000

  // Total = quantity of cut sheets × selling price per cut sheet
  const rawTotal = quantitySheets * sellingPerCutSheet
  const lineTotalPoisha = Math.ceil(rawTotal / 100) * 100   // ceil to nearest taka (100 poisha)

  const costTotalPoisha = Math.round(consumed * costPerFullSheetPoisha)
  const profitPoisha = lineTotalPoisha - costTotalPoisha
  const profitMarginPct = lineTotalPoisha > 0 ? (profitPoisha / lineTotalPoisha) * 100 : 0

  // Waste calculation: layout-based
  const piecesNormal = Math.floor(fullWidth / cutWidth) * Math.floor(fullHeight / cutHeight)
  const piecesRotated = Math.floor(fullWidth / cutHeight) * Math.floor(fullHeight / cutWidth)
  const bestPieces = Math.max(piecesNormal, piecesRotated)
  const fullSheetsNeeded = bestPieces > 0 ? Math.ceil(quantitySheets / bestPieces) : 0
  const waste = Math.max(0, fullSheetsNeeded - consumed)

  return {
    area_ratio: ratio,
    full_sheets_consumed: consumed,
    cost_total_poisha: costTotalPoisha,
    profit_poisha: profitPoisha,
    profit_margin_pct: profitMarginPct,
    waste_sheets: waste,
    line_total_poisha: lineTotalPoisha,
    selling_price_per_sheet_poisha: Math.round(sellingPerCutSheet),
  }
}

/**
 * Per-full-sheet calculation for card/sticker.
 * Selling price is per FULL sheet.
 * Total = full_sheets_consumed × selling price per full sheet.
 */
export function calculatePerPieceLineItem(
  cutWidth: number,
  cutHeight: number,
  fullWidth: number,
  fullHeight: number,
  quantitySheets: number,
  sellingPricePerFullSheetPoisha: number,
  costPerFullSheetPoisha: number
): CutCalculation {
  const ratio = areaRatio(cutWidth, cutHeight, fullWidth, fullHeight)
  const consumed = fullSheetsConsumed(quantitySheets, ratio)

  const rawTotal = consumed * sellingPricePerFullSheetPoisha
  const lineTotalPoisha = Math.ceil(rawTotal / 100) * 100

  const costTotalPoisha = Math.round(consumed * costPerFullSheetPoisha)
  const profitPoisha = lineTotalPoisha - costTotalPoisha
  const profitMarginPct = lineTotalPoisha > 0 ? (profitPoisha / lineTotalPoisha) * 100 : 0

  const piecesNormal = Math.floor(fullWidth / cutWidth) * Math.floor(fullHeight / cutHeight)
  const piecesRotated = Math.floor(fullWidth / cutHeight) * Math.floor(fullHeight / cutWidth)
  const bestPieces = Math.max(piecesNormal, piecesRotated)
  const fullSheetsNeeded = bestPieces > 0 ? Math.ceil(quantitySheets / bestPieces) : 0
  const waste = Math.max(0, fullSheetsNeeded - consumed)

  return {
    area_ratio: ratio,
    full_sheets_consumed: consumed,
    cost_total_poisha: costTotalPoisha,
    profit_poisha: profitPoisha,
    profit_margin_pct: profitMarginPct,
    waste_sheets: waste,
    line_total_poisha: lineTotalPoisha,
    selling_price_per_sheet_poisha: Math.round(sellingPricePerFullSheetPoisha),
  }
}

/**
 * Calculate how many cut pieces fit per full sheet using optimal layout.
 * Tries both normal and rotated orientations.
 */
export function piecesPerSheet(
  cutW: number,
  cutH: number,
  fullW: number,
  fullH: number
): number {
  const piecesNormal = Math.floor(fullW / cutW) * Math.floor(fullH / cutH)
  const piecesRotated = Math.floor(fullW / cutH) * Math.floor(fullH / cutW)
  return Math.max(piecesNormal, piecesRotated)
}

/**
 * Calculate waste area per sheet given a cutting layout.
 */
export function wasteAreaPerSheet(
  cutW: number,
  cutH: number,
  fullW: number,
  fullH: number
): number {
  const pieces = piecesPerSheet(cutW, cutH, fullW, fullH)
  const usedArea = pieces * cutW * cutH
  const fullArea = fullW * fullH
  return Math.max(0, fullArea - usedArea)
}

/**
 * Accessory line: no cut size, no area ratio. Simple qty × price.
 */
export function calculateAccessoryLineItem(
  quantity: number,
  sellingPricePerPiecePoisha: number,
  costPerPiecePoisha: number
): CutCalculation {
  const rawTotal = quantity * sellingPricePerPiecePoisha
  const lineTotalPoisha = Math.ceil(rawTotal / 100) * 100
  const costTotalPoisha = Math.round(quantity * costPerPiecePoisha)
  const profitPoisha = lineTotalPoisha - costTotalPoisha
  const profitMarginPct = lineTotalPoisha > 0 ? (profitPoisha / lineTotalPoisha) * 100 : 0

  return {
    area_ratio: 1,
    full_sheets_consumed: quantity,
    cost_total_poisha: costTotalPoisha,
    profit_poisha: profitPoisha,
    profit_margin_pct: profitMarginPct,
    waste_sheets: 0,
    line_total_poisha: lineTotalPoisha,
    selling_price_per_sheet_poisha: Math.round(sellingPricePerPiecePoisha),
  }
}
