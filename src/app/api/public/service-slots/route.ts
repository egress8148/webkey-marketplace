import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/app/api/_shared/supabase-admin'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function getWallet(req: NextRequest): string {
  return (req.headers.get('x-wallet-address') || '').toLowerCase()
}

// GET /api/public/service-slots?productId=XXX&date=YYYY-MM-DD
// 반환: { ok: true, slots: [{ reserved_time: "HH:MM:SS", status: "held"|"confirmed" }] }
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const productId = url.searchParams.get('productId')
    const date = url.searchParams.get('date')

    if (!productId) {
      return NextResponse.json({ ok: false, message: 'productId 필수' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()
    let query = sb
      .from('service_reservation_slots')
      .select('reserved_date, reserved_time, status')
      .eq('product_id', productId)
      .in('status', ['held', 'confirmed'])
      .order('reserved_date', { ascending: true })
      .order('reserved_time', { ascending: true })

    if (date) query = query.eq('reserved_date', date)

    const { data, error } = await query
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, slots: data ?? [] })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

// POST /api/public/service-slots
// body: { productId, date: "YYYY-MM-DD", time: "HH:MM", email?, phone?, note?, orderId? }
// 슬롯 점유 (RPC reserve_service_slot 호출 — 동시성 안전)
export async function POST(req: NextRequest) {
  try {
    const wallet = getWallet(req)
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 미연결' }, { status: 401 })
    }

    const body = await req.json()
    const { productId, date, time, email, phone, note, orderId, durationMinutes } = body || {}

    if (!productId || !date || !time) {
      return NextResponse.json(
        { ok: false, message: 'productId, date, time 필수' },
        { status: 400 },
      )
    }

    const sb = getSupabaseAdmin()
    const { data, error } = await sb.rpc('reserve_service_slot', {
      p_product_id: productId,
      p_buyer_wallet: wallet,
      p_reserved_date: date,
      p_reserved_time: time.length === 5 ? `${time}:00` : time, // "HH:MM" → "HH:MM:00"
      p_duration_minutes: durationMinutes ?? 60,
      p_buyer_email: email || null,
      p_buyer_phone: phone || null,
      p_note: note || null,
      p_order_id: orderId || null,
    })

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }

    // RPC 결과는 array of rows
    const result = Array.isArray(data) && data.length > 0 ? data[0] : null
    if (!result?.ok) {
      return NextResponse.json(
        { ok: false, message: result?.message || '예약 불가' },
        { status: 409 },
      )
    }

    return NextResponse.json({ ok: true, slotId: result.slot_id, message: result.message })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

// DELETE /api/public/service-slots?slotId=XXX
// 슬롯 해제 (본인 또는 판매자만)
export async function DELETE(req: NextRequest) {
  try {
    const wallet = getWallet(req)
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 미연결' }, { status: 401 })
    }

    const url = new URL(req.url)
    const slotId = url.searchParams.get('slotId')
    if (!slotId) {
      return NextResponse.json({ ok: false, message: 'slotId 필수' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()

    // 권한 체크: 본인 또는 판매자만
    const { data: slot } = await sb
      .from('service_reservation_slots')
      .select('buyer_wallet, seller_wallet, status')
      .eq('id', slotId)
      .single()

    if (!slot) {
      return NextResponse.json({ ok: false, message: '슬롯 없음' }, { status: 404 })
    }

    if (
      slot.buyer_wallet.toLowerCase() !== wallet &&
      slot.seller_wallet.toLowerCase() !== wallet
    ) {
      return NextResponse.json({ ok: false, message: '권한 없음' }, { status: 403 })
    }

    const { data, error } = await sb.rpc('release_service_slot', { p_slot_id: slotId })
    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }

    const result = Array.isArray(data) && data.length > 0 ? data[0] : null
    return NextResponse.json({
      ok: result?.ok ?? true,
      message: result?.message || '해제 완료',
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}

// PATCH /api/public/service-slots?slotId=XXX
// body: { orderId?, confirm?: boolean }
// tx 성공 시 슬롯 확정
export async function PATCH(req: NextRequest) {
  try {
    const wallet = getWallet(req)
    if (!wallet) {
      return NextResponse.json({ ok: false, message: '지갑 미연결' }, { status: 401 })
    }

    const url = new URL(req.url)
    const slotId = url.searchParams.get('slotId')
    const body = await req.json().catch(() => ({}))
    const { orderId, confirm } = body || {}

    if (!slotId) {
      return NextResponse.json({ ok: false, message: 'slotId 필수' }, { status: 400 })
    }

    if (!confirm) {
      return NextResponse.json({ ok: false, message: 'confirm=true 필요' }, { status: 400 })
    }

    const sb = getSupabaseAdmin()
    const { data, error } = await sb.rpc('confirm_service_slot', {
      p_slot_id: slotId,
      p_order_id: orderId || null,
    })

    if (error) {
      return NextResponse.json({ ok: false, message: error.message }, { status: 500 })
    }

    const result = Array.isArray(data) && data.length > 0 ? data[0] : null
    return NextResponse.json({
      ok: result?.ok ?? false,
      message: result?.message || '',
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}
