import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getWallet(req: NextRequest): string {
  return (req.headers.get('x-wallet-address') || '').toLowerCase()
}

// GET /api/seller/service-slots?wallet=0x...&from=YYYY-MM-DD&to=YYYY-MM-DD
// 판매자 본인의 확정된 예약 목록 (캘린더용)
export async function GET(req: NextRequest) {
  try {
    const wallet = getWallet(req)
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 미연결' }, { status: 401 })
    }

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')

    const sb = getSupabaseAdmin()
    let query = sb
      .from('service_reservation_slots')
      .select(`
        id, product_id, order_id,
        reserved_date, reserved_time, duration_minutes,
        status, buyer_wallet, buyer_email, buyer_phone, note,
        created_at, confirmed_at
      `)
      .eq('seller_wallet', wallet)
      .in('status', ['held', 'confirmed'])
      .order('reserved_date', { ascending: true })
      .order('reserved_time', { ascending: true })

    if (from) query = query.gte('reserved_date', from)
    if (to) query = query.lte('reserved_date', to)

    const { data, error } = await query

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }

    // 상품 제목 조인
    const productIds = Array.from(new Set((data ?? []).map((s) => s.product_id)))
    let productMap: Record<string, string> = {}
    if (productIds.length > 0) {
      const { data: products } = await sb
        .from('seller_requests')
        .select('id, title')
        .in('id', productIds)
      for (const p of products ?? []) {
        productMap[p.id] = p.title
      }
    }

    const enriched = (data ?? []).map((s) => ({
      ...s,
      product_title: productMap[s.product_id] || '(상품명 없음)',
    }))

    return NextResponse.json({ ok: true, slots: enriched })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
