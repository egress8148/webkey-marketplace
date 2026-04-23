import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/public/product-variants?productId=<uuid>
// 특정 상품의 변이(옵션 조합) 목록 반환 (active 만)
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const productId = url.searchParams.get('productId')
    if (!productId) {
      return NextResponse.json(
        { ok: false, message: 'productId 필요', items: [] },
        { status: 400 },
      )
    }

    const { data, error } = await getSupabaseAdmin()
      .from('product_variants')
      .select('id, product_id, variant_key, options, stock, reserved, price_usdt_delta, sku, sold_count, is_active')
      .eq('product_id', productId)
      .eq('is_active', true)
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message, items: [] },
        { status: 500 },
      )
    }

    // 가용 재고(available = stock - reserved) 계산해서 덧붙임
    const items = (data ?? []).map((v) => ({
      ...v,
      available: Math.max(0, (v.stock || 0) - (v.reserved || 0)),
    }))

    return NextResponse.json({ ok: true, items })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err), items: [] },
      { status: 500 },
    )
  }
}
