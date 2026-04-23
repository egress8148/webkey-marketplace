import { NextRequest } from 'next/server'
import { supabaseAdmin } from '../../_shared/supabase-admin'
import { jsonError, requireAdminWallet, safeString } from '../../_shared/security'

export async function POST(request: NextRequest) {
  try {
    const { wallet } = await requireAdminWallet(request)
    const body = await request.json()
    const productId = safeString(body.productId)
    const storagePath = safeString(body.storagePath)
    const previousImageUrl = safeString(body.previousImageUrl)

    if (!productId) return jsonError('productId is required.')

    const supabase = supabaseAdmin()

    if (storagePath) {
      const { error: storageError } = await supabase.storage
        .from('product-images')
        .remove([storagePath])

      if (storageError) {
        console.warn('Storage image delete failed:', storageError.message)
      }
    }

    const { error: updateError } = await supabase
      .from('products')
      .update({ image_url: null, updated_at: new Date().toISOString() })
      .eq('id', productId)

    if (updateError) return jsonError(updateError.message, 500)

    const { error: logError } = await supabase.from('admin_logs').insert({
      admin_wallet: wallet,
      action: 'product_image_delete',
      target_type: 'product',
      target_id: productId,
      metadata: body.metadata ?? null,
      detail: {
        source: 'api_route',
        productId,
        previousImageUrl: previousImageUrl || null,
        removedStoragePath: storagePath || null,
        metadata: body.metadata ?? null,
      },
    })

    if (logError) return jsonError(logError.message, 500)

    return Response.json({ ok: true, productId, storagePath: storagePath || null })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 403)
  }
}
