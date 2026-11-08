/**
 * Các lớp hiển thị 3D. Lớp nặng dựng trực tiếp bằng API Cesium (CustomDataSource / Primitive)
 * bên trong <Viewer> của resium (lấy viewer qua useCesium()).
 */
import { useEffect, useRef } from 'react'
import { useCesium, Entity } from 'resium'
import {
  ArcType,
  Cartesian2,
  BoundingSphere,
  Cartesian3,
  Color,
  ColorGeometryInstanceAttribute,
  ComponentDatatype,
  CustomDataSource,
  DistanceDisplayCondition,
  DistanceDisplayConditionGeometryInstanceAttribute,
  Geometry,
  GeometryAttribute,
  GeometryInstance,
  HeightReference,
  HorizontalOrigin,
  LabelStyle,
  Matrix4,
  NearFarScalar,
  PerInstanceColorAppearance,
  PointPrimitiveCollection,
  PolygonHierarchy,
  Primitive,
  PrimitiveCollection,
  PrimitiveType,
  Rectangle,
  Transforms,
  VerticalOrigin,
  type Viewer,
} from 'cesium'
import type { FeatureCollection, Highlight } from '@/lib/types'
import { buildCsgTree, evaluateCsg, type Mesh } from '@/lib/csg'
import { css, circleShape, elevColor, HEIGHT_OFFSET, KIND_COLOR, LOD_DISTANCE, pos, STATUS_COLOR, UTILITY_COLOR } from './cesiumUtil'

const DIM = '#94a3b8'
const FAR = new DistanceDisplayCondition(LOD_DISTANCE, Number.MAX_VALUE)
const NEAR = new DistanceDisplayCondition(0, LOD_DISTANCE)

function colorFor(id: number, map: Record<number, string> | undefined, dim: boolean | undefined, base: string) {
  if (map && map[id]) return { c: map[id], a: 1 }
  return dim ? { c: DIM, a: 0.35 } : { c: base, a: 1 }
}

/** DataSource gắn với vòng đời component; build() chạy lại khi deps đổi */
function useDataSource(name: string, show: boolean, build: (ds: CustomDataSource, v: Viewer) => void, deps: unknown[]) {
  const { viewer } = useCesium()
  const ref = useRef<CustomDataSource | null>(null)
  useEffect(() => {
    if (!viewer) return
    const ds = new CustomDataSource(name)
    ref.current = ds
    viewer.dataSources.add(ds)
    return () => {
      if (!viewer.isDestroyed()) viewer.dataSources.remove(ds, true)
      ref.current = null
    }
  }, [viewer, name])
  useEffect(() => {
    const ds = ref.current
    if (!ds || !viewer) return
    ds.entities.suspendEvents()
    ds.entities.removeAll()
    build(ds, viewer)
    ds.entities.resumeEvents()
    viewer.scene.requestRender()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, ...deps])
  useEffect(() => {
    if (ref.current) ref.current.show = show
  }, [show])
}

// ---------------------------------------------------------------------------
// CỐNG: LOD xa = polyline; gần = PolylineVolume mặt cắt tròn bán kính D/2 tại cao độ thật
// ---------------------------------------------------------------------------
export function PipesLayer({ fc, highlight, show }: { fc?: FeatureCollection; highlight?: Highlight; show: boolean }) {
  useDataSource(
    'pipes',
    show,
    (ds) => {
      for (const f of fc?.features ?? []) {
        const p = f.properties
        const coords = f.geometry.coordinates as number[][]
        const { c, a } = colorFor(p.id, highlight?.pipes, highlight?.dimOthers, STATUS_COLOR[p.status] ?? '#2563eb')
        const color = css(c, a)
        const r = (p.diameter_mm ?? 600) / 2000
        const has3D = coords[0].length >= 3
        // tim ống = đáy (invert) + D/2
        const positions = coords.map(([lon, lat, z]) => pos(lon, lat, has3D ? z + r : 0.5))
        ds.entities.add({
          id: `pipe:${p.id}`,
          name: p.code,
          polyline: {
            positions,
            width: highlight?.pipes?.[p.id] ? 5 : 3,
            material: color,
            depthFailMaterial: color.withAlpha(0.55),
            arcType: ArcType.NONE,
            distanceDisplayCondition: has3D ? FAR : undefined,
          },
          polylineVolume: has3D
            ? { positions, shape: circleShape(r), material: color, distanceDisplayCondition: NEAR }
            : undefined,
        })
      }
    },
    [fc, highlight],
  )
  return null
}

// ---------------------------------------------------------------------------
// HỐ GA: LOD xa = điểm; gần = khối trụ sinh từ cây CSG (boundary evaluation)
// ---------------------------------------------------------------------------
const meshCache = new Map<string, Mesh>()

function meshGeometry(m: Mesh) {
  return new Geometry({
    attributes: {
      position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: m.positions }),
      normal: new GeometryAttribute({ componentDatatype: ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: m.normals }),
    } as any,
    indices: m.indices,
    primitiveType: PrimitiveType.TRIANGLES,
    boundingSphere: BoundingSphere.fromVertices(Array.from(m.positions)),
  })
}

export function ManholesLayer({ fc, highlight, show, pickedIds }: { fc?: FeatureCollection; highlight?: Highlight; show: boolean; pickedIds?: number[] }) {
  const { viewer } = useCesium()
  useEffect(() => {
    if (!viewer || !fc) return
    const coll = new PrimitiveCollection()
    const points = new PointPrimitiveCollection()
    const instances: GeometryInstance[] = []
    for (const f of fc.features) {
      const p = f.properties
      const [lon, lat, z] = f.geometry.coordinates as number[]
      const picked = pickedIds?.includes(p.id)
      const base = p.kind === 'manhole' ? STATUS_COLOR[p.status] === STATUS_COLOR.active ? KIND_COLOR.manhole : STATUS_COLOR[p.status] : KIND_COLOR[p.kind]
      const { c, a } = picked ? { c: '#facc15', a: 1 } : colorFor(p.id, highlight?.manholes, highlight?.dimOthers, base ?? '#475569')
      const tree = buildCsgTree(p.csg)
      points.add({
        id: `manhole:${p.id}`,
        position: pos(lon, lat, (z ?? 0.3) + 0.15),
        pixelSize: picked ? 11 : p.kind === 'outfall' ? 9 : 6,
        color: css(c, a),
        outlineColor: Color.WHITE,
        outlineWidth: 1,
        distanceDisplayCondition: tree ? FAR : undefined,
        scaleByDistance: new NearFarScalar(200, 1.4, 4000, 0.6),
      })
      if (!tree) continue
      const key = `${p.vid}:${p.rim_elev_m}:${p.invert_elev_m}:${p.diameter_m}`
      let mesh = meshCache.get(key)
      if (!mesh) {
        mesh = evaluateCsg(tree, 20)
        meshCache.set(key, mesh)
      }
      instances.push(
        new GeometryInstance({
          id: `manhole:${p.id}`,
          geometry: meshGeometry(mesh),
          modelMatrix: Matrix4.multiplyByTranslation(
            Transforms.eastNorthUpToFixedFrame(Cartesian3.fromDegrees(lon, lat, 0)),
            new Cartesian3(0, 0, HEIGHT_OFFSET),
            new Matrix4(),
          ),
          attributes: {
            color: ColorGeometryInstanceAttribute.fromColor(css(c, a)),
            distanceDisplayCondition: new DistanceDisplayConditionGeometryInstanceAttribute(0, LOD_DISTANCE),
          },
        }),
      )
    }
    coll.add(points)
    if (instances.length)
      coll.add(
        new Primitive({
          geometryInstances: instances,
          appearance: new PerInstanceColorAppearance({ flat: false, translucent: false, closed: false }),
          asynchronous: false,
        }),
      )
    coll.show = show
    viewer.scene.primitives.add(coll)
    viewer.scene.requestRender()
    return () => {
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(coll)
    }
  }, [viewer, fc, highlight, show, pickedIds])
  return null
}

// ---------------------------------------------------------------------------
// NHÀ: polygon extrude (LOD1) từ cao độ nền tới đỉnh
// ---------------------------------------------------------------------------
export function BuildingsLayer({ fc, highlight, show }: { fc?: FeatureCollection; highlight?: Highlight; show: boolean }) {
  useDataSource(
    'buildings',
    show,
    (ds) => {
      for (const f of fc?.features ?? []) {
        const p = f.properties
        const ring = (f.geometry.coordinates as number[][][])[0]
        const { c, a } = colorFor(p.id, highlight?.buildings, highlight?.dimOthers, p.has_basement ? '#c7d2fe' : '#e2e8f0')
        ds.entities.add({
          id: `building:${p.id}`,
          name: p.name,
          polygon: {
            hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(ring.flatMap(([lon, lat]) => [lon, lat]))),
            height: Number(p.base_elev_m) + HEIGHT_OFFSET,
            extrudedHeight: Number(p.base_elev_m) + Number(p.height_m) + HEIGHT_OFFSET,
            material: css(c, highlight?.buildings?.[p.id] ? 0.95 : a * 0.85),
            outline: false,
          },
        })
      }
    },
    [fc, highlight],
  )
  return null
}

/** B-Rep LOD2 (Ground/Wall/Roof) của công trình được chọn */
export function BRepLayer({ fc }: { fc?: FeatureCollection | null }) {
  const colors: Record<string, string> = { Ground: '#78350f', Wall: '#f1f5f9', Roof: '#b91c1c' }
  useDataSource(
    'brep',
    true,
    (ds) => {
      for (const f of fc?.features ?? []) {
        const ring = (f.geometry.coordinates as number[][][])[0]
        ds.entities.add({
          id: `surface:${f.properties.id}`,
          polygon: {
            hierarchy: new PolygonHierarchy(ring.map(([lon, lat, z]) => pos(lon, lat, z + 0.02))),
            perPositionHeight: true,
            material: css(colors[f.properties.type] ?? '#fff', 0.95),
            outline: true,
            outlineColor: Color.BLACK,
          },
        })
      }
    },
    [fc],
  )
  return null
}

// ---------------------------------------------------------------------------
// TIN: Primitive dựng từ các tam giác, tô màu theo cao độ
// ---------------------------------------------------------------------------
export function TinLayer({ fc, show, alpha }: { fc?: FeatureCollection; show: boolean; alpha: number }) {
  const { viewer } = useCesium()
  useEffect(() => {
    if (!viewer || !fc?.features.length || !show) return
    const zmin = fc.meta?.zmin ?? 0
    const zmax = fc.meta?.zmax ?? 5
    const instances = fc.features.map((f) => {
      const ring = (f.geometry.coordinates as number[][][])[0].slice(0, 3)
      const arr: number[] = []
      ring.forEach(([lon, lat, z], i) => Cartesian3.pack(pos(lon, lat, z + 0.04), arr, i * 3))
      const values = new Float64Array(arr)
      const zc = (ring[0][2] + ring[1][2] + ring[2][2]) / 3
      return new GeometryInstance({
        id: `tin:${f.properties.id}`,
        geometry: new Geometry({
          attributes: { position: new GeometryAttribute({ componentDatatype: ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values }) } as any,
          indices: new Uint16Array([0, 1, 2]),
          primitiveType: PrimitiveType.TRIANGLES,
          boundingSphere: BoundingSphere.fromVertices(Array.from(values)),
        }),
        attributes: { color: ColorGeometryInstanceAttribute.fromColor(elevColor(zc, zmin, zmax, alpha)) },
      })
    })
    const prim = new Primitive({
      geometryInstances: instances,
      appearance: new PerInstanceColorAppearance({ flat: true, translucent: alpha < 1, closed: false }),
      asynchronous: false,
    })
    viewer.scene.primitives.add(prim)
    viewer.scene.requestRender()
    return () => {
      if (!viewer.isDestroyed()) viewer.scene.primitives.remove(prim)
    }
  }, [viewer, fc, show, alpha])
  return null
}

// ---------------------------------------------------------------------------
// CÔNG TRÌNH NGẦM KHÁC
// ---------------------------------------------------------------------------
export function UtilitiesLayer({ fc, highlight, show }: { fc?: FeatureCollection; highlight?: Highlight; show: boolean }) {
  useDataSource(
    'utilities',
    show,
    (ds) => {
      for (const f of fc?.features ?? []) {
        const p = f.properties
        const { c, a } = colorFor(p.id, highlight?.utilities, highlight?.dimOthers, UTILITY_COLOR[p.kind] ?? '#22c55e')
        const color = css(c, a)
        const positions = (f.geometry.coordinates as number[][]).map(([lon, lat, z]) => pos(lon, lat, z))
        ds.entities.add({
          id: `utility:${p.id}`,
          polyline: { positions, width: 2, material: color, depthFailMaterial: color.withAlpha(0.5), arcType: ArcType.NONE, distanceDisplayCondition: FAR },
          polylineVolume: { positions, shape: circleShape(p.diameter_mm / 2000, 10), material: color, distanceDisplayCondition: NEAR },
        })
      }
    },
    [fc, highlight],
  )
  return null
}

// ---------------------------------------------------------------------------
// ĐIỂM NGẬP, SỰ CỐ, KHU PHỤ TRÁCH
// ---------------------------------------------------------------------------
type GroundZ = ((lon: number, lat: number) => number) | null | undefined

/** Vị trí điểm 2D trên mặt đất: dùng cao độ TIN nếu có (tránh lỗi clamp), nếu không thì clamp */
function groundPos(lon: number, lat: number, gz: GroundZ, lift = 0.6) {
  return gz ? pos(lon, lat, gz(lon, lat) + lift) : Cartesian3.fromDegrees(lon, lat)
}

export function FloodLayer({ fc, show, groundZ }: { fc?: FeatureCollection; show: boolean; groundZ?: GroundZ }) {
  useDataSource(
    'flood',
    show,
    (ds) => {
      for (const f of fc?.features ?? []) {
        const p = f.properties
        const [lon, lat] = f.geometry.coordinates as number[]
        ds.entities.add({
          id: `flood:${p.id}`,
          position: groundPos(lon, lat, groundZ),
          point: {
            pixelSize: 10 + p.max_depth_cm / 5,
            color: css('#0284c7', 0.85),
            outlineColor: Color.WHITE,
            outlineWidth: 2,
            heightReference: groundZ ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${p.name}\n${p.max_depth_cm} cm`,
            font: '12px sans-serif',
            fillColor: Color.WHITE,
            outlineColor: Color.fromCssColorString('#0c4a6e'),
            outlineWidth: 3,
            style: LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: VerticalOrigin.BOTTOM,
            horizontalOrigin: HorizontalOrigin.CENTER,
            pixelOffset: new Cartesian2(0, -14),
            heightReference: groundZ ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
            distanceDisplayCondition: new DistanceDisplayCondition(0, 2500),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      }
    },
    [fc, groundZ],
  )
  return null
}

const INCIDENT_COLOR: Record<string, string> = { new: '#dc2626', accepted: '#f59e0b', in_progress: '#8b5cf6', resolved: '#16a34a', rejected: '#6b7280' }
export function IncidentsLayer({ fc, show, groundZ }: { fc?: FeatureCollection; show: boolean; groundZ?: GroundZ }) {
  useDataSource(
    'incidents',
    show,
    (ds) => {
      for (const f of fc?.features ?? []) {
        const [lon, lat] = f.geometry.coordinates as number[]
        ds.entities.add({
          id: `incident:${f.properties.id}`,
          position: groundPos(lon, lat, groundZ),
          point: {
            pixelSize: 9,
            color: css(INCIDENT_COLOR[f.properties.status] ?? '#000'),
            outlineColor: Color.BLACK,
            outlineWidth: 1,
            heightReference: groundZ ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })
      }
    },
    [fc, groundZ],
  )
  return null
}

export function ZonesLayer({ fc, show }: { fc?: FeatureCollection; show: boolean }) {
  useDataSource(
    'zones',
    show,
    (ds) => {
      const palette = ['#0ea5e9', '#f97316', '#a855f7', '#22c55e']
      fc?.features.forEach((f, i) => {
        const ring = (f.geometry.coordinates as number[][][])[0]
        const positions = Cartesian3.fromDegreesArray(ring.flatMap(([lon, lat]) => [lon, lat]))
        ds.entities.add({ id: `zone:${f.properties.id}`, polyline: { positions, width: 3, clampToGround: true, material: css(palette[i % 4]) } })
        const cx = ring.reduce((s, c) => s + c[0], 0) / ring.length
        const cy = ring.reduce((s, c) => s + c[1], 0) / ring.length
        ds.entities.add({
          position: Cartesian3.fromDegrees(cx, cy, 40),
          label: { text: f.properties.name, font: 'bold 14px sans-serif', fillColor: css(palette[i % 4]), outlineColor: Color.WHITE, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        })
      })
    },
    [fc],
  )
  return null
}

// ---------------------------------------------------------------------------
// LỚP KẾT QUẢ PHÂN TÍCH (điểm va chạm, đường KNN, lưu vực Voronoi, lỗi lòng cống …)
// ---------------------------------------------------------------------------
export function OverlayLayer({ fc, groundZ }: { fc?: FeatureCollection | null; groundZ?: GroundZ }) {
  useDataSource(
    'overlay',
    true,
    (ds) => {
      for (const f of fc?.features ?? []) {
        const p = f.properties
        const color = css(p.__color ?? '#e11d48', p.__alpha ?? 1)
        const g = f.geometry
        if (g.type === 'Point') {
          const [lon, lat, z] = g.coordinates as number[]
          ds.entities.add({
            id: f.id ?? undefined,
            position: z === undefined ? groundPos(lon, lat, groundZ) : pos(lon, lat, z),
            point: {
              pixelSize: p.__size ?? 10,
              color,
              outlineColor: Color.WHITE,
              outlineWidth: 1.5,
              heightReference: z === undefined && !groundZ ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: p.__label
              ? { text: p.__label, font: '11px sans-serif', fillColor: Color.WHITE, outlineColor: Color.BLACK, outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cartesian2(0, -16), disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: new DistanceDisplayCondition(0, 1200) }
              : undefined,
          })
        } else if (g.type === 'LineString') {
          ds.entities.add({
            id: f.id ?? undefined,
            polyline: { positions: Cartesian3.fromDegreesArray((g.coordinates as number[][]).flatMap(([lon, lat]) => [lon, lat])), width: 4, clampToGround: true, material: color },
          })
        } else if (g.type === 'Polygon') {
          const ring = (g.coordinates as number[][][])[0]
          ds.entities.add({
            id: f.id ?? undefined,
            polygon: {
              hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArray(ring.flatMap(([lon, lat]) => [lon, lat]))),
              material: color,
              classificationType: 0 as any, // TERRAIN
            },
          })
        }
      }
    },
    [fc, groundZ],
  )
  return null
}

// ---------------------------------------------------------------------------
// MẶT NƯỚC: polygon trong suốt đặt tại cao độ mực nước
// ---------------------------------------------------------------------------
export function WaterSurface({ level, bounds }: { level: number | null; bounds: [number, number, number, number] | null }) {
  if (level === null || !bounds) return null
  const [w, s, e, n] = bounds
  return (
    <Entity
      id="water-surface"
      rectangle={{
        coordinates: Rectangle.fromDegrees(w, s, e, n),
        height: level + HEIGHT_OFFSET,
        material: css('#0ea5e9', 0.42),
        outline: true,
        outlineColor: css('#0369a1'),
      }}
    />
  )
}
