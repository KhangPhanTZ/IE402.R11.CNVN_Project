import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export const BUCKET = 'incident-images'

/** Tải ảnh lên thư mục riêng của user: <uid>/<thời gian>-<tên> (khớp policy Storage) */
export async function uploadIncidentImage(uid: string, file: File) {
  const safe = file.name.normalize('NFD').replace(/[^\w.-]+/g, '_')
  const path = `${uid}/${Date.now()}-${safe}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return path
}

export function useSignedUrl(path?: string | null) {
  return useQuery({
    queryKey: ['signed', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path!, 3600)
      if (error) throw error
      return data.signedUrl
    },
  })
}
