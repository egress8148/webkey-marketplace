import { NextRequest } from 'next/server'
import { supabaseAdmin } from '../../_shared/supabase-admin'
import { jsonError, requireAdminWallet, safeString } from '../../_shared/security'

export async function POST(request: NextRequest) {
  try {
    const { wallet } = await requireAdminWallet(request)
    const body = await request.json()
    const action = safeString(body.action)
    const payload = body.payload ?? {}
    const supabase = supabaseAdmin()

    if (action !== 'operation_health_check' && action !== 'backup_snapshot_create') {
      return jsonError('Invalid maintenance action.')
    }

    const { error } = await supabase.from('admin_logs').insert({
      admin_wallet: wallet,
      action,
      target_type: 'marketplace',
      target_id: null,
      metadata: payload,
      detail: {
        source: 'api_route',
        payload,
      },
    })

    if (error) return jsonError(error.message, 500)

    return Response.json({ ok: true, action })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 403)
  }
}
