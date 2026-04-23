import 'server-only'

// ✨ Patch v15: Resend 기반 이메일 발송 유틸
// 환경변수: RESEND_API_KEY, RESEND_FROM (예: WebKey DAO2 <noreply@yourdomain.com>)

type ResendSendParams = {
  to: string
  subject: string
  html: string
  text?: string
  from?: string
}

export async function resendSend(params: ResendSendParams): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  const defaultFrom = process.env.RESEND_FROM || 'WebKey DAO2 <onboarding@resend.dev>'

  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY 미설정' }
  }

  const payload = {
    from: params.from || defaultFrom,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    if (!res.ok) {
      return { ok: false, error: body?.message || `HTTP ${res.status}` }
    }
    return { ok: true, id: body?.id }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// 주문 확정 이메일 템플릿 (구매자용)
export function buildBuyerOrderEmail(args: {
  productTitle: string
  productType: string
  quantity: number
  options: Record<string, unknown>
  totalUsdt: string
  txHash?: string
}): { subject: string; html: string; text: string } {
  const optsText = Object.entries(args.options || {})
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ')

  const subject = `[WebKey DAO2] 주문이 확정되었습니다 – ${args.productTitle}`
  const html = `
    <div style="font-family:Pretendard,Apple SD Gothic Neo,Arial,sans-serif;background:#f8fafc;padding:32px">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(139,92,246,0.1)">
        <h1 style="margin:0 0 16px;font-size:22px;color:#7c3aed">🎉 주문이 확정되었습니다</h1>
        <p style="color:#475569;line-height:1.6">구매해주셔서 감사합니다.</p>

        <div style="margin-top:20px;padding:16px;background:#f5f3ff;border-radius:12px">
          <div style="font-size:13px;color:#6b7280">상품</div>
          <div style="font-size:16px;font-weight:bold;color:#1e293b">${args.productTitle}</div>
          <div style="margin-top:6px;font-size:12px;color:#64748b">유형: ${args.productType}</div>
          ${optsText ? `<div style="margin-top:6px;font-size:12px;color:#64748b">옵션: ${optsText}</div>` : ''}
          <div style="margin-top:6px;font-size:12px;color:#64748b">수량: ${args.quantity}</div>
          <div style="margin-top:10px;font-size:14px;color:#7c3aed;font-weight:bold">결제 금액: ${args.totalUsdt} USDT 상당 DAO2</div>
        </div>

        ${
          args.txHash
            ? `<div style="margin-top:14px;font-size:11px;color:#94a3b8">TX: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${args.txHash}</code></div>`
            : ''
        }

        <div style="margin-top:24px;font-size:13px;color:#64748b">
          판매자가 ${args.productType === 'physical' ? '배송 준비' : args.productType === 'service' ? '예약 확정' : args.productType === 'food' ? '예약 확정' : '전달 준비'}을 시작합니다.
          <br />진행 상황은 마이페이지에서 확인할 수 있습니다.
        </div>
      </div>
    </div>
  `
  const text = `[WebKey DAO2] 주문 확정\n상품: ${args.productTitle}\n수량: ${args.quantity}\n옵션: ${optsText}\n금액: ${args.totalUsdt} USDT`
  return { subject, html, text }
}

// 주문 확정 이메일 템플릿 (판매자용)
export function buildSellerOrderEmail(args: {
  productTitle: string
  productType: string
  quantity: number
  options: Record<string, unknown>
  buyerWallet: string
  deliveryInfo: Record<string, unknown>
  totalUsdt: string
}): { subject: string; html: string; text: string } {
  const optsText = Object.entries(args.options || {})
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(', ')
  const deliveryText = Object.entries(args.deliveryInfo || {})
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' / ')

  const subject = `[WebKey DAO2] 새 주문이 들어왔습니다 – ${args.productTitle}`
  const html = `
    <div style="font-family:Pretendard,Apple SD Gothic Neo,Arial,sans-serif;background:#f8fafc;padding:32px">
      <div style="max-width:560px;margin:0 auto;background:white;border-radius:16px;padding:28px;box-shadow:0 10px 30px rgba(236,72,153,0.1)">
        <h1 style="margin:0 0 16px;font-size:22px;color:#db2777">📦 새 주문 알림</h1>

        <div style="margin-top:10px;padding:16px;background:#fdf2f8;border-radius:12px">
          <div style="font-size:13px;color:#6b7280">상품</div>
          <div style="font-size:16px;font-weight:bold;color:#1e293b">${args.productTitle}</div>
          <div style="margin-top:6px;font-size:12px;color:#64748b">유형: ${args.productType}</div>
          ${optsText ? `<div style="margin-top:6px;font-size:12px;color:#64748b">옵션: ${optsText}</div>` : ''}
          <div style="margin-top:6px;font-size:12px;color:#64748b">수량: ${args.quantity}</div>
          <div style="margin-top:10px;font-size:14px;color:#db2777;font-weight:bold">정산 예정: ${args.totalUsdt} USDT 상당</div>
        </div>

        <div style="margin-top:16px;padding:12px;background:#fef3c7;border-radius:10px;font-size:12px;color:#78350f">
          <b>구매자 지갑:</b> <code>${args.buyerWallet}</code>
          ${deliveryText ? `<br /><b>수령 정보:</b> ${deliveryText}` : ''}
        </div>

        <div style="margin-top:20px;font-size:13px;color:#64748b">
          판매자 대시보드 → 주문 관리 탭에서 상태를 업데이트해주세요.
        </div>
      </div>
    </div>
  `
  const text = `[WebKey DAO2] 새 주문\n상품: ${args.productTitle}\n구매자: ${args.buyerWallet}\n수량: ${args.quantity}\n옵션: ${optsText}\n배송: ${deliveryText}`
  return { subject, html, text }
}
