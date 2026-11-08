import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomHeightmapTerrainProvider,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  Math as CMath,
  type TerrainProvider,
} from 'cesium'
import type { FeatureCollection } from '@/lib/types'

export const CESIUM_TOKEN = (import.meta.env.VITE_CESIUM_TOKEN as string | undefined) || ''
export const HEIGHT_OFFSET = Number(import.meta.env.VITE_HEIGHT_OFFSET ?? 0) || 0
/** Tâm khu vực (xấp xỉ chợ Thủ Đức) – dùng khi chưa tải được dữ liệu */
export const CENTER = { lon: 106.756, lat: 10.85 }

/** Ngưỡng LOD: gần hơn → ống 3D/khối CSG; xa hơn → đường/điểm */
export const LOD_DISTANCE = 650

export const css = (c: string, a = 1) => Color.fromCssColorString(c).withAlpha(a)

export const STATUS_COLOR: Record<string, string> = {
  active: '#2563eb',
  maintenance: '#f59e0b',
  damaged: '#dc2626',
  blocked: '#7c3aed',
  retired: '#6b7280',
}
export const UTILITY_COLOR: Record<string, string> = { water: '#06b6d4', power: '#ef4444', telecom: '#22c55e' }
export const KIND_COLOR: Record<string, string> = { manhole: '#475569', inlet: '#0ea5e9', outfall: '#16a34a' }

export function pos(lon: number, lat: number, z = 0) {
  return Cartesian3.fromDegrees(lon, lat, z + HEIGHT_OFFSET)
}

/** Mặt cắt tròn bán kính r cho PolylineVolume */
export function circleShape(r: number, n = 14) {
  return Array.from({ length: n }, (_, i) => new Cartesian2(r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)))
}

/** Thang màu cao độ cho TIN (xanh lá → vàng → nâu) */
export function elevColor(z: number, zmin: number, zmax: number, alpha = 1) {
  const t = Math.max(0, Math.min(1, (z - zmin) / Math.max(zmax - zmin, 1e-6)))
  const stops = [
    [0, [56, 142, 60]],
    [0.5, [205, 190, 90]],
    [1, [150, 100, 60]],
  ] as const
  let i = 0
  while (i < stops.length - 2 && t > stops[i + 1][0]) i++
  const [t0, c0] = stops[i]
  const [t1, c1] = stops[i + 1]
  const u = (t - t0) / (t1 - t0)
  return new Color((c0[0] + (c1[0] - c0[0]) * u) / 255, (c0[1] + (c1[1] - c0[1]) * u) / 255, (c0[2] + (c1[2] - c0[2]) * u) / 255, alpha)
}

/** Bao lồi (lon/lat) của một FeatureCollection */
export function bbox(fc?: FeatureCollection | null): [number, number, number, number] | null {
  if (!fc?.features?.length) return null
  let w = 180, s = 90, e = -180, n = -90
  const walk = (c: any) => {
    if (typeof c?.[0] === 'number') {
      w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1])
    } else c?.forEach(walk)
  }
  fc.features.forEach((f) => walk(f.geometry.coordinates))
  return [w, s, e, n]
}

/**
 * Terrain tuỳ biến dựng từ TIN: raster hoá các tam giác (nội suy barycentric) thành lưới cao độ,
 * rồi cung cấp cho Cesium qua CustomHeightmapTerrainProvider ⇒ mặt địa cầu chính là mặt TIN,
 * và globe.translucency cho phép "nhìn xuyên đất" thấy cống/hố ga bên dưới.
 */
export function tinTerrainProvider(tin: FeatureCollection, res = 256): TerrainProvider {
  const bb = bbox(tin)
  if (!bb) return new EllipsoidTerrainProvider()
  const [w, s, e, n] = bb
  const grid = new Float32Array(res * res).fill(NaN)
  const dx = (e - w) / (res - 1)
  const dy = (n - s) / (res - 1)
  for (const f of tin.features) {
    const [a, b, c] = f.geometry.coordinates[0] as number[][]
    const minI = Math.max(0, Math.floor((Math.min(a[0], b[0], c[0]) - w) / dx))
    const maxI = Math.min(res - 1, Math.ceil((Math.max(a[0], b[0], c[0]) - w) / dx))
    const minJ = Math.max(0, Math.floor((Math.min(a[1], b[1], c[1]) - s) / dy))
    const maxJ = Math.min(res - 1, Math.ceil((Math.max(a[1], b[1], c[1]) - s) / dy))
    const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if (Math.abs(det) < 1e-18) continue
    for (let j = minJ; j <= maxJ; j++) {
      const y = s + j * dy
      for (let i = minI; i <= maxI; i++) {
        const x = w + i * dx
        const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / det
        const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / det
        const l3 = 1 - l1 - l2
        if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) grid[j * res + i] = l1 * a[2] + l2 * b[2] + l3 * c[2]
      }
    }
  }
  let fallback = 0
  for (const v of grid) if (!Number.isNaN(v)) fallback = Math.max(fallback, v)
  for (let k = 0; k < grid.length; k++) if (Number.isNaN(grid[k])) grid[k] = fallback
  const sample = (lon: number, lat: number) => {
    const fi = Math.max(0, Math.min(res - 1, (lon - w) / dx))
    const fj = Math.max(0, Math.min(res - 1, (lat - s) / dy))
    const i0 = Math.floor(fi), j0 = Math.floor(fj)
    const i1 = Math.min(res - 1, i0 + 1), j1 = Math.min(res - 1, j0 + 1)
    const u = fi - i0, v = fj - j0
    const g = (i: number, j: number) => grid[j * res + i]
    return (g(i0, j0) * (1 - u) + g(i1, j0) * u) * (1 - v) + (g(i0, j1) * (1 - u) + g(i1, j1) * u) * v + HEIGHT_OFFSET
  }
  const size = 33
  const scheme = new GeographicTilingScheme()
  return new CustomHeightmapTerrainProvider({
    width: size,
    height: size,
    tilingScheme: scheme,
    callback: (x, y, level) => {
      const r = scheme.tileXYToRectangle(x, y, level)
      const out = new Float32Array(size * size)
      for (let j = 0; j < size; j++) {
        const lat = CMath.toDegrees(r.north - ((r.north - r.south) * j) / (size - 1))
        for (let i = 0; i < size; i++) {
          const lon = CMath.toDegrees(r.west + ((r.east - r.west) * i) / (size - 1))
          out[j * size + i] = sample(lon, lat)
        }
      }
      return out
    },
  })
}

/** Màu theo thang (0 → 1+) xanh → vàng → đỏ, cho tỉ số tải Q_in/Q_cap */
export function ratioColor(r: number) {
  if (r >= 1) return '#dc2626'
  if (r >= 0.8) return '#f97316'
  if (r >= 0.5) return '#eab308'
  return '#16a34a'
}
