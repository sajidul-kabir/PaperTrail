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
  if (v === 'PACKET') return `${brandName} ${gsmValue}gsm ${formatSize(width, height)} Packet`
  const subtype = (v.startsWith('CB ') || v.startsWith('CFB ') || v.startsWith('CF ')) ? 'Carbon Paper' : 'Color Paper'
  return `${brandName} ${subtype} ${gsmValue}gsm ${formatSize(width, height)} ${variant}`
}

/** Format size for bill printing — shows A4 for 8.25x11.75 */
export function billSize(w: number, h: number): string {
  const small = Math.min(w, h)
  const large = Math.max(w, h)
  if ((small === 8.25 && large === 11.75) || (small === 8.27 && large === 11.69)) return 'A4'
  return `${small}x${large}`
}

/** Format label for bill printing — shorter descriptions */
export function billLabel(label: string | null): string {
  if (!label) return 'Item'
  // Packet paper: any label ending with PACKET/Packet — strip subtype, size, A4
  if (/\bPACKET\b/i.test(label)) {
    const cleaned = label.replace(/\s+(?:Color Paper|Carbon Paper|Packet Paper)\s+/i, ' ')
    const packetMatch = cleaned.match(/^(.+?)\s+(\d+gsm)/i)
    if (packetMatch) {
      const brand = packetMatch[1].replace(/\s+A4\b/i, '').trim()
      return `${brand} ${packetMatch[2]}`
    }
    return label.replace(/\s+PACKET$/i, ' Packet')
  }
  // Carbon paper: "Fresh Carbon Paper 47gsm 23.0x36.0 CB White" → "Fresh Carbon CB White"
  const carbonMatch = label.match(/^(.+?)\s+Carbon Paper\s+\d+gsm\s+[\d.]+x[\d.]+\s+(.+)$/)
  if (carbonMatch) return `${carbonMatch[1]} Carbon ${carbonMatch[2]}`
  // Color paper: "Bashundhara Color Paper 80gsm 23.0x36.0 Green" → "Color Paper Green"
  const colorMatch = label.match(/^.+?\s+Color Paper\s+\d+gsm\s+[\d.]+x[\d.]+\s+(.+)$/)
  if (colorMatch) return `Color Paper ${colorMatch[1]}`
  // A4 paper: "Sonali A4 65gsm 8.25x11.75" → "Sonali A4 65gsm"
  if (/\bA4\b/i.test(label)) {
    const a4Match = label.match(/^(.+?\s+A4\s+\d+gsm)/i)
    if (a4Match) return a4Match[1]
  }
  // Regular paper/card/sticker: "Ningbu 300gsm 22.0x28.0" → "Ningbu 300gsm"
  const regularMatch = label.match(/^(.+?\s+\d+gsm)\s+[\d.]+x[\d.]+$/)
  if (regularMatch) return regularMatch[1]
  return label
}

/** Profit margin color class */
export function profitColor(marginPct: number): string {
  if (marginPct >= 10) return 'text-profit-good'
  if (marginPct >= 5) return 'text-profit-thin'
  if (marginPct >= 0) return 'text-muted-foreground'
  return 'text-profit-loss'
}
