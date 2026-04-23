import { NextRequest } from 'next/server'
import { getSessionFromRequest } from '../../_shared/session'

export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request)

  return Response.json({
    ok: true,
    session: session
      ? {
          wallet: session.wallet,
          role: session.role,
          expiresAt: session.expiresAt,
        }
      : null,
  })
}
