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

const BUCKET = 'product-images'

// POST /api/admin/product-image-delete
// body: { productId, path? }
// productId 의 image_url 을 비우고 storage 에서도 삭제 (path가 있으면)
export async function POST(req: NextRequest) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ ok: false, message: '관리자 권한이 필요합니다.' }, { status: 403 })
    }
    const body = await req.json()
    const productId = body.productId || body.id
    const path = body.path as string | undefined

    if (!productId && !path) {
      return NextResponse.json(
        { ok: false, message: 'productId 또는 path 필요' },
        { status: 400 },
      )
    }

    const sb = getSupabaseAdmin()

    // 1) Storage 에서 삭제 (path 가 있을 때)
    if (path) {
      try {
        await sb.storage.from(BUCKET).remove([path])
      } catch {
        /* ignore */
      }
    }

    // 2) DB 에서 image_url 비우기
    if (productId) {
      const { error } = await sb
        .from('seller_requests')
        .update({ image_url: null })
        .eq('id', productId)
      if (error) {
        return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
