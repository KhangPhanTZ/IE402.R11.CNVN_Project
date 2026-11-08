import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fmtDate = (v?: string | null) => (v ? new Date(v).toLocaleString('vi-VN') : '—')
export const fmtNum = (v: unknown, d = 2) =>
  v === null || v === undefined || v === '' ? '—' : typeof v === 'number' ? v.toLocaleString('vi-VN', { maximumFractionDigits: d }) : String(v)
