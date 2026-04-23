import { NextRequest } from 'next/server'
import { supabaseAdmin } from '../../_shared/supabase-admin'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest) {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const hasServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  const hasAdminWallet = Boolean(process.env.ADMIN_WALLET || process.env.NEXT_PUBLIC_ADMIN_WALLET)

  if (!hasUrl || !hasServiceRole) {
    return Response.json({
      ok: false,
      message: 'Server Supabase config is incomplete.',
      hasUrl,
      hasServiceRole,
      hasAdminWallet,
    })
  }

  try {
    const { count, error } = await supabaseAdmin()
      .from('products')
      .select('id', { count: 'exact', head: true })

    if (error) {
      return Response.json({
        ok: false,
        message: error.message,
        hasUrl,
        hasServiceRole,
        hasAdminWallet,
      })
    }

    return Response.json({
      ok: true,
      message: 'Server Supabase connection is ready.',
      productsCount: count ?? 0,
      hasUrl,
      hasServiceRole,
      hasAdminWallet,
    })
  } catch (error) {
    return Response.json({
      ok: false,
      message: error instanceof Error ? error.message : 'Unknown server health error.',
      hasUrl,
      hasServiceRole,
      hasAdminWallet,
    })
  }
}
