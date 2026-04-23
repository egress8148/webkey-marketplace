import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 판매자가 자신의 주문 상태를 변경
// PATCH /api/seller/order-status
// body: { orderId, status, tracking_no?, tracking_company? }
// 허용 status: confirmed → shipped → delivered → completed (physical)
//              confirmed → reserved → completed (service/food)
//              confirmed → completed (digital)
//              또는 cancelled/refunded

const ALLOWED = new Set([
  'pending',
  'confirmed',
  'reserved',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'refunded',
])

export async function PATCH(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    if (!wallet) return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    const body = await req.json()
    const { orderId, status, tracking_no, tracking_company, notes } = body

    if (!orderId || !status) {
      return NextResponse.json({ ok: false, message: 'orderId, status 필수' }, { status: 400 })
    }
    if (!ALLOWED.has(status)) {
      return NextResponse.json(
        { ok: false, message: `허용되지 않는 상태 (${status})` },
        { status: 400 },
      )
    }

    const sb = getSupabaseAdmin()
    const { data: order, error: findErr } = await sb
      .from('product_orders')
      .select('id, seller_wallet, status, variant_id, quantity')
      .eq('id', orderId)
      .maybeSingle()
    if (findErr) return NextResponse.json({ ok: false, message: findErr.message }, { status: 500 })
    if (!order) return NextResponse.json({ ok: false, message: '주문 없음' }, { status: 404 })
    if (order.seller_wallet.toLowerCase() !== wallet) {
      return NextResponse.json({ ok: false, message: '본인이 판매한 주문만 변경 가능' }, { status: 403 })
    }

    const patch: Record<string, unknown> = { status }
    const now = new Date().toISOString()
    if (status === 'shipped') patch.shipped_at = now
    if (status === 'delivered') patch.delivered_at = now
    if (status === 'completed') patch.completed_at = now
    if (tracking_no !== undefined) patch.tracking_no = tracking_no
    if (tracking_company !== undefined) patch.tracking_company = tracking_company
    if (notes !== undefined) patch.notes = notes

    // 취소/환불 시 재고 원복
    if ((status === 'cancelled' || status === 'refunded') && order.variant_id) {
      await sb.rpc('release_variant_stock', {
        p_variant_id: order.variant_id,
        p_quantity: order.quantity,
      })
    }

    const { data, error } = await sb
      .from('product_orders')
      .update(patch)
      .eq('id', orderId)
      .select()
      .single()
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, item: data })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
