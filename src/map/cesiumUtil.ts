import {
  Cartesian2,
  Cartesian3,
  Color,
  CustomHeightmapTerrainProvider,
  EllipsoidTerrainProvider,
  GeographicTilingScheme,
  Ion,
  Math as CMath,
  type TerrainProvider,
} from 'cesium'
import type { FeatureCollection } from '@/lib/types'
import { KIND, STATUS, UTILITY } from '@/lib/theme'
export { ratioColor } from '@/lib/theme'

export const CESIUM_TOKEN = (import.meta.env.VITE_CESIUM_TOKEN as string | undefined) || ''

// ---- Token Cesium ion: lấy từ ô nhập trên giao diện (lưu localStorage của trình duyệt) hoặc biến môi trường ----
const ION_KEY = 'ie402.cesiumIonToken'
const ION_DEFAULT = Ion.defaultAccessToken
const ionListeners = new Set<() => void>()
export function getIonToken(): string {
  try {
    return localStorage.getItem(ION_KEY) || CESIUM_TOKEN
  } catch {
    return CESIUM_TOKEN
  }
}
export const ionTokenFromUser = () => { try { return !!localStorage.getItem(ION_KEY) } catch { return false } }
function applyIonToken() {
  Ion.defaultAccessToken = getIonToken() || ION_DEFAULT
}
applyIonToken()
export function setIonToken(token: string | null) {
  try {
    if (token) localStorage.setItem(ION_KEY, token.trim())
    else localStorage.removeItem(ION_KEY)
  } catch { /* trình duyệt chặn localStorage */ }
  applyIonToken()
  ionListeners.forEach((f) => f())
}
export function subscribeIonToken(f: () => void) {
  ionListeners.add(f)
  return () => { ionListeners.delete(f) }
}
/** Kiểm tra token bằng cách xin endpoint của asset 1 (Cesium World Terrain) */
export async function checkIonToken(token: string): Promise<string | null> {
  try {
    const r = await fetch(`https://api.cesium.com/v1/assets/1/endpoint?access_token=${encodeURIComponent(token.trim())}`)
    if (r.ok) return null
    return r.status === 401 ? 'Token không hợp lệ hoặc đã bị thu hồi' : r.status === 404 ? 'Token không có quyền dùng Cesium World Terrain (asset 1)' : `Cesium ion trả lỗi HTTP ${r.status}`
  } catch {
    return 'Không kết nối được tới api.cesium.com'
  }
}
export const HEIGHT_OFFSET = Number(import.meta.env.VITE_HEIGHT_OFFSET ?? 0) || 0
/** Tâm khu vực (xấp xỉ chợ Thủ Đức) – dùng khi chưa tải được dữ liệu */
export const CENTER = { lon: 106.7542, lat: 10.8502 }

/** Ngưỡng LOD: gần hơn → ống 3D/khối CSG; xa hơn → đường/điểm */
export const LOD_DISTANCE = 650

export const css = (c: string, a = 1) => Color.fromCssColorString(c).withAlpha(a)

// Màu lấy từ bảng màu ngữ nghĩa dùng chung (src/lib/theme.ts)
const pick = <T extends Record<string, { color: string }>>(o: T) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.color])) as Record<string, string>
export const STATUS_COLOR = pick(STATUS)
export const UTILITY_COLOR = pick(UTILITY)
export const KIND_COLOR = pick(KIND)

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
    [0, [134, 196, 160]],   // thấp: xanh lá nhạt
    [0.5, [222, 214, 160]], // giữa: be
    [1, [196, 160, 120]],   // cao: nâu nhạt
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
const samplers = new WeakMap<FeatureCollection, ((lon: number, lat: number) => number) | null>()

/** Raster hoá TIN (nội suy barycentric) → hàm lấy cao độ mặt đất tại (lon, lat) */
export function tinSampler(tin?: FeatureCollection | null, res = 256): ((lon: number, lat: number) => number) | null {
  if (!tin?.features.length) return null
  if (samplers.has(tin)) return samplers.get(tin)!
  const bb = bbox(tin)
  if (!bb) return null
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
  const fn = (lon: number, lat: number) => {
    const fi = Math.max(0, Math.min(res - 1, (lon - w) / dx))
    const fj = Math.max(0, Math.min(res - 1, (lat - s) / dy))
    const i0 = Math.floor(fi), j0 = Math.floor(fj)
    const i1 = Math.min(res - 1, i0 + 1), j1 = Math.min(res - 1, j0 + 1)
    const u = fi - i0, v = fj - j0
    const g = (i: number, j: number) => grid[j * res + i]
    return (g(i0, j0) * (1 - u) + g(i1, j0) * u) * (1 - v) + (g(i0, j1) * (1 - u) + g(i1, j1) * u) * v
  }
  samplers.set(tin, fn)
  return fn
}

/**
 * Terrain tuỳ biến dựng từ TIN (CustomHeightmapTerrainProvider) ⇒ mặt địa cầu chính là mặt TIN,
 * và globe.translucency cho phép "nhìn xuyên đất" thấy cống/hố ga bên dưới.
 */
export function tinTerrainProvider(tin: FeatureCollection): TerrainProvider {
  const z = tinSampler(tin)
  if (!z) return new EllipsoidTerrainProvider()
  const sample = (lon: number, lat: number) => z(lon, lat) + HEIGHT_OFFSET
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

/** Bản đồ nền (Esri, miễn phí kèm ghi nguồn; OSM). "Xám nhạt" làm mặc định: tối giản để dữ liệu nổi bật. */
export type BasemapKey = 'light' | 'dark' | 'streets' | 'satellite' | 'osm'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
export const BASEMAPS: Record<BasemapKey, { label: string; url: string; overlay?: string; credit: string; subdomains?: string[]; maxLevel: number; thumb: string }> = {
  light: {
    label: 'Xám nhạt', url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 16, // không thêm lớp nhãn: nhãn bị phóng quá zoom 16 sẽ to và nhoè
    credit: 'Esri, HERE, Garmin, © OpenStreetMap contributors', thumb: 'linear-gradient(135deg,#f4f4f4 0%,#d9dde2 100%)',
  },
  dark: {
    label: 'Xám đậm', url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    maxLevel: 16,
    credit: 'Esri, HERE, Garmin, © OpenStreetMap contributors', thumb: 'linear-gradient(135deg,#3f3f46 0%,#18181b 100%)',
  },
  streets: {
    label: 'Đường phố', url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, maxLevel: 19,
    credit: 'Esri, HERE, Garmin, © OpenStreetMap contributors', thumb: 'linear-gradient(135deg,#f3eedc 0%,#f2b48a 100%)',
  },
  satellite: {
    label: 'Vệ tinh', url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxLevel: 19,
    credit: 'Esri, Maxar, Earthstar Geographics', thumb: 'linear-gradient(135deg,#365314 0%,#78716c 60%,#44403c 100%)',
  },
  osm: {
    label: 'OSM', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxLevel: 19,
    credit: '© OpenStreetMap contributors', thumb: 'linear-gradient(135deg,#f2efe9 0%,#aad3df 100%)',
  },
}
