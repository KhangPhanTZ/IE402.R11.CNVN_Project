export type Role = 'citizen' | 'technician' | 'admin'

export interface Feature<P = Record<string, any>> {
  type: 'Feature'
  id?: string | null
  geometry: { type: string; coordinates: any }
  properties: P
}
export interface FeatureCollection<P = Record<string, any>> {
  type: 'FeatureCollection'
  features: Feature<P>[]
  meta?: Record<string, any>
}

export interface CsgNode {
  id: number
  parent_id: number | null
  ord: number
  op: 'union' | 'difference' | 'primitive'
  primitive: 'cylinder' | null
  params: { radius: number; z0: number; height: number; dx?: number; dy?: number; role?: string }
}

export type LayerKey = 'tin' | 'buildings' | 'roads' | 'pipes' | 'manholes' | 'utilities' | 'flood' | 'defects' | 'zones' | 'incidents'

/** Tô màu theo kết quả phân tích: id → màu CSS */
export interface Highlight {
  title?: string
  pipes?: Record<number, string>
  manholes?: Record<number, string>
  buildings?: Record<number, string>
  utilities?: Record<number, string>
  dimOthers?: boolean
  legend?: { color: string; label: string }[]
}
