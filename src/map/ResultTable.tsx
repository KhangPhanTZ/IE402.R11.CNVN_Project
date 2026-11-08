import { useState } from 'react'
import { ChevronDown, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/feedback'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import type { Feature } from '@/lib/types'
import { exportCSV, exportGeoJSON } from '@/lib/export'
import { fieldLabel, fieldUnit, formatField, FIELDS } from '@/lib/fields'
import { cn } from '@/lib/utils'
import type { AnalysisResult } from './AnalysisPanel'

const HIDE = new Set(['layer', 'csg', 'valid_to', 'tx_to', 'vid', 'public', 'detail', 'route', 'manholes', 'user_id', 'technician_id'])
const NUMERIC = new Set(['num', 'int', 'pct', 'slope'])

function Cell({ k, v }: { k: string; v: unknown }) {
  if (k === 'overloaded' || k === 'has_basement') return v ? <Badge variant={k === 'overloaded' ? 'destructive' : 'info'}>Có</Badge> : <span className="text-subtle">Không</span>
  if (k === 'ratio' && (v === null || v === undefined)) return <Badge variant="destructive">Không thoát được</Badge>
  if (k === 'ratio' && typeof v === 'number') {
    const pct = Math.min(v, 2) / 2
    return (
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className={cn('block h-full rounded-full', v >= 1 ? 'bg-danger' : v >= 0.8 ? 'bg-orange-500' : v >= 0.5 ? 'bg-yellow-500' : 'bg-success')} style={{ width: `${pct * 100}%` }} />
        </span>
        {formatField(k, v)}
      </span>
    )
  }
  return <>{formatField(k, v, false)}</>
}

export function ResultTable({ result, onRow, onClose }: { result: AnalysisResult; onRow: (f: Feature) => void; onClose: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const feats = result.fc?.features ?? []
  const cols = Array.from(new Set(feats.slice(0, 20).flatMap((f) => Object.keys(f.properties))))
    .filter((c) => !c.startsWith('__') && !HIDE.has(c))
    .sort((a, b) => Number(!!FIELDS[b]) - Number(!!FIELDS[a]))
    .slice(0, 8)
  return (
    <section className="map-panel pointer-events-auto flex max-h-72 w-full flex-col overflow-hidden animate-fade-in" aria-label="Kết quả phân tích">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2">
        <button className="flex items-center gap-1.5 text-left" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
          <ChevronDown className={cn('size-4 text-subtle transition-transform', collapsed && '-rotate-90')} aria-hidden />
          <span className="text-sm font-semibold">{result.title}</span>
        </button>
        <Badge variant="secondary">{feats.length} kết quả</Badge>
        {result.summary && <span className="text-sm text-muted-foreground">{result.summary}</span>}
        <div className="flex flex-wrap items-center gap-3">
          {result.highlight?.legend?.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="inline-block size-2.5 rounded-sm" style={{ background: l.color }} aria-hidden />{l.label}
            </span>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          {feats.length > 0 && result.fc && (
            <>
              <Button size="xs" variant="ghost" onClick={() => exportCSV(result.key, result.fc!)}><Download />CSV</Button>
              <Button size="xs" variant="ghost" onClick={() => exportGeoJSON(result.key, result.fc!)}><Download />GeoJSON</Button>
            </>
          )}
          <Button size="xs" variant="outline" onClick={onClose}><X />Xoá kết quả</Button>
        </div>
      </header>
      {!collapsed && (feats.length === 0 ? (
        <EmptyState tone="success" title={result.emptyText ?? 'Không có kết quả'} description="Thử đổi tham số hoặc chọn truy vấn khác trong panel bên trái." />
      ) : (
        <div className="overflow-auto">
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                {cols.map((c) => (
                  <TH key={c} className={cn(NUMERIC.has(FIELDS[c]?.fmt ?? '') && 'text-right')}>
                    {fieldLabel(c)}{fieldUnit(c) && <span className="ml-1 font-normal text-subtle">({fieldUnit(c)})</span>}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {feats.slice(0, 300).map((f, i) => (
                <TR key={i} className="cursor-pointer" tabIndex={0} onClick={() => onRow(f)} onKeyDown={(e) => e.key === 'Enter' && onRow(f)}>
                  {cols.map((c) => (
                    <TD key={c} className={cn('max-w-[240px] truncate', NUMERIC.has(FIELDS[c]?.fmt ?? '') && 'text-right')}>
                      <Cell k={c} v={f.properties[c]} />
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      ))}
    </section>
  )
}
