/** Biểu đồ mặt cắt dọc (Q11): cao độ mặt đất (TIN), đỉnh ống, đáy ống theo khoảng cách */
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { FeatureCollection } from '@/lib/types'

export function ProfileChart({ fc, onClose }: { fc: FeatureCollection; onClose: () => void }) {
  const data = fc.features.map((f) => ({ ...f.properties, pipe: [f.properties.invert_m, f.properties.crown_m] }))
  const route = (fc.meta?.route ?? []) as any[]
  return (
    <div className="pointer-events-auto h-64 w-full rounded-lg border bg-background/95 p-2 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between px-1">
        <div className="text-sm font-semibold">
          Q11 – Mặt cắt dọc: {route.map((r) => r.code).join(' → ')}
        </div>
        <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <ResponsiveContainer width="100%" height="88%">
        <ComposedChart data={data} margin={{ top: 4, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="dist_m" type="number" unit=" m" tick={{ fontSize: 10 }} domain={['dataMin', 'dataMax']} />
          <YAxis unit=" m" tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
          <Tooltip formatter={(v: any) => (Array.isArray(v) ? v.map((x) => Number(x).toFixed(2)).join(' – ') : Number(v).toFixed(3))} labelFormatter={(l) => `${Number(l).toFixed(1)} m`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area dataKey="pipe" name="Lòng ống (đáy–đỉnh)" stroke="#2563eb" fill="#93c5fd" fillOpacity={0.6} isAnimationActive={false} />
          <Line dataKey="ground_m" name="Mặt đất (TIN)" stroke="#92400e" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line dataKey="invert_m" name="Cao độ đáy" stroke="#1e3a8a" dot={false} strokeWidth={1} isAnimationActive={false} />
          {route.map((r) => <ReferenceLine key={r.pipe_id} x={r.offset_m} stroke="#94a3b8" strokeDasharray="2 2" />)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
