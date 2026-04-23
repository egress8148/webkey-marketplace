import { createClient } from '@supabase/supabase-js'

const cleanSupabaseUrl = (value?: string) =>
  (value || '').replace(/\/+rest\/v1\/?$/i, '').replace(/\/+$/, '')

const supabaseUrl = cleanSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export const hasSupabaseServerConfig = Boolean(supabaseUrl && serviceRoleKey)

export const getSupabaseAdminClient = () => {
  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not configured.')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured. This key must be server-only.')
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}
