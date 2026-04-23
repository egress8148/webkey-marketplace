import { NextRequest, NextResponse } from 'next/server'
import { getAdminWallet, jsonError, safeString } from '../../_shared/security'
import { clearChallengeCookie, createSession, setSessionCookie, verifySignedMessage } from '../../_shared/session'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const wallet = safeString(body.wallet)
    const signature = safeString(body.signature)
    const adminWallet = getAdminWallet()

    if (!adminWallet) {
      return jsonError('Admin wallet is not configured.', 500)
    }

    await verifySignedMessage(request, wallet, signature)

    const session = createSession(wallet, adminWallet)
    const response = NextResponse.json({
      ok: true,
      session: {
        wallet: session.wallet,
        role: session.role,
        expiresAt: session.expiresAt,
      },
    })

    setSessionCookie(response, session)
    clearChallengeCookie(response)
    return response
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 403)
  }
}
