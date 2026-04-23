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

const VALID_STATUSES = ['Pending', 'Approved', 'Rejected', 'Paused', 'SoldOut']

// POST /api/admin/product-status
// body: { productId, status, rejection_reason? }
// 관리자가 요청의 상태를 변경 (승인/거절/일시정지/재심사 등)
export async function POST(req: NextRequest) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json(
        { ok: false, message: '관리자 권한이 필요합니다.' },
        { status: 403 },
      )
    }

    const body = await req.json()
    const productId = body.productId || body.id
    const status = body.status
    const rejectionReason = body.rejection_reason || body.rejectionReason

    if (!productId) {
      return NextResponse.json(
        { ok: false, message: 'productId 필수' },
        { status: 400 },
      )
    }
    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        {
          ok: false,
          message: `status 는 ${VALID_STATUSES.join(', ')} 중 하나여야 합니다. (입력: ${status})`,
        },
        { status: 400 },
      )
    }

    const patch: Record<string, unknown> = { status }
    if (status === 'Rejected') {
      patch.rejection_reason = rejectionReason || null
      patch.rejected_at = new Date().toISOString()
    } else {
      // 승인/일시정지/재심사 이동 시 거절 사유 클리어
      patch.rejection_reason = null
      patch.rejected_at = null
    }

    const { data, error } = await getSupabaseAdmin()
      .from('seller_requests')
      .update(patch)
      .eq('id', productId)
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
