import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from './supabase'
import type { Role } from './types'

interface Profile {
  id: string
  role: Role
  full_name: string | null
}
interface AuthCtx {
  session: Session | null
  profile: Profile | null
  role: Role | 'anon'
  loading: boolean
  isStaff: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthCtx>(null!)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      return
    }
    setLoading(true)
    supabase
      .from('profiles')
      .select('id, role, full_name')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setProfile((data as Profile) ?? null)
        setLoading(false)
      })
  }, [session])

  const role: Role | 'anon' = profile?.role ?? 'anon'
  const value: AuthCtx = {
    session,
    profile,
    role,
    loading,
    isStaff: role === 'technician' || role === 'admin',
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signOut: async () => {
      await supabase.auth.signOut()
      setProfile(null)
    },
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
