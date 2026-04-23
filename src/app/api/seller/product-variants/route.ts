import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ------------------------------------------------------------------
// 판매자 본인 상품의 옵션 조합 CRUD
// 모든 요청은 헤더 x-wallet-address 로 본인 확인
// ------------------------------------------------------------------

async function assertOwner(productId: string, wallet: string) {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('seller_requests')
    .select('id, seller_wallet')
    .eq('id', productId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('상품 없음')
  if ((data.seller_wallet || '').toLowerCase() !== wallet) {
    throw new Error('본인 상품만 수정 가능')
  }
}

function computeVariantKey(options: Record<string, unknown>): string {
  if (!options || typeof options !== 'object') return ''
  return Object.keys(options)
    .sort()
    .map((k) => `${k}=${String(options[k])}`)
    .join('|')
}

// GET /api/seller/product-variants?productId=<uuid>
export async function GET(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    }
    const url = new URL(req.url)
    const productId = url.searchParams.get('productId')
    if (!productId) {
      return NextResponse.json({ ok: false, message: 'productId 필요' }, { status: 400 })
    }

    await assertOwner(productId, wallet)

    const { data, error } = await getSupabaseAdmin()
      .from('product_variants')
      .select('*')
      .eq('product_id', productId)
      .order('created_at', { ascending: true })

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, items: data ?? [] })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

// POST /api/seller/product-variants
// body: { productId, options: {...}, stock, price_usdt_delta?, sku? }
export async function POST(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    }
    const body = await req.json()
    const { productId, options, stock, price_usdt_delta, sku } = body
    if (!productId || !options) {
      return NextResponse.json(
        { ok: false, message: 'productId, options 필수' },
        { status: 400 },
      )
    }

    await assertOwner(productId, wallet)

    const variantKey = computeVariantKey(options)
    if (!variantKey) {
      return NextResponse.json({ ok: false, message: '옵션이 비어있음' }, { status: 400 })
    }

    const { data, error } = await getSupabaseAdmin()
      .from('product_variants')
      .insert({
        product_id: productId,
        variant_key: variantKey,
        options,
        stock: Math.max(0, Number(stock ?? 0)),
        price_usdt_delta: Number(price_usdt_delta ?? 0),
        sku: sku ? String(sku) : null,
        is_active: true,
      })
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

// PATCH /api/seller/product-variants
// body: { id, stock?, price_usdt_delta?, is_active?, sku?, options? }
export async function PATCH(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    }
    const body = await req.json()
    const { id, stock, price_usdt_delta, is_active, sku, options } = body
    if (!id) {
      return NextResponse.json({ ok: false, message: 'id 필수' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()
    const { data: existing, error: findErr } = await sb
      .from('product_variants')
      .select('id, product_id, options')
      .eq('id', id)
      .maybeSingle()
    if (findErr) {
      return NextResponse.json({ ok: false, message: findErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ ok: false, message: '변이 없음' }, { status: 404 })
    }

    await assertOwner(existing.product_id, wallet)

    const patch: Record<string, unknown> = {}
    if (stock !== undefined) patch.stock = Math.max(0, Number(stock))
    if (price_usdt_delta !== undefined) patch.price_usdt_delta = Number(price_usdt_delta)
    if (is_active !== undefined) patch.is_active = Boolean(is_active)
    if (sku !== undefined) patch.sku = sku ? String(sku) : null
    if (options !== undefined) {
      patch.options = options
      patch.variant_key = computeVariantKey(options)
    }

    const { data, error } = await sb
      .from('product_variants')
      .update(patch)
      .eq('id', id)
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

// DELETE /api/seller/product-variants?id=<uuid>&hard=true
export async function DELETE(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 필요' }, { status: 400 })
    }
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const hard = url.searchParams.get('hard') === 'true'
    if (!id) {
      return NextResponse.json({ ok: false, message: 'id 필요' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()
    const { data: existing, error: findErr } = await sb
      .from('product_variants')
      .select('id, product_id')
      .eq('id', id)
      .maybeSingle()
    if (findErr) {
      return NextResponse.json({ ok: false, message: findErr.message }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ ok: false, message: '변이 없음' }, { status: 404 })
    }
    await assertOwner(existing.product_id, wallet)

    if (hard) {
      const { error } = await sb.from('product_variants').delete().eq('id', id)
      if (error) {
        return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, hard: true })
    }

    const { error } = await sb
      .from('product_variants')
      .update({ is_active: false })
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
