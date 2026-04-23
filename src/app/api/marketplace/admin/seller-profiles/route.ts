import { NextRequest } from 'next/server'
import { supabaseAdmin } from '../../_shared/supabase-admin'
import { jsonError, requireAdminWallet } from '../../_shared/security'

export async function POST(request: NextRequest) {
  try {
    const { wallet } = await requireAdminWallet(request)
    const body = await request.json()
    const rows = Array.isArray(body.rows) ? body.rows : []

    if (rows.length === 0) return jsonError('rows are required.')

    const supabase = supabaseAdmin()
    const { error } = await supabase.from('seller_profiles').upsert(rows, {
      onConflict: 'seller_wallet',
    })

    if (error) return jsonError(error.message, 500)

    const { error: logError } = await supabase.from('admin_logs').insert({
      admin_wallet: wallet,
      action: 'seller_profiles_sync',
      target_type: 'seller_profiles',
      target_id: null,
      metadata: {
        source: 'api_route',
        seller_count: rows.length,
        synced_sellers: rows.map((row: { seller_wallet?: string }) => row.seller_wallet).filter(Boolean),
      },
      detail: {
        source: 'api_route',
        seller_count: rows.length,
      },
    })

    if (logError) return jsonError(logError.message, 500)

    return Response.json({ ok: true, sellerCount: rows.length })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 403)
  }
}
