import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/public/products
// 승인된(Approved) 상품 목록을 반환.
// 프론트는 이 응답에서 product_type, category_code, metadata_extra 까지 읽음.
export async function GET() {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('seller_requests')
      .select(
        `
        id, seller_wallet, title, description, metadata_uri,
        category, category_code, product_type, metadata_extra,
        price_usdt, stock, status, sold_count, revenue_dao2,
        image_url, rejection_reason, rejected_at, created_at, updated_at
        `,
      )
      .eq('status', 'Approved')
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message, items: [] },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, items: data ?? [] })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err), items: [] },
      { status: 500 },
    )
  }
}
