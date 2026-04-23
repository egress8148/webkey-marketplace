import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/seller/my-products?wallet=0x...
// 특정 판매자의 전체 요청(모든 상태) 최신순 반환
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const walletParam = (url.searchParams.get('wallet') || '').toLowerCase()
    const headerWallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    const wallet = walletParam || headerWallet

    if (!wallet || !wallet.startsWith('0x')) {
      return NextResponse.json(
        { ok: false, message: '지갑 주소가 필요합니다.', items: [] },
        { status: 400 },
      )
    }

    const { data, error } = await getSupabaseAdmin()
      .from('seller_requests')
      .select('*')
      .eq('seller_wallet', wallet)
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
