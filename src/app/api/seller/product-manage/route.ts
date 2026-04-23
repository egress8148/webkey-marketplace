import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// PUT /api/seller/product-manage
// body: { wallet, productId, title, description, category, priceUsdt, stock, imageUrl, category_code?, product_type?, metadata_extra? }
// 판매자 본인 상품 수정
export async function PUT(req: NextRequest) {
  try {
    const seller = (req.headers.get('x-wallet-address') || '').toLowerCase()
    const body = await req.json()
    const walletFromBody = String(body.wallet || '').toLowerCase()
    const wallet = seller || walletFromBody
    const productId = body.productId

    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    }
    if (!productId) {
      return NextResponse.json({ ok: false, message: 'productId 필요' }, { status: 400 })
    }

    // 본인 소유 확인
    const sb = getSupabaseAdmin()
    const { data: existing, error: findErr } = await sb
      .from('seller_requests')
      .select('id, seller_wallet, status')
      .eq('id', productId)
      .maybeSingle()

    if (findErr) {
      return NextResponse.json({ ok: false, message: findErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ ok: false, message: '상품 없음' }, { status: 404 })
    }
    if ((existing.seller_wallet || '').toLowerCase() !== wallet) {
      return NextResponse.json({ ok: false, message: '본인 상품만 수정 가능' }, { status: 403 })
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

    // 수정 후 재심사 필요 → 다시 Pending 으로
    if (existing.status === 'Approved' || existing.status === 'Rejected') {
      patch.status = 'Pending'
    }

    const { data, error } = await sb
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

// DELETE /api/seller/product-manage?id=...
// 판매자 본인 상품 삭제 (soft delete: status=Paused)
export async function DELETE(req: NextRequest) {
  try {
    const seller = (req.headers.get('x-wallet-address') || '').toLowerCase()
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const hard = url.searchParams.get('hard') === 'true'
    if (!seller) {
      return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    }
    if (!id) {
      return NextResponse.json({ ok: false, message: 'id 필요' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()
    const { data: existing, error: findErr } = await sb
      .from('seller_requests')
      .select('id, seller_wallet, image_path')
      .eq('id', id)
      .maybeSingle()
    if (findErr) {
      return NextResponse.json({ ok: false, message: findErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ ok: false, message: '상품 없음' }, { status: 404 })
    }
    if ((existing.seller_wallet || '').toLowerCase() !== seller) {
      return NextResponse.json({ ok: false, message: '본인 상품만 삭제 가능' }, { status: 403 })
    }

    if (hard) {
      if (existing.image_path) {
        try {
          await sb.storage.from('product-images').remove([existing.image_path])
        } catch {
          /* ignore */
        }
      }
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
