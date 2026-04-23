import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'
import { resendSend } from '@/lib/resend'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ADMIN_WALLET = (
  process.env.ADMIN_WALLET ||
  process.env.NEXT_PUBLIC_ADMIN_WALLET ||
  ''
).toLowerCase()

function isAdmin(req: NextRequest): boolean {
  if (!ADMIN_WALLET) return false
  const wallet = (req.headers.get('x-admin-wallet') || req.headers.get('x-wallet-address') || '').toLowerCase()
  return wallet === ADMIN_WALLET
}

// POST /api/admin/send-email  — email_queue 에서 대기중인 메일 batch 전송
// body: { limit?: number }  (기본 20)
export async function POST(req: NextRequest) {
  try {
    if (!isAdmin(req)) {
      return NextResponse.json({ ok: false, message: '관리자 권한 필요' }, { status: 403 })
    }
    const body = await req.json().catch(() => ({}))
    const limit = Math.min(100, Math.max(1, Number(body.limit ?? 20)))

    const sb = getSupabaseAdmin()
    const { data: queued, error } = await sb
      .from('email_queue')
      .select('*')
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(limit)

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }

    let sent = 0
    let failed = 0
    for (const msg of queued ?? []) {
      const result = await resendSend({
        to: msg.to_address,
        subject: msg.subject,
        html: msg.body_html || '',
        text: msg.body_text || undefined,
      })
      if (result.ok) {
        await sb
          .from('email_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString(), attempts: (msg.attempts || 0) + 1 })
          .eq('id', msg.id)
        sent++
      } else {
        await sb
          .from('email_queue')
          .update({
            status: (msg.attempts || 0) >= 3 ? 'failed' : 'queued',
            attempts: (msg.attempts || 0) + 1,
            error: result.error || null,
          })
          .eq('id', msg.id)
        failed++
      }
    }

    return NextResponse.json({ ok: true, processed: (queued ?? []).length, sent, failed })
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}

// GET /api/admin/send-email  — 큐 현황 조회
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ ok: false, message: '관리자 권한 필요' }, { status: 403 })
  }
  const sb = getSupabaseAdmin()
  const { data } = await sb
    .from('email_queue')
    .select('id, order_id, to_address, to_role, subject, status, attempts, error, sent_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50)
  return NextResponse.json({ ok: true, items: data ?? [] })
}
