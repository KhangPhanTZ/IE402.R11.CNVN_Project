import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

export const supabase = createClient(url || 'http://127.0.0.1:54321', anonKey || 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true },
})

/** Gọi RPC; ném Error mang nguyên văn thông báo từ CSDL (lỗi topology / RLS …) */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    const err = new Error(error.message) as Error & { code?: string; details?: string }
    err.code = error.code
    err.details = error.details
    throw err
  }
  return data as T
}
