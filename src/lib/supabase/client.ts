import { createClient } from '@supabase/supabase-js'

const rawSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const normalizeSupabaseUrl = (value: string) => {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/storage\/v1$/i, '')
}

export const supabaseUrl = normalizeSupabaseUrl(rawSupabaseUrl)
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
)

export const supabaseClient = supabase
