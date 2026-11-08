import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Viewer, useCesium } from 'resium'
import {
  Cartesian3,
  Cartographic,
  Color,
  createWorldImageryAsync,
  createWorldTerrainAsync,
  EllipsoidTerrainProvider,
  ImageryLayer,
  Ion,
  Math as CMath,
  OpenStreetMapImageryProvider,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  type Viewer as CViewer,
} from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import type { FeatureCollection } from '@/lib/types'
import { CENTER, CESIUM_TOKEN, HEIGHT_OFFSET, tinTerrainProvider } from './cesiumUtil'

if (CESIUM_TOKEN) Ion.defaultAccessToken = CESIUM_TOKEN

export type TerrainMode = 'ellipsoid' | 'tin' | 'world'
export interface PickInfo {
  id: string | null // vd "pipe:12", "manhole:5"
  lon: number | null
  lat: number | null
  height: number | null
}

interface Props {
  children?: ReactNode
  alpha: number // độ đục mặt đất (globe translucency)
  terrain: TerrainMode
  tin?: FeatureCollection
  onReady?: (v: CViewer) => void
  onPick?: (p: PickInfo) => void
  className?: string
}

const CONTEXT_OPTIONS = { webgl: { preserveDrawingBuffer: true } }
const ELLIPSOID = new EllipsoidTerrainProvider()

/** Khởi tạo scene một lần khi Viewer đã sẵn sàng (component con ⇒ useCesium() có viewer) */
function Init({ alpha, onReady, pickRef }: { alpha: number; onReady: (v: CViewer) => void; pickRef: React.MutableRefObject<Props['onPick']> }) {
  const { viewer: v } = useCesium()
  useEffect(() => {
    if (!v) return
    const scene = v.scene
    v.imageryLayers.removeAll()
    if (CESIUM_TOKEN) {
      createWorldImageryAsync().then((p) => !v.isDestroyed() && v.imageryLayers.addImageryProvider(p))
    } else {
      v.imageryLayers.add(new ImageryLayer(new OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/' })))
    }
    const globe = scene.globe
    globe.baseColor = Color.fromCssColorString('#dfe7e1') // nền sáng khi chưa có ảnh nền
    globe.depthTestAgainstTerrain = true
    globe.translucency.enabled = true // NHÌN XUYÊN ĐẤT
    globe.translucency.frontFaceAlpha = alpha
    globe.translucency.backFaceAlpha = alpha
    globe.showGroundAtmosphere = false
    scene.screenSpaceCameraController.enableCollisionDetection = false // cho phép camera chui xuống dưới mặt đất
    scene.screenSpaceCameraController.minimumZoomDistance = 2
    scene.fog.enabled = false
    scene.camera.setView({
      destination: Cartesian3.fromDegrees(CENTER.lon, CENTER.lat - 0.0105, 850 + HEIGHT_OFFSET),
      orientation: { heading: 0, pitch: CMath.toRadians(-38), roll: 0 },
    })
    const handler = new ScreenSpaceEventHandler(scene.canvas)
    handler.setInputAction((e: { position: any }) => {
      const picked = scene.pick(e.position)
      let id: string | null = null
      if (picked) {
        const raw = picked.id ?? picked.primitive?.id
        id = typeof raw === 'string' ? raw : typeof raw?.id === 'string' ? raw.id : null
      }
      let lon: number | null = null, lat: number | null = null, height: number | null = null
      const ray = scene.camera.getPickRay(e.position)
      const c3 = (ray && globe.pick(ray, scene)) || scene.camera.pickEllipsoid(e.position)
      if (c3) {
        const c = Cartographic.fromCartesian(c3)
        lon = CMath.toDegrees(c.longitude)
        lat = CMath.toDegrees(c.latitude)
        height = c.height - HEIGHT_OFFSET
      }
      pickRef.current?.({ id, lon, lat, height })
    }, ScreenSpaceEventType.LEFT_CLICK)
    if (import.meta.env.DEV) (window as any).__viewer = v // tiện kiểm thử tự động
    onReady(v)
    return () => handler.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v])
  return null
}

export function MapView({ children, alpha, terrain, tin, onReady, onPick, className }: Props) {
  const [viewer, setViewer] = useState<CViewer | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  // Thanh trượt độ trong suốt mặt đất
  useEffect(() => {
    if (!viewer) return
    viewer.scene.globe.translucency.frontFaceAlpha = alpha
    viewer.scene.globe.translucency.backFaceAlpha = alpha
    viewer.scene.requestRender()
  }, [viewer, alpha])

  // Địa hình: Ellipsoid / TIN tuỳ biến / Cesium World Terrain (cần token)
  useEffect(() => {
    if (!viewer) return
    if (terrain === 'world' && CESIUM_TOKEN) {
      createWorldTerrainAsync().then((t) => !viewer.isDestroyed() && (viewer.terrainProvider = t))
    } else if (terrain === 'tin' && tin?.features.length) {
      viewer.terrainProvider = tinTerrainProvider(tin)
    } else {
      viewer.terrainProvider = ELLIPSOID
    }
  }, [viewer, terrain, tin])

  return (
    <Viewer
      className={className ?? 'absolute inset-0'}
      animation={false}
      timeline={false}
      baseLayerPicker={false}
      geocoder={false}
      homeButton={false}
      sceneModePicker={false}
      navigationHelpButton={false}
      fullscreenButton={false}
      infoBox={false}
      selectionIndicator={false}
      baseLayer={false}
      terrainProvider={ELLIPSOID}
      contextOptions={CONTEXT_OPTIONS}
    >
      <Init alpha={alpha} pickRef={pickRef} onReady={(v) => { setViewer(v); onReady?.(v) }} />
      {viewer && children}
    </Viewer>
  )
}

export function flyTo(viewer: CViewer | null, lon: number, lat: number, z = 0, range = 160) {
  if (!viewer) return
  viewer.camera.flyTo({
    destination: Cartesian3.fromDegrees(lon, lat - range / 111_000 / 1.3, z + range * 0.75 + HEIGHT_OFFSET),
    orientation: { heading: 0, pitch: CMath.toRadians(-40), roll: 0 },
    duration: 1.2,
  })
}
