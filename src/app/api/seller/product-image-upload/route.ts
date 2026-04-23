import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}
const MAX_BYTES = 5 * 1024 * 1024
const BUCKET = 'product-images'

// POST /api/seller/product-image-upload
export async function POST(req: NextRequest) {
  try {
    const walletHeader = (req.headers.get('x-wallet-address') || '').toLowerCase()
    const form = await req.formData()
    const file = form.get('file') as File | null
    const walletFromForm = String(form.get('wallet') || '').toLowerCase()
    const wallet = walletHeader || walletFromForm

    if (!wallet || !wallet.startsWith('0x')) {
      return NextResponse.json(
        { ok: false, message: '지갑 주소가 필요합니다.' },
        { status: 400 },
      )
    }
    if (!file) {
      return NextResponse.json(
        { ok: false, message: '업로드할 파일이 없습니다.' },
        { status: 400 },
      )
    }

    const mime = (file.type || '').toLowerCase()
    const ext = ALLOWED[mime]
    if (!ext) {
      return NextResponse.json(
        { ok: false, message: `허용되지 않는 이미지 타입 (${mime})` },
        { status: 400 },
      )
    }

    if (file.size <= 0) {
      return NextResponse.json({ ok: false, message: '파일이 비어있음' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        {
          ok: false,
          message: `5MB 초과 (현재 ${(file.size / 1024 / 1024).toFixed(2)}MB)`,
        },
        { status: 400 },
      )
    }

    const ts = Date.now()
    const rand = Math.random().toString(36).slice(2, 8)
    const objectPath = `${wallet}/${ts}_${rand}.${ext}`
    const arrayBuf = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)

    const sb = getSupabaseAdmin()

    const { error: upErr } = await sb.storage
      .from(BUCKET)
      .upload(objectPath, buffer, {
        contentType: mime,
        upsert: false,
        cacheControl: '31536000',
      })

    if (upErr) {
      return NextResponse.json(
        {
          ok: false,
          message: `Storage 업로드 실패: ${upErr.message}`,
          hint:
            "SQL 번들의 'storage.buckets (product-images)' 가 생성됐는지, SUPABASE_SERVICE_ROLE_KEY 가 맞는지 확인",
        },
        { status: 500 },
      )
    }

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(objectPath)
    const imageUrl = pub?.publicUrl || ''
    if (!imageUrl) {
      return NextResponse.json(
        { ok: false, message: 'publicUrl 생성 실패 (버킷 public 여부 확인)' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      imageUrl,
      path: objectPath,
      bucket: BUCKET,
      size: file.size,
      mime,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        message: '이미지 업로드 중 서버 오류',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    )
  }
}
