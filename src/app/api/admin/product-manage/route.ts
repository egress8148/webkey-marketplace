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

// PUT /api/admin/product-manage  — 관리자 상품 수정
// body: { productId, title?, description?, category?, priceUsdt?, stock?, imageUrl?, category_code?, product_type?, metadata_extra? }
export async function PUT(req: NextRequest) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ ok: false, message: '관리자 권한이 필요합니다.' }, { status: 403 })
    }

    const body = await req.json()
    const productId = body.productId || body.id
    if (!productId) {
      return NextResponse.json({ ok: false, message: 'productId 필수' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    if (typeof body.title === 'string')       patch.title = body.title
    if (typeof body.description === 'string') patch.description = body.description
    if (typeof body.category === 'string')    patch.category = body.category
    if (body.category_code !== undefined)     patch.category_code = body.category_code
    if (body.product_type !== undefined)      patch.product_type = body.product_type
    if (body.metadata_extra !== undefined)    patch.metadata_extra = body.metadata_extra
    if (body.priceUsdt !== undefined)         patch.price_usdt = Number(body.priceUsdt)
    if (body.stock !== undefined)             patch.stock = Number(body.stock)
    if (typeof body.imageUrl === 'string')    patch.image_url = body.imageUrl

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

// DELETE /api/admin/product-manage?id=...&hard=true
export async function DELETE(req: NextRequest) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ ok: false, message: '관리자 권한이 필요합니다.' }, { status: 403 })
    }
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const hard = url.searchParams.get('hard') === 'true'
    if (!id) {
      return NextResponse.json({ ok: false, message: 'id 필요' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()

    if (hard) {
      const { error } = await sb.from('seller_requests').delete().eq('id', id)
      if (error) {
        return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, hard: true })
    }

    const { error } = await sb
      .from('seller_requests')
      .update({ status: 'Paused' })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, hard: false })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
