import { NextRequest } from 'next/server'
import { supabaseAdmin } from '../../_shared/supabase-admin'
import { jsonError, requireAdminWallet, safeString } from '../../_shared/security'

const ALLOWED_STATUSES = new Set(['Pending', 'Approved', 'Rejected', 'Paused', 'SoldOut'])

export async function POST(request: NextRequest) {
  try {
    const { wallet } = await requireAdminWallet(request)
    const body = await request.json()
    const productId = safeString(body.productId)
    const nextStatus = safeString(body.status)
    const previousStatus = safeString(body.previousStatus)

    if (!productId) return jsonError('productId is required.')
    if (!ALLOWED_STATUSES.has(nextStatus)) return jsonError('Invalid product status.')

    const supabase = supabaseAdmin()
    const updatedAt = new Date().toISOString()

    const { error: updateError } = await supabase
      .from('products')
      .update({ status: nextStatus, updated_at: updatedAt })
      .eq('id', productId)

    if (updateError) return jsonError(updateError.message, 500)

    const { error: logError } = await supabase.from('admin_logs').insert({
      admin_wallet: wallet,
      action: `product_status_${nextStatus}`,
      target_type: 'product',
      target_id: productId,
      previous_status: previousStatus || null,
      next_status: nextStatus,
      metadata: body.metadata ?? body.detail ?? null,
      detail: {
        source: 'api_route',
        productId,
        previousStatus,
        nextStatus,
        ...(typeof body.detail === 'object' && body.detail ? body.detail : {}),
      },
    })

    if (logError) return jsonError(logError.message, 500)

    return Response.json({ ok: true, productId, status: nextStatus, updatedAt })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 403)
  }
}
