import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/public/categories
export async function GET() {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('product_categories')
      .select('id, code, name_ko, name_en, emoji, product_type, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message, items: [] },
        { status: 500 },
      )
    }

    const items = data ?? []
    const grouped: Record<string, typeof items> = {
      physical: [],
      service: [],
      food: [],
      digital: [],
    }
    for (const row of items) {
      const key = row.product_type || 'physical'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(row)
    }

    return NextResponse.json({ ok: true, items, grouped })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err), items: [] },
      { status: 500 },
    )
  }
}
