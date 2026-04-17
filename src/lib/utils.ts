import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert poisha (integer) to BDT string with 2 decimal places */
export function formatBDT(poisha: number): string {
  const bdt = poisha / 100
  return `৳${bdt.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Convert BDT decimal to poisha integer */
export function bdtToPoisha(bdt: number): number {
  return Math.round(bdt * 100)
}

/** Convert poisha to BDT decimal */
export function poishaToBdt(poisha: number): number {
  return poisha / 100
}

/** Format number with commas */
export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString('en-BD', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** Format date for display */
export function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Get today's date as YYYY-MM-DD in local timezone */
export function todayISO(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Format proportion as smallXlarge */
export function formatSize(w: number, h: number): string {
  const small = Math.min(w, h)
  const large = Math.max(w, h)
  return `${small}x${large}`
}

/** Build paper type label from parts */
export function paperTypeLabel(brandName: string, gsmValue: number, width: number, height: number, variant?: string): string {
  if (!variant) return `${brandName} ${gsmValue}gsm ${formatSize(width, height)}`
  const v = variant.toUpperCase()
  const subtype = (v.startsWith('CB ') || v.startsWith('CFB ') || v.startsWith('CF ')) ? 'Carbon Paper' : 'Color Paper'
  return `${brandName} ${subtype} ${gsmValue}gsm ${formatSize(width, height)} ${variant}`
}

/** Profit margin color class */
export function profitColor(marginPct: number): string {
  if (marginPct >= 10) return 'text-profit-good'
  if (marginPct >= 5) return 'text-profit-thin'
  if (marginPct >= 0) return 'text-muted-foreground'
  return 'text-profit-loss'
}
