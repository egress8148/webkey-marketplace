import { getSupabaseAdminClient } from '@/lib/supabase/server'

export const supabaseAdmin = () => getSupabaseAdminClient()
