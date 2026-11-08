import type { FeatureCollection } from './types'

function download(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function exportGeoJSON(name: string, fc: FeatureCollection) {
  download(`${name}.geojson`, JSON.stringify({ type: 'FeatureCollection', features: fc.features }, null, 1), 'application/geo+json')
}

/** CSV: thuộc tính + cột WKT-lite (toạ độ đầu tiên) để mở được trong Excel/QGIS */
export function exportCSV(name: string, fc: FeatureCollection) {
  const cols = Array.from(new Set(fc.features.flatMap((f) => Object.keys(f.properties).filter((k) => typeof f.properties[k] !== 'object' || f.properties[k] === null))))
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const first = (g: any): number[] => (typeof g?.[0] === 'number' ? g : first(g?.[0]))
  const lines = [[...cols, 'geom_type', 'lon', 'lat', 'z'].join(',')]
  for (const f of fc.features) {
    const c = first(f.geometry?.coordinates) ?? []
    lines.push([...cols.map((k) => esc(f.properties[k])), f.geometry?.type, c[0], c[1], c[2] ?? ''].join(','))
  }
  download(`${name}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8')
}
