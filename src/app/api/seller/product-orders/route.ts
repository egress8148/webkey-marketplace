import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/seller/product-orders?wallet=0x..
// 판매자에게 들어온 주문 목록
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const wallet = (
      url.searchParams.get('wallet') ||
      req.headers.get('x-wallet-address') ||
      ''
    ).toLowerCase()
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 필요', items: [] }, { status: 400 })
    }
    const { data, error } = await getSupabaseAdmin()
      .from('v_orders_detailed')
      .select('*')
      .eq('seller_wallet', wallet)
      .order('ordered_at', { ascending: false })
      .limit(200)
    if (error) {
      return NextResponse.json({ ok: false, message: error.message, items: [] }, { status: 500 })
    }
    return NextResponse.json({ ok: true, items: data ?? [] })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err), items: [] },
      { status: 500 },
    )
  }
}
