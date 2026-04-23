import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'
import { buildBuyerOrderEmail, buildSellerOrderEmail } from '@/lib/resend'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RESERVATION_TTL_MIN = 30

// GET /api/buyer/product-orders?wallet=0x..
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const wallet = (
      url.searchParams.get('wallet') ||
      req.headers.get('x-wallet-address') ||
      ''
    ).toLowerCase()
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    }
    const { data, error } = await getSupabaseAdmin()
      .from('v_orders_detailed')
      .select('*')
      .eq('buyer_wallet', wallet)
      .order('ordered_at', { ascending: false })
      .limit(200)
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, items: data ?? [] })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

// POST /api/buyer/product-orders
// body: { productId, variantId?, quantity, options_snapshot, delivery_info? }
export async function POST(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    }
    const body = await req.json()
    const { productId, variantId, quantity, options_snapshot, delivery_info } = body
    if (!productId) {
      return NextResponse.json({ ok: false, message: 'productId 필요' }, { status: 400 })
    }
    const qty = Math.max(1, Number(quantity ?? 1))

    const sb = getSupabaseAdmin()

    const { data: product, error: pErr } = await sb
      .from('seller_requests')
      .select('id, seller_wallet, price_usdt, status')
      .eq('id', productId)
      .maybeSingle()
    if (pErr) return NextResponse.json({ ok: false, message: pErr.message }, { status: 500 })
    if (!product) return NextResponse.json({ ok: false, message: '상품 없음' }, { status: 404 })
    if (product.status !== 'Approved') {
      return NextResponse.json({ ok: false, message: '승인된 상품만 구매 가능' }, { status: 400 })
    }

    let resolvedVariantId: string | null = null
    if (variantId) {
      const { data: variant, error: vErr } = await sb
        .from('product_variants')
        .select('id, stock, reserved, is_active, product_id')
        .eq('id', variantId)
        .maybeSingle()
      if (vErr) return NextResponse.json({ ok: false, message: vErr.message }, { status: 500 })
      if (!variant || !variant.is_active || variant.product_id !== productId) {
        return NextResponse.json({ ok: false, message: '옵션 유효하지 않음' }, { status: 400 })
      }
      const available = (variant.stock || 0) - (variant.reserved || 0)
      if (available < qty) {
        return NextResponse.json(
          { ok: false, message: `재고 부족 (가용 ${available})` },
          { status: 400 },
        )
      }
      const { data: reserved, error: rErr } = await sb.rpc('reserve_variant_stock', {
        p_variant_id: variantId,
        p_quantity: qty,
      })
      if (rErr || reserved === false) {
        return NextResponse.json(
          { ok: false, message: rErr?.message || '재고 예약 실패' },
          { status: 400 },
        )
      }
      resolvedVariantId = variantId
    }

    const priceUsdt = Number(product.price_usdt || 0)
    const totalUsdt6 = Math.round(priceUsdt * qty * 1_000_000)
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MIN * 60_000)

    const { data: order, error: oErr } = await sb
      .from('product_orders')
      .insert({
        product_id: productId,
        variant_id: resolvedVariantId,
        buyer_wallet: wallet,
        seller_wallet: product.seller_wallet,
        quantity: qty,
        options_snapshot: options_snapshot || {},
        total_usdt6: totalUsdt6,
        status: 'pending',
        delivery_info: delivery_info || {},
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single()
    if (oErr) {
      if (resolvedVariantId) {
        await sb.rpc('release_variant_stock', {
          p_variant_id: resolvedVariantId,
          p_quantity: qty,
        })
      }
      return NextResponse.json({ ok: false, message: oErr.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      item: order,
      reservation: { expiresAt: expiresAt.toISOString(), ttlMinutes: RESERVATION_TTL_MIN },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

// PATCH /api/buyer/product-orders
// body: { orderId, tx_hash, total_dao2 }
// → confirmed + 재고 영구 차감 + 이메일 큐(구매자+판매자)
export async function PATCH(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    if (!wallet) return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    const body = await req.json()
    const { orderId, tx_hash, total_dao2 } = body
    if (!orderId || !tx_hash) {
      return NextResponse.json({ ok: false, message: 'orderId, tx_hash 필수' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()

    const { data: order, error: findErr } = await sb
      .from('product_orders')
      .select('id, buyer_wallet, variant_id, quantity, status, product_id, delivery_info, options_snapshot, total_usdt6, seller_wallet')
      .eq('id', orderId)
      .maybeSingle()
    if (findErr) return NextResponse.json({ ok: false, message: findErr.message }, { status: 500 })
    if (!order) return NextResponse.json({ ok: false, message: '주문 없음' }, { status: 404 })
    if (order.buyer_wallet.toLowerCase() !== wallet) {
      return NextResponse.json({ ok: false, message: '본인 주문만 가능' }, { status: 403 })
    }
    if (order.status !== 'pending') {
      return NextResponse.json(
        { ok: false, message: `현재 상태(${order.status})에서 confirm 불가` },
        { status: 400 },
      )
    }

    // 재고 영구 차감
    if (order.variant_id) {
      await sb.rpc('confirm_variant_sale', {
        p_variant_id: order.variant_id,
        p_quantity: order.quantity,
      })
    }

    // 상태 업데이트
    const { data: updated, error: updErr } = await sb
      .from('product_orders')
      .update({
        status: 'confirmed',
        tx_hash,
        total_dao2: total_dao2 != null ? Number(total_dao2) : null,
        expires_at: null,
      })
      .eq('id', orderId)
      .select()
      .single()
    if (updErr) {
      return NextResponse.json({ ok: false, message: updErr.message }, { status: 500 })
    }

    // 상품 정보
    const { data: product } = await sb
      .from('seller_requests')
      .select('title, product_type, price_usdt')
      .eq('id', order.product_id)
      .maybeSingle()

    // 이메일 큐 생성 (구매자 + 판매자)
    try {
      const deliveryInfo = (order.delivery_info || {}) as Record<string, unknown>
      const buyerEmail = String(deliveryInfo.email || deliveryInfo.buyer_email || '')

      const totalUsdt = ((order.total_usdt6 || 0) / 1_000_000).toFixed(2)

      if (buyerEmail && product) {
        const msg = buildBuyerOrderEmail({
          productTitle: product.title || '',
          productType: product.product_type || 'physical',
          quantity: order.quantity,
          options: order.options_snapshot || {},
          totalUsdt,
          txHash: tx_hash,
        })
        await sb.rpc('enqueue_order_email', {
          p_order_id: orderId,
          p_to_address: buyerEmail,
          p_to_role: 'buyer',
          p_subject: msg.subject,
          p_body_html: msg.html,
          p_body_text: msg.text,
        })
      }

      // 판매자 이메일 (seller_requests 또는 env 에서 받을 수 없으니, delivery_info.seller_email 또는 시스템 notify)
      // 1) seller_profiles 테이블이 있으면 거기서 조회
      const { data: sellerProfile } = await sb
        .from('seller_profiles')
        .select('email')
        .eq('seller_wallet', order.seller_wallet)
        .maybeSingle()
        .then((r) => r, () => ({ data: null }))

      const sellerEmail = sellerProfile?.email || process.env.ADMIN_NOTIFY_EMAIL || ''
      if (sellerEmail && product) {
        const msg = buildSellerOrderEmail({
          productTitle: product.title || '',
          productType: product.product_type || 'physical',
          quantity: order.quantity,
          options: order.options_snapshot || {},
          buyerWallet: order.buyer_wallet,
          deliveryInfo: (order.delivery_info || {}) as Record<string, unknown>,
          totalUsdt,
        })
        await sb.rpc('enqueue_order_email', {
          p_order_id: orderId,
          p_to_address: sellerEmail,
          p_to_role: 'seller',
          p_subject: msg.subject,
          p_body_html: msg.html,
          p_body_text: msg.text,
        })
      }
    } catch {
      // 이메일 큐 실패는 주문 확정에 영향 없음
    }

    return NextResponse.json({ ok: true, item: updated })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

// DELETE /api/buyer/product-orders?id=<uuid>
export async function DELETE(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    if (!wallet) return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, message: 'id 필요' }, { status: 400 })

    const sb = getSupabaseAdmin()
    const { data: order, error } = await sb
      .from('product_orders')
      .select('id, buyer_wallet, variant_id, quantity, status')
      .eq('id', id)
      .maybeSingle()
    if (error) return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    if (!order) return NextResponse.json({ ok: false, message: '주문 없음' }, { status: 404 })
    if (order.buyer_wallet.toLowerCase() !== wallet) {
      return NextResponse.json({ ok: false, message: '본인 주문만 취소 가능' }, { status: 403 })
    }
    if (order.status !== 'pending') {
      return NextResponse.json({ ok: false, message: `${order.status} 상태는 취소 불가` }, { status: 400 })
    }
    if (order.variant_id) {
      await sb.rpc('release_variant_stock', {
        p_variant_id: order.variant_id,
        p_quantity: order.quantity,
      })
    }
    await sb
      .from('product_orders')
      .update({ status: 'cancelled', expires_at: null })
      .eq('id', id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
