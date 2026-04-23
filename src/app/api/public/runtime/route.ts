import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/public/runtime
// marketplace / prime / promotion 상태를 반환
export async function GET() {
  try {
    const sb = getSupabaseAdmin()
    const { data, error } = await sb
      .from('runtime_config')
      .select('*')
      .eq('id', 1)
      .maybeSingle()

    if (error) {
      return NextResponse.json(
        { ok: false, message: error.message },
        { status: 500 },
      )
    }

    const cfg = data || {}
    const end = cfg.promotion_end_date ? new Date(cfg.promotion_end_date) : null
    const now = new Date()
    const daysRemaining =
      end && !isNaN(end.getTime())
        ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
        : null

    // Patch v8 정책: 프로모션 항상 ON
    const active = cfg.promotion_open_sell !== false

    return NextResponse.json({
      ok: true,
      marketplace: {
        marketplace_address: cfg.marketplace_address ?? null,
        fee_bps: cfg.fee_bps ?? 700,
        promotion_open_sell: cfg.promotion_open_sell ?? true,
        promotion_end_date: cfg.promotion_end_date ?? null,
      },
      prime: {
        plan_name: cfg.prime_plan_name ?? 'DAO2 Prime Pass',
      },
      promotion: {
        active,
        endDate: cfg.promotion_end_date ?? null,
        daysRemaining,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
