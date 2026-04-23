import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// POST /api/seller/product-request
// body: {
//   wallet, title, description, metadataUri,
//   category, product_type, category_code, metadata_extra,
//   priceUsdt, stock, imageUrl
// }
export async function POST(req: NextRequest) {
  try {
    const wallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    const body = await req.json()
    const bodyWallet = String(body.wallet || '').toLowerCase()
    const seller = wallet || bodyWallet

    if (!seller || !seller.startsWith('0x')) {
      return NextResponse.json(
        { ok: false, message: '지갑 주소가 필요합니다.' },
        { status: 400 },
      )
    }

    const title = String(body.title || '').trim()
    if (!title) {
      return NextResponse.json({ ok: false, message: '상품명 필수' }, { status: 400 })
    }

    const priceUsdt = Number(body.priceUsdt || 0)
    const stock = Number(body.stock || 0)
    if (priceUsdt <= 0) {
      return NextResponse.json({ ok: false, message: '가격은 0 초과' }, { status: 400 })
    }
    if (stock <= 0) {
      return NextResponse.json({ ok: false, message: '재고는 0 초과' }, { status: 400 })
    }

    // product_type validate
    const allowedType = ['physical', 'service', 'food', 'digital']
    const productType =
      allowedType.includes(String(body.product_type)) ? String(body.product_type) : 'physical'

    const categoryCode = body.category_code ? String(body.category_code) : null
    const category = body.category ? String(body.category) : null

    const metadataExtra =
      typeof body.metadata_extra === 'object' && body.metadata_extra !== null
        ? body.metadata_extra
        : {}

    const insertRow = {
      seller_wallet: seller,
      title,
      description: body.description ? String(body.description) : null,
      metadata_uri: body.metadataUri ? String(body.metadataUri) : null,
      category,
      category_code: categoryCode,
      product_type: productType,
      metadata_extra: metadataExtra,
      price_usdt: priceUsdt,
      stock,
      status: 'Pending',
      image_url: body.imageUrl ? String(body.imageUrl) : null,
    }

    const { data, error } = await getSupabaseAdmin()
      .from('seller_requests')
      .insert(insertRow)
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

// GET /api/seller/product-request?wallet=0x..
// 특정 판매자의 요청 전체(모든 상태) 반환
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const walletParam = (url.searchParams.get('wallet') || '').toLowerCase()
    const headerWallet = (req.headers.get('x-wallet-address') || '').toLowerCase()
    const wallet = walletParam || headerWallet

    if (!wallet || !wallet.startsWith('0x')) {
      return NextResponse.json(
        { ok: false, message: '지갑 주소가 필요합니다.' },
        { status: 400 },
      )
    }

    const { data, error } = await getSupabaseAdmin()
      .from('seller_requests')
      .select('*')
      .eq('seller_wallet', wallet)
      .order('created_at', { ascending: false })

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
