'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useEffect, useState } from 'react'
import { useAccount, useSignMessage } from 'wagmi'

type SessionPayload = {
  wallet: string
  role: 'admin' | 'seller'
  expiresAt: string
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init })
  const json = await response.json()

  if (!response.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || 'Request failed.')
  }

  return json as T
}

export default function AuthPage() {
  const { address, isConnected } = useAccount()
  const { signMessageAsync } = useSignMessage()
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  const refreshSession = async () => {
    const json = await readJson<{ ok: true; session: SessionPayload | null }>('/api/auth/session')
    setSession(json.session)
  }

  useEffect(() => {
    refreshSession().catch(() => undefined)
  }, [])

  const handleSignIn = async () => {
    if (!address) {
      setMessage('먼저 지갑을 연결해라.')
      return
    }

    setLoading(true)
    setMessage('')

    try {
      const challenge = await readJson<{
        ok: true
        message: string
        wallet: string
        expiresAt: string
      }>(`/api/auth/challenge?wallet=${address}`)

      const signature = await signMessageAsync({ message: challenge.message })

      const verified = await readJson<{ ok: true; session: SessionPayload }>('/api/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wallet: address,
          signature,
        }),
      })

      setSession(verified.session)
      setMessage(`서명 인증 완료: ${verified.session.role}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '서명 인증에 실패했다.')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    setLoading(true)
    setMessage('')

    try {
      await readJson('/api/auth/logout', { method: 'POST' })
      setSession(null)
      setMessage('로그아웃 완료')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '로그아웃에 실패했다.')
    } finally {
      setLoading(false)
    }
  }

  const currentWallet = address?.toLowerCase() || ''
  const sessionWallet = session?.wallet?.toLowerCase() || ''
  const walletMatches = Boolean(currentWallet && sessionWallet && currentWallet === sessionWallet)

  return (
    <main className="min-h-screen bg-black px-6 py-16 text-white">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="text-center">
          <p className="mb-3 inline-block rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm text-cyan-300">
            50-9 Signature Auth
          </p>
          <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
            WebKey DAO2 Marketplace 서명 인증
          </h1>
          <p className="mt-4 text-zinc-400">
            관리자 / 판매자 API를 쓰기 전에 여기서 먼저 서명 인증 세션을 발급받아라.
          </p>
        </div>

        <div className="flex justify-center">
          <ConnectButton />
        </div>

        {message ? (
          <div className="rounded-2xl border border-white/10 bg-zinc-900/70 p-4 text-sm text-zinc-200">
            {message}
          </div>
        ) : null}

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-zinc-900/70 p-8">
            <h2 className="text-2xl font-semibold">현재 지갑</h2>
            <div className="mt-6 space-y-3 text-sm text-zinc-300">
              <div className="flex justify-between gap-4">
                <span>연결 상태</span>
                <span>{isConnected ? '연결됨' : '연결 안됨'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>지갑 주소</span>
                <span className="max-w-[240px] truncate">{address || '-'}</span>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={handleSignIn}
                disabled={!isConnected || loading}
                className="rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? '처리 중...' : '서명 인증 로그인'}
              </button>

              <button
                onClick={handleLogout}
                disabled={loading}
                className="rounded-xl bg-zinc-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                로그아웃
              </button>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-zinc-900/70 p-8">
            <h2 className="text-2xl font-semibold">현재 세션</h2>
            <div className="mt-6 space-y-3 text-sm text-zinc-300">
              <div className="flex justify-between gap-4">
                <span>세션 상태</span>
                <span>{session ? '활성' : '없음'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>세션 지갑</span>
                <span className="max-w-[240px] truncate">{session?.wallet || '-'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>세션 역할</span>
                <span>{session?.role || '-'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>만료 시각</span>
                <span>{session?.expiresAt || '-'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span>연결 지갑 일치</span>
                <span>{walletMatches ? '일치' : '불일치/없음'}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-6 text-sm text-emerald-200">
          순서: 지갑 연결 → 서명 인증 로그인 → 메인 화면으로 돌아가서 관리자/판매자 기능 테스트
        </div>
      </div>
    </main>
  )
}
