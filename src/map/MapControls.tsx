/** Bộ điều khiển bản đồ nổi: zoom, la bàn (về hướng Bắc), góc nhìn 2D/3D, về toàn cảnh, toàn màn hình */
import { useEffect, useState, type ReactNode } from 'react'
import { BoundingSphere, Cartesian2, Cartesian3, HeadingPitchRange, Math as CMath, type Viewer as CViewer } from 'cesium'
import { Box, Home, Maximize, Minimize, Minus, Navigation2, Plus, Square } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { CENTER, HEIGHT_OFFSET } from './cesiumUtil'

function Ctl({ label, onClick, children, active }: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
  return (
    <Tooltip content={label} side="left">
      <button onClick={onClick} aria-label={label}
        className={cn('flex size-9 items-center justify-center text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&_svg]:size-[18px]', active && 'text-primary')}>
        {children}
      </button>
    </Tooltip>
  )
}

export function MapControls({ viewer, className }: { viewer: CViewer | null; className?: string }) {
  const [heading, setHeading] = useState(0)
  const [topDown, setTopDown] = useState(false)
  const [full, setFull] = useState(!!document.fullscreenElement)

  useEffect(() => {
    if (!viewer) return
    const cam = viewer.camera
    cam.percentageChanged = 0.01
    const off = cam.changed.addEventListener(() => {
      setHeading(CMath.toDegrees(cam.heading))
      setTopDown(cam.pitch < CMath.toRadians(-80))
    })
    const onFs = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => { off(); document.removeEventListener('fullscreenchange', onFs) }
  }, [viewer])

  const zoom = (k: number) => {
    if (!viewer) return
    const h = viewer.camera.positionCartographic.height
    k > 0 ? viewer.camera.zoomIn(Math.max(h * 0.4, 20)) : viewer.camera.zoomOut(Math.max(h * 0.6, 20))
  }
  const orient = (heading: number, pitch: number) => {
    if (!viewer) return
    const scene = viewer.scene
    const ray = viewer.camera.getPickRay(new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2))
    const center = ray && scene.globe.pick(ray, scene)
    if (!center) return viewer.camera.flyTo({ destination: viewer.camera.position, orientation: { heading, pitch, roll: 0 }, duration: 0.6 })
    const range = Cartesian3.distance(viewer.camera.position, center)
    viewer.camera.flyToBoundingSphere(new BoundingSphere(center, 1), { offset: new HeadingPitchRange(heading, pitch, range), duration: 0.8 })
  }
  const home = () =>
    viewer?.camera.flyTo({
      destination: Cartesian3.fromDegrees(CENTER.lon, CENTER.lat - 0.0105, 850 + HEIGHT_OFFSET),
      orientation: { heading: 0, pitch: CMath.toRadians(-38), roll: 0 },
      duration: 1.2,
    })

  return (
    <div className={cn('pointer-events-auto flex flex-col gap-2', className)}>
      <div className="glass-panel flex flex-col divide-y divide-slate-200/70 overflow-hidden">
        <Ctl label="Phóng to" onClick={() => zoom(1)}><Plus /></Ctl>
        <Ctl label="Thu nhỏ" onClick={() => zoom(-1)}><Minus /></Ctl>
      </div>
      <div className="glass-panel flex flex-col divide-y divide-slate-200/70 overflow-hidden">
        <Ctl label="Về hướng Bắc" onClick={() => orient(0, viewer?.camera.pitch ?? -0.7)}>
          <Navigation2 style={{ transform: `rotate(${-heading}deg)` }} className="fill-primary/15 transition-transform" />
        </Ctl>
        <Ctl label={topDown ? 'Góc nhìn 3D' : 'Nhìn từ trên xuống (2D)'} onClick={() => orient(viewer?.camera.heading ?? 0, topDown ? CMath.toRadians(-40) : CMath.toRadians(-89.9))} active={topDown}>
          {topDown ? <Box /> : <Square />}
        </Ctl>
        <Ctl label="Về toàn cảnh khu vực" onClick={home}><Home /></Ctl>
        <Ctl label={full ? 'Thoát toàn màn hình' : 'Toàn màn hình'} onClick={() => (full ? document.exitFullscreen() : document.documentElement.requestFullscreen())}>
          {full ? <Minimize /> : <Maximize />}
        </Ctl>
      </div>
    </div>
  )
}
