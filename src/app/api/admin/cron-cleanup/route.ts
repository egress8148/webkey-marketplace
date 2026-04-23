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
  const wallet = (req.headers.get('x-admin-wallet') || req.headers.get('x-wallet-address') || '').toLowerCase()
  return wallet === ADMIN_WALLET
}

// POST /api/admin/cron-cleanup  — 수동 cleanup
export async function POST(req: NextRequest) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ ok: false, message: '관리자 권한 필요' }, { status: 403 })
    }
    const { data, error } = await getSupabaseAdmin().rpc('cleanup_expired_orders')
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, cleaned: data ?? 0 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
