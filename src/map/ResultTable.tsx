import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import type { Feature } from '@/lib/types'
import { exportCSV, exportGeoJSON } from '@/lib/export'
import type { AnalysisResult } from './AnalysisPanel'

const fmt = (v: unknown) => (v === null || v === undefined ? '—' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v))

export function ResultTable({ result, onRow, onClose }: { result: AnalysisResult; onRow: (f: Feature) => void; onClose: () => void }) {
  const feats = result.fc?.features ?? []
  const cols = Array.from(new Set(feats.slice(0, 20).flatMap((f) => Object.keys(f.properties)))).filter((c) => !c.startsWith('__') && !['layer', 'csg', 'valid_to', 'tx_to'].includes(c)).slice(0, 9)
  return (
    <div className="pointer-events-auto flex max-h-64 w-full flex-col rounded-lg border bg-background/95 shadow-xl backdrop-blur">
      <div className="flex items-center gap-2 border-b px-2 py-1">
        <div className="flex-1 text-sm font-semibold">{result.title} <span className="font-normal text-muted-foreground">· {feats.length} dòng {result.summary && `· ${result.summary}`}</span></div>
        {result.highlight?.legend?.map((l) => (
          <span key={l.label} className="flex items-center gap-1 text-[11px]"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: l.color }} />{l.label}</span>
        ))}
        {result.fc && feats.length > 0 && (
          <>
            <Button size="xs" variant="outline" onClick={() => exportGeoJSON(result.key, result.fc!)}>GeoJSON</Button>
            <Button size="xs" variant="outline" onClick={() => exportCSV(result.key, result.fc!)}>CSV</Button>
          </>
        )}
        <Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>
      <div className="overflow-auto">
        <Table>
          <THead><TR>{cols.map((c) => <TH key={c}>{c}</TH>)}</TR></THead>
          <TBody>
            {feats.slice(0, 300).map((f, i) => (
              <TR key={i} className="cursor-pointer" onClick={() => onRow(f)}>
                {cols.map((c) => <TD key={c} className="max-w-[220px] truncate">{fmt(f.properties[c])}</TD>)}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  )
}
