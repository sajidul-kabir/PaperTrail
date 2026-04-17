import { dbQuery, dbRun } from './ipc'
import { v4 as uuid } from 'uuid'

export type Category = 'PAPER' | 'CARD' | 'STICKER' | 'ACCESSORY'

/** Sheets per unit for each category */
export function sheetsPerUnit(category: Category): number {
  if (category === 'PAPER') return 500
  if (category === 'ACCESSORY') return 1
  return 100 // CARD, STICKER
}

/** Unit label for each category */
export function unitLabel(category: Category): string {
  if (category === 'PAPER') return 'ream'
  if (category === 'ACCESSORY') return 'piece'
  return 'packet'
}

/** Unit label plural */
export function unitLabelPlural(category: Category): string {
  if (category === 'PAPER') return 'reams'
  if (category === 'ACCESSORY') return 'pieces'
  return 'packets'
}

/** Is this a per-piece pricing category (not per-1000)? */
export function isPerPieceCategory(category: Category): boolean {
  return category !== 'PAPER'
}

/** Paper sub-type options (Regular / Carbon / Color) */
export const PAPER_SUBTYPES = [
  { value: '', label: 'Regular' },
  { value: 'carbon', label: 'Carbon' },
  { value: 'color', label: 'Color' },
] as const

/** Variant presets for each paper sub-type */
export const VARIANT_PRESETS: Record<string, string[]> = {
  carbon: [
    'CB White', 'CB Blue', 'CB Yellow', 'CB Pink', 'CB Green',
    'CFB White', 'CFB Blue', 'CFB Yellow', 'CFB Pink', 'CFB Green',
    'CF White', 'CF Blue', 'CF Yellow', 'CF Pink', 'CF Green',
  ],
  color: ['Blue', 'Yellow', 'Pink', 'Green'],
}

/** Derive display type from variant string */
export function paperDisplayType(variant: string): string {
  if (!variant) return 'Paper'
  const v = variant.toUpperCase()
  if (v.startsWith('CB ') || v.startsWith('CFB ') || v.startsWith('CF ')) return 'Carbon Paper'
  return 'Color Paper'
}

/**
 * Find or create a paper_type row for the given brand + gsm + proportion + category combo.
 */
export async function findOrCreatePaperType(
  brandId: string,
  gsmId: string,
  proportionId: string,
  category: Category = 'PAPER',
  variant: string = ''
): Promise<string> {
  const rows = await dbQuery<{ id: string }>(
    `SELECT id FROM paper_types WHERE brand_id = ? AND gsm_id = ? AND proportion_id = ? AND category = ? AND variant = ?`,
    [brandId, gsmId, proportionId, category, variant]
  )
  if (rows.length > 0) return rows[0].id

  const id = uuid()
  await dbRun(
    `INSERT INTO paper_types (id, brand_id, gsm_id, proportion_id, category, variant) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, brandId, gsmId, proportionId, category, variant]
  )
  return id
}

/**
 * Find or create an accessory row for the given name + brand + pound combo.
 */
export async function findOrCreateAccessory(
  typeId: string,
  brandId: string,
  gsmId: string
): Promise<string> {
  const rows = await dbQuery<{ id: string }>(
    `SELECT id FROM accessories WHERE accessory_type_id = ? AND brand_id = ? AND gsm_id = ?`,
    [typeId, brandId, gsmId]
  )
  if (rows.length > 0) return rows[0].id

  const id = uuid()
  await dbRun(
    `INSERT INTO accessories (id, accessory_type_id, brand_id, gsm_id) VALUES (?, ?, ?, ?)`,
    [id, typeId, brandId, gsmId]
  )
  return id
}
