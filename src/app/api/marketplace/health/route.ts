import { NextRequest } from 'next/server'
import { hasSupabaseServerConfig, getSupabaseAdminClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const adminWallet = process.env.NEXT_PUBLIC_ADMIN_WALLET || ''

  if (!hasSupabaseServerConfig) {
    return Response.json({
      ok: false,
      message: 'Server Supabase config is incomplete.',
      hasUrl,
      hasServiceRole,
      hasAdminWallet: Boolean(adminWallet),
    })
  }

  try {
    const supabase = getSupabaseAdminClient()
    const { count, error } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })

    if (error) {
      return Response.json({
        ok: false,
        message: error.message,
        hasUrl,
        hasServiceRole,
        hasAdminWallet: Boolean(adminWallet),
      })
    }

    return Response.json({
      ok: true,
      message: 'Server Supabase connection is ready.',
      productsCount: count ?? 0,
      hasUrl,
      hasServiceRole,
      hasAdminWallet: Boolean(adminWallet),
    })
  } catch (error) {
    return Response.json({
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown server health error.',
      hasUrl,
      hasServiceRole,
      hasAdminWallet: Boolean(adminWallet),
    })
  }
}
