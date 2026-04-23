import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ADMIN_WALLET = (
  process.env.ADMIN_WALLET ||
  process.env.NEXT_PUBLIC_ADMIN_WALLET ||
  ''
).toLowerCase()

function isAdmin(req: NextRequest): boolean {
  if (!ADMIN_WALLET) return false
  const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
  return wallet === ADMIN_WALLET
}

// GET /api/admin/marketplace-products
// 관리자 전용: 모든 판매자 요청(모든 상태) 최신순 반환
export async function GET(req: NextRequest) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json(
        { ok: false, message: '관리자 권한이 필요합니다.', items: [] },
        { status: 403 },
      )
    }

    const { data, error } = await getSupabaseAdmin()
      .from('seller_requests')
      .select('*')
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
