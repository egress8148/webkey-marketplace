import 'server-only'

import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { isAddress, recoverMessageAddress } from 'viem'

export type AuthRole = 'admin' | 'seller'

export type AuthChallenge = {
  wallet: string
  normalizedWallet: string
  nonce: string
  issuedAt: string
  expiresAt: string
  host: string
}

export type AuthSession = {
  wallet: string
  normalizedWallet: string
  role: AuthRole
  issuedAt: string
  expiresAt: string
}

const SESSION_COOKIE_NAME = 'wkdao2_auth_session'
const CHALLENGE_COOKIE_NAME = 'wkdao2_auth_challenge'
const CHALLENGE_TTL_MS = 10 * 60 * 1000
const SESSION_TTL_MS = 12 * 60 * 60 * 1000

const normalizeWallet = (value?: string | null) => value?.trim().toLowerCase() || ''

const getSessionSecret = () =>
  process.env.MARKETPLACE_SESSION_SECRET || process.env.AUTH_SESSION_SECRET || ''

const getCookieOptions = (maxAgeMs: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: Math.max(1, Math.floor(maxAgeMs / 1000)),
})

const encodeBase64Url = (value: string) => Buffer.from(value, 'utf8').toString('base64url')
const decodeBase64Url = (value: string) => Buffer.from(value, 'base64url').toString('utf8')

const sign = (payload: string) => {
  const secret = getSessionSecret()

  if (!secret || secret.length < 32) {
    throw new Error('MARKETPLACE_SESSION_SECRET must be configured with at least 32 characters.')
  }

  return crypto.createHmac('sha256', secret).update(payload).digest('base64url')
}

const timingSafeEqualString = (a: string, b: string) => {
  const aBuf = Buffer.from(a)
  const bBuf = Buffer.from(b)

  if (aBuf.length !== bBuf.length) return false
  return crypto.timingSafeEqual(aBuf, bBuf)
}

const encodeSignedPayload = <T extends object>(value: T) => {
  const payload = encodeBase64Url(JSON.stringify(value))
  const signature = sign(payload)
  return `${payload}.${signature}`
}

const decodeSignedPayload = <T>(value?: string | null): T | null => {
  if (!value) return null

  const dotIndex = value.lastIndexOf('.')
  if (dotIndex <= 0) return null

  const payload = value.slice(0, dotIndex)
  const signature = value.slice(dotIndex + 1)
  const expected = sign(payload)

  if (!timingSafeEqualString(signature, expected)) {
    return null
  }

  try {
    return JSON.parse(decodeBase64Url(payload)) as T
  } catch {
    return null
  }
}

const isExpired = (iso: string) => new Date(iso).getTime() <= Date.now()

const getHost = (request: NextRequest) =>
  request.headers.get('x-forwarded-host') || request.headers.get('host') || 'localhost:3000'

export const buildChallengeMessage = (challenge: AuthChallenge) =>
  [
    'WebKey DAO2 Marketplace sign-in',
    `Domain: ${challenge.host}`,
    `Wallet: ${challenge.wallet}`,
    `Nonce: ${challenge.nonce}`,
    `Issued At: ${challenge.issuedAt}`,
    `Expires At: ${challenge.expiresAt}`,
  ].join('\n')

export const createChallenge = (request: NextRequest, wallet: string): AuthChallenge => {
  if (!isAddress(wallet)) {
    throw new Error('Valid wallet address required.')
  }

  const now = new Date()
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS)

  return {
    wallet,
    normalizedWallet: normalizeWallet(wallet),
    nonce: crypto.randomBytes(16).toString('hex'),
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    host: getHost(request),
  }
}

export const setChallengeCookie = (response: NextResponse, challenge: AuthChallenge) => {
  response.cookies.set(
    CHALLENGE_COOKIE_NAME,
    encodeSignedPayload(challenge),
    getCookieOptions(CHALLENGE_TTL_MS),
  )
}

export const getChallengeFromRequest = (request: NextRequest) => {
  const challenge = decodeSignedPayload<AuthChallenge>(
    request.cookies.get(CHALLENGE_COOKIE_NAME)?.value,
  )

  if (!challenge) return null
  if (isExpired(challenge.expiresAt)) return null
  return challenge
}

export const clearChallengeCookie = (response: NextResponse) => {
  response.cookies.set(CHALLENGE_COOKIE_NAME, '', {
    ...getCookieOptions(1),
    maxAge: 0,
  })
}

export const createSession = (wallet: string, adminWallet: string): AuthSession => {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  const normalizedWallet = normalizeWallet(wallet)

  return {
    wallet,
    normalizedWallet,
    role: normalizedWallet === normalizeWallet(adminWallet) ? 'admin' : 'seller',
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }
}

export const setSessionCookie = (response: NextResponse, session: AuthSession) => {
  response.cookies.set(
    SESSION_COOKIE_NAME,
    encodeSignedPayload(session),
    getCookieOptions(SESSION_TTL_MS),
  )
}

export const getSessionFromRequest = (request: NextRequest) => {
  const session = decodeSignedPayload<AuthSession>(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  )

  if (!session) return null
  if (isExpired(session.expiresAt)) return null
  return session
}

export const clearSessionCookie = (response: NextResponse) => {
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    ...getCookieOptions(1),
    maxAge: 0,
  })
}

export const clearAuthCookies = (response: NextResponse) => {
  clearChallengeCookie(response)
  clearSessionCookie(response)
}

export const verifySignedMessage = async (
  request: NextRequest,
  wallet: string,
  signature: string,
) => {
  if (!isAddress(wallet)) {
    throw new Error('Valid wallet address required.')
  }

  if (!signature) {
    throw new Error('Signature is required.')
  }

  const challenge = getChallengeFromRequest(request)

  if (!challenge) {
    throw new Error('Challenge expired or missing. Request a new sign-in message.')
  }

  if (challenge.normalizedWallet !== normalizeWallet(wallet)) {
    throw new Error('Challenge wallet mismatch.')
  }

  const expectedMessage = buildChallengeMessage(challenge)
  const recovered = await recoverMessageAddress({
    message: expectedMessage,
    signature: signature as `0x${string}`,
  })

  if (normalizeWallet(recovered) !== normalizeWallet(wallet)) {
    throw new Error('Signature verification failed.')
  }

  return challenge
}
