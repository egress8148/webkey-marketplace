import { NextRequest } from 'next/server'
import { supabaseAdmin } from '../../_shared/supabase-admin'
import { jsonError, requireAdminWallet, safeNumber, safeString } from '../../_shared/security'

const toProductOptions = (value: unknown) => {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

export async function POST(request: NextRequest) {
  try {
    const { wallet } = await requireAdminWallet(request)
    const body = await request.json()
    const productId = safeString(body.productId)

    if (!productId) return jsonError('productId is required.')

    const patch = {
      title: safeString(body.title),
      description: safeString(body.description),
      metadata_uri: safeString(body.metadataUri) || null,
      category: safeString(body.category),
      price_usdt: safeNumber(body.priceUsdt),
      stock: Math.max(0, Math.floor(safeNumber(body.stock))),
      image_url: safeString(body.imageUrl) || null,
      product_type: safeString(body.productType) || '일반 상품',
      product_options: toProductOptions(body.productOptions),
      shipping_fee_usdt: safeNumber(body.shippingFeeUsdt),
      updated_at: new Date().toISOString(),
    }

    const supabase = supabaseAdmin()
    const { error: updateError } = await supabase
      .from('products')
      .update(patch)
      .eq('id', productId)

    if (updateError) return jsonError(updateError.message, 500)

    const { error: logError } = await supabase.from('admin_logs').insert({
      admin_wallet: wallet,
      action: 'product_update',
      target_type: 'product',
      target_id: productId,
      metadata: body.metadata ?? null,
      detail: { source: 'api_route', productId, patch, metadata: body.metadata ?? null },
    })

    if (logError) return jsonError(logError.message, 500)

    return Response.json({ ok: true, productId })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 403)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { wallet } = await requireAdminWallet(request)
    const body = await request.json()
    const productId = safeString(body.productId)
    const storagePath = safeString(body.storagePath)

    if (!productId) return jsonError('productId is required.')

    const supabase = supabaseAdmin()

    if (storagePath) {
      const { error: storageError } = await supabase.storage
        .from('product-images')
        .remove([storagePath])

      if (storageError) {
        console.warn('Storage image delete failed during product delete:', storageError.message)
      }
    }

    const { error: deleteError } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)

    if (deleteError) return jsonError(deleteError.message, 500)

    const { error: logError } = await supabase.from('admin_logs').insert({
      admin_wallet: wallet,
      action: 'product_delete',
      target_type: 'product',
      target_id: productId,
      metadata: body.metadata ?? null,
      detail: { source: 'api_route', productId, storagePath: storagePath || null, metadata: body.metadata ?? null },
    })

    if (logError) return jsonError(logError.message, 500)

    return Response.json({ ok: true, productId, storagePath: storagePath || null })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 403)
  }
}
