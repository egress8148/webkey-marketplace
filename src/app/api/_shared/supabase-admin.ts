import 'server-only'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ✨ Patch v14: env 누락시 NEXT_PUBLIC_* fallback + 상세 에러 메시지

let cached: SupabaseClient | null = null

function resolveSupabaseUrl(): string {
  const candidates = [
    process.env.SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ]
  for (const c of candidates) {
    if (c && c.trim().length > 0) {
      // URL 끝의 슬래시, 따옴표 제거
      return c.trim().replace(/\/+$/, '').replace(/^["']|["']$/g, '')
    }
  }
  throw new Error(
    '[supabase-admin] SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_URL 중 하나는 반드시 .env.local 에 있어야 합니다.',
  )
}

function resolveServiceKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || key.trim().length === 0) {
    throw new Error(
      '[supabase-admin] SUPABASE_SERVICE_ROLE_KEY 가 .env.local 에 없습니다. Supabase 대시보드 → Project Settings → API → Secret 키(sb_secret_* 또는 eyJ*) 복사 필요.',
    )
  }
  return key.trim().replace(/^["']|["']$/g, '')
}

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached

  const url = resolveSupabaseUrl()
  const serviceKey = resolveServiceKey()

  cached = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      // 서버사이드 fetch timeout 조절 (fetch failed 원인 파악 용이)
      fetch: (input, init) => {
        return fetch(input, {
          ...init,
          // @ts-expect-error Next.js 의 fetch 확장
          cache: 'no-store',
        })
      },
    },
  })
  return cached
}

// 기존 코드 호환
export const supabaseAdmin = () => getSupabaseAdmin()

// ✨ Patch v14: 진단용 함수 – /api/admin/env-check 에서 사용
export function getEnvDiagnostics() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ''
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  const adminWallet =
    process.env.ADMIN_WALLET || process.env.NEXT_PUBLIC_ADMIN_WALLET || ''

  function mask(v: string) {
    if (!v) return '(empty)'
    if (v.length <= 12) return v
    return v.slice(0, 8) + '...' + v.slice(-4)
  }

  return {
    SUPABASE_URL: {
      exists: Boolean(process.env.SUPABASE_URL),
      hasPublicFallback: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
      resolved: url,
      length: url.length,
      startsWithHttps: url.startsWith('https://'),
      endsWithSupabaseCo: url.endsWith('.supabase.co'),
    },
    SUPABASE_SERVICE_ROLE_KEY: {
      exists: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      length: key.length,
      preview: mask(key),
      startsWith_sb_secret: key.startsWith('sb_secret_'),
      startsWith_eyJ: key.startsWith('eyJ'),
    },
    NEXT_PUBLIC_SUPABASE_URL: {
      exists: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    },
    NEXT_PUBLIC_SUPABASE_ANON_KEY: {
      exists: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    },
    ADMIN_WALLET: {
      exists: Boolean(adminWallet),
      preview: mask(adminWallet),
    },
  }
}
