import { NextResponse } from 'next/server'
import { getEnvDiagnostics, getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// GET /api/admin/env-check
// env 값 진단 + Supabase 실제 ping 테스트
export async function GET() {
  const diag = getEnvDiagnostics()

  // 실제 Supabase ping
  let pingResult: Record<string, unknown>
  try {
    const sb = getSupabaseAdmin()
    const { error, count } = await sb
      .from('seller_requests')
      .select('*', { count: 'exact', head: true })
    if (error) {
      pingResult = {
        ok: false,
        message: error.message,
        hint:
          error.message.includes('does not exist')
            ? 'seller_requests 테이블 없음 → v10 MASTER SQL 실행 필요'
            : error.message.includes('Invalid API key') || error.message.includes('JWT')
            ? 'service_role 키 문제 → 키 재발급/복사 확인'
            : undefined,
      }
    } else {
      pingResult = { ok: true, row_count: count ?? 0 }
    }
  } catch (err) {
    pingResult = {
      ok: false,
      type: 'exception',
      message: err instanceof Error ? err.message : String(err),
      hint:
        (err instanceof Error && err.message.includes('fetch failed'))
          ? '네트워크/URL 문제 → SUPABASE_URL 값 오타 또는 방화벽/프록시 확인'
          : undefined,
    }
  }

  return NextResponse.json({
    ok: true,
    env: diag,
    supabase_ping: pingResult,
  })
}
