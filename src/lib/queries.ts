import { useQuery } from '@tanstack/react-query'
import { rpc } from './supabase'
import type { FeatureCollection } from './types'
import { useAuth } from './auth'

/** Các lớp dữ liệu bản đồ – tất cả lấy qua RPC trả GeoJSON (EPSG:4326, có Z) */
export function useMapLayers() {
  const { isStaff, role, loading } = useAuth()
  const enabled = !loading
  const staff = (fn: string) =>
    useQuery({ queryKey: ['layer', fn, role], queryFn: () => rpc<FeatureCollection>(fn), enabled: enabled && isStaff, staleTime: 60_000 })
  const pub = useQuery({ queryKey: ['layer', 'layer_public', role], queryFn: () => rpc<FeatureCollection>('layer_public'), enabled: enabled && !isStaff })
  const flood = useQuery({ queryKey: ['layer', 'layer_flood_points'], queryFn: () => rpc<FeatureCollection>('layer_flood_points'), enabled })
  const incidents = useQuery({
    queryKey: ['layer', 'layer_incidents', role],
    queryFn: () => rpc<FeatureCollection>('layer_incidents'),
    enabled: enabled && role !== 'anon',
  })
  const manholes = staff('layer_manholes')
  const pipes = staff('layer_pipes')
  const buildings = staff('layer_buildings')
  const tin = staff('layer_tin')
  const utilities = staff('layer_utilities')
  const zones = useQuery({ queryKey: ['layer', 'layer_zones', role], queryFn: () => rpc<FeatureCollection>('layer_zones'), enabled: enabled && role !== 'anon' })
  const scenarios = useQuery({
    queryKey: ['rain_scenarios'],
    queryFn: async () => {
      const { supabase } = await import('./supabase')
      const { data, error } = await supabase.from('rain_scenarios').select('*').order('intensity_mm_h')
      if (error) throw error
      return data as { id: number; name: string; intensity_mm_h: number; water_level_m: number }[]
    },
    enabled: enabled && role !== 'anon',
  })

  // khách: tách lớp công khai thành cống / hố ga
  const publicPipes = pub.data && { ...pub.data, features: pub.data.features.filter((f) => f.properties.layer === 'pipe') }
  const publicManholes = pub.data && { ...pub.data, features: pub.data.features.filter((f) => f.properties.layer === 'manhole') }
  return {
    manholes: isStaff ? manholes.data : publicManholes,
    pipes: isStaff ? pipes.data : publicPipes,
    buildings: buildings.data,
    tin: tin.data,
    utilities: utilities.data,
    flood: flood.data,
    incidents: incidents.data,
    zones: zones.data,
    scenarios: scenarios.data ?? [],
    isLoading: [manholes, pipes, pub, flood].some((q) => q.isLoading && q.fetchStatus !== 'idle'),
    errors: [manholes, pipes, buildings, tin, utilities, pub, flood].map((q) => q.error).filter(Boolean) as Error[],
  }
}
