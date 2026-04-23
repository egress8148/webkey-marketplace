import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { createChallenge, setChallengeCookie, buildChallengeMessage } from '../../_shared/session'
import { jsonError, safeString } from '../../_shared/security'

export async function GET(request: NextRequest) {
  try {
    const wallet = safeString(request.nextUrl.searchParams.get('wallet'))

    if (!wallet || !isAddress(wallet)) {
      return jsonError('Valid wallet address required.')
    }

    const challenge = createChallenge(request, wallet)
    const response = NextResponse.json({
      ok: true,
      wallet,
      message: buildChallengeMessage(challenge),
      expiresAt: challenge.expiresAt,
    })

    setChallengeCookie(response, challenge)
    return response
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 400)
  }
}
