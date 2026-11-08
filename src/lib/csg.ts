/**
 * BOUNDARY EVALUATION cho cây CSG hố ga (union / difference của các khối trụ đồng trục).
 *
 * Ý tưởng: mọi khối trụ đồng trục là vật thể tròn xoay ⇒ biểu diễn bằng mặt cắt (r, z) ở nửa mặt phẳng r ≥ 0.
 *   1. Lấy toàn bộ mốc bán kính {0, r_i} và mốc cao độ {z0_i, z0_i + h_i} → lưới ô chữ nhật trên (r, z).
 *   2. Phân loại điểm (point membership classification): tâm mỗi ô được đánh giá qua cây CSG
 *      (primitive: r ≤ R ∧ z0 ≤ z ≤ z0+h; union: OR; difference: A AND NOT(B ∪ C …)).
 *   3. Biên của khối = các cạnh ô ngăn cách ô "trong" và ô "ngoài".
 *      Cạnh đứng tại r = R  → quay quanh trục thành dải mặt trụ;
 *      cạnh ngang tại z = Z → quay thành hình vành khăn / đĩa.
 *   4. Rời rạc hoá góc θ thành N đoạn → lưới tam giác (positions, normals, indices) trong hệ ENU cục bộ.
 */
import type { CsgNode } from './types'

export interface CsgTree extends CsgNode {
  children: CsgTree[]
}
export interface Mesh {
  positions: Float64Array
  normals: Float32Array
  indices: Uint32Array
  zMin: number
  zMax: number
  rMax: number
}

export function buildCsgTree(nodes: CsgNode[] | null | undefined): CsgTree | null {
  if (!nodes?.length) return null
  const map = new Map<number, CsgTree>(nodes.map((n) => [n.id, { ...n, children: [] }]))
  let root: CsgTree | null = null
  for (const n of map.values()) {
    if (n.parent_id == null) root = n
    else map.get(n.parent_id)?.children.push(n)
  }
  for (const n of map.values()) n.children.sort((a, b) => a.ord - b.ord)
  return root
}

/** Phân loại điểm (r, z) đối với cây CSG */
export function inside(t: CsgTree, r: number, z: number): boolean {
  switch (t.op) {
    case 'primitive': {
      const p = t.params
      return r <= p.radius && z >= p.z0 && z <= p.z0 + p.height
    }
    case 'union':
      return t.children.some((c) => inside(c, r, z))
    case 'difference': {
      const [a, ...rest] = t.children
      return !!a && inside(a, r, z) && !rest.some((c) => inside(c, r, z))
    }
  }
}

function collect(t: CsgTree, rs: Set<number>, zs: Set<number>) {
  if (t.op === 'primitive') {
    rs.add(t.params.radius)
    zs.add(t.params.z0)
    zs.add(t.params.z0 + t.params.height)
  }
  t.children.forEach((c) => collect(c, rs, zs))
}

export function evaluateCsg(tree: CsgTree, segments = 24): Mesh {
  const rsSet = new Set<number>([0])
  const zsSet = new Set<number>()
  collect(tree, rsSet, zsSet)
  const rs = [...rsSet].sort((a, b) => a - b)
  const zs = [...zsSet].sort((a, b) => a - b)
  const nr = rs.length - 1
  const nz = zs.length - 1
  const cell = (i: number, j: number) =>
    i >= 0 && i < nr && j >= 0 && j < nz && inside(tree, (rs[i] + rs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2)

  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const cos = Array.from({ length: segments + 1 }, (_, k) => Math.cos((2 * Math.PI * k) / segments))
  const sin = Array.from({ length: segments + 1 }, (_, k) => Math.sin((2 * Math.PI * k) / segments))

  // dải mặt trụ bán kính r, từ z1 → z2; sign = +1: pháp tuyến hướng ra ngoài
  const band = (r: number, z1: number, z2: number, sign: number) => {
    for (let k = 0; k < segments; k++) {
      const b = pos.length / 3
      for (const [kk, z] of [[k, z1], [k + 1, z1], [k + 1, z2], [k, z2]] as const) {
        pos.push(r * cos[kk], r * sin[kk], z)
        nor.push(sign * cos[kk], sign * sin[kk], 0)
      }
      if (sign > 0) idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
      else idx.push(b, b + 2, b + 1, b, b + 3, b + 2)
    }
  }
  // vành khăn r1 → r2 tại cao độ z; sign = +1: mặt trên (pháp tuyến +z)
  const ring = (r1: number, r2: number, z: number, sign: number) => {
    for (let k = 0; k < segments; k++) {
      const b = pos.length / 3
      for (const [kk, r] of [[k, r1], [k + 1, r1], [k + 1, r2], [k, r2]] as const) {
        pos.push(r * cos[kk], r * sin[kk], z)
        nor.push(0, 0, sign)
      }
      if (sign > 0) idx.push(b, b + 2, b + 1, b, b + 3, b + 2)
      else idx.push(b, b + 1, b + 2, b, b + 2, b + 3)
    }
  }

  for (let j = 0; j < nz; j++) {
    for (let i = 1; i <= nr; i++) {
      const a = cell(i - 1, j)
      const b = cell(i, j)
      if (a !== b) band(rs[i], zs[j], zs[j + 1], a ? 1 : -1)
    }
  }
  for (let i = 0; i < nr; i++) {
    for (let j = 0; j <= nz; j++) {
      const below = cell(i, j - 1)
      const above = cell(i, j)
      if (below !== above) ring(rs[i], rs[i + 1], zs[j], below ? 1 : -1)
    }
  }
  let zMin = Infinity
  let zMax = -Infinity
  for (let k = 2; k < pos.length; k += 3) {
    zMin = Math.min(zMin, pos[k])
    zMax = Math.max(zMax, pos[k])
  }
  return {
    positions: new Float64Array(pos),
    normals: new Float32Array(nor),
    indices: new Uint32Array(idx),
    zMin,
    zMax,
    rMax: rs[rs.length - 1],
  }
}

/** Mô tả cây CSG dạng văn bản (cho tab KG của popup) */
export function describeCsg(t: CsgTree | null, depth = 0): string {
  if (!t) return '—'
  const pad = '  '.repeat(depth)
  if (t.op === 'primitive') {
    const p = t.params
    return `${pad}cylinder[${p.role ?? ''}] R=${p.radius.toFixed(2)} z0=${p.z0.toFixed(2)} h=${p.height.toFixed(2)}`
  }
  return `${pad}${t.op.toUpperCase()}\n${t.children.map((c) => describeCsg(c, depth + 1)).join('\n')}`
}
