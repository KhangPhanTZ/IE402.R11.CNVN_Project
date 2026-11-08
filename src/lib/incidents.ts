export const KIND_VI: Record<string, string> = {
  blocked: 'Tắc nghẽn', overflow: 'Trào nước', broken_cover: 'Vỡ/mất nắp', odor: 'Mùi hôi', subsidence: 'Lún sụt', other: 'Khác',
}
import { INCIDENT } from './theme'
import type { BadgeVariant } from '@/components/ui/badge'

export const STATUS_VI: Record<string, string> = Object.fromEntries(Object.entries(INCIDENT).map(([k, v]) => [k, v.label]))
export const STATUS_VARIANT: Record<string, BadgeVariant> = Object.fromEntries(Object.entries(INCIDENT).map(([k, v]) => [k, v.badge as BadgeVariant]))
