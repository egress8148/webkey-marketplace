import 'server-only'

import { NextRequest } from 'next/server'
import { getSessionFromRequest } from './session'

export type RoleCheckResult = {
  wallet: string
  normalizedWallet: string
  role: 'admin' | 'seller'
}

const normalizeWallet = (value?: string | null) => value?.trim().toLowerCase() || ''

export const getAdminWallet = () =>
  normalizeWallet(process.env.ADMIN_WALLET || process.env.NEXT_PUBLIC_ADMIN_WALLET)

export const requireWallet = async (
  request: NextRequest,
): Promise<RoleCheckResult> => {
  const session = getSessionFromRequest(request)

  if (!session) {
    throw new Error('Signed wallet session required. Visit /auth and complete wallet signature login.')
  }

  return {
    wallet: session.wallet,
    normalizedWallet: session.normalizedWallet,
    role: session.role,
  }
}

export const requireAdminWallet = async (
  request: NextRequest,
): Promise<RoleCheckResult> => {
  const adminWallet = getAdminWallet()
  const session = await requireWallet(request)

  if (!adminWallet) {
    throw new Error('Admin wallet is not configured.')
  }

  if (session.normalizedWallet !== adminWallet || session.role !== 'admin') {
    throw new Error('Admin wallet signature session required.')
  }

  return session
}

export const jsonError = (message: string, status = 400) =>
  Response.json({ ok: false, message }, { status })

export const safeString = (value: unknown) =>
  typeof value === 'string' ? value.trim() : ''

export const safeNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export const safeArrayOfStrings = (value: unknown) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}
