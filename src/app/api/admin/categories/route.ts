import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// 관리자 지갑 주소 (.env 에서 읽음)
const ADMIN_WALLET = (
  process.env.ADMIN_WALLET ||
  process.env.NEXT_PUBLIC_ADMIN_WALLET ||
  ''
).toLowerCase()

function isAdminRequest(req: NextRequest): boolean {
  if (!ADMIN_WALLET) return false
  const wallet = (req.headers.get('x-admin-wallet') || '').toLowerCase()
  return wallet === ADMIN_WALLET
}

// GET /api/admin/categories
// 관리자 전용 전체 목록 (비활성 포함)
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 })
  }
  const { data, error } = await getSupabaseAdmin()
    .from('product_categories')
    .select('*')
    .order('sort_order', { ascending: true })

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, items: data ?? [] })
}

// POST /api/admin/categories
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = await req.json()
    const { code, name_ko, name_en, emoji, product_type, sort_order } = body
    if (!code || !name_ko || !product_type) {
      return NextResponse.json(
        { ok: false, message: 'code, name_ko, product_type 은 필수입니다.' },
        { status: 400 },
      )
    }

    const { data, error } = await getSupabaseAdmin()
      .from('product_categories')
      .insert({
        code,
        name_ko,
        name_en: name_en ?? null,
        emoji: emoji ?? null,
        product_type,
        sort_order: sort_order ?? 100,
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

// PATCH /api/admin/categories
export async function PATCH(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = await req.json()
    const { id, ...patch } = body
    if (!id) {
      return NextResponse.json({ ok: false, message: 'id 필수' }, { status: 400 })
    }
    const { data, error } = await getSupabaseAdmin()
      .from('product_categories')
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

// DELETE /api/admin/categories?id=... (&hard=true 면 실제 삭제)
export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 })
  }
  try {
    const url = new URL(req.url)
    const id = url.searchParams.get('id')
    const hard = url.searchParams.get('hard') === 'true'
    if (!id) {
      return NextResponse.json({ ok: false, message: 'id 쿼리 파라미터 필요' }, { status: 400 })
    }

    if (hard) {
      const { error } = await getSupabaseAdmin()
        .from('product_categories')
        .delete()
        .eq('id', id)
      if (error) {
        return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
      }
      return NextResponse.json({ ok: true, hard: true })
    }

    const { error } = await getSupabaseAdmin()
      .from('product_categories')
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
