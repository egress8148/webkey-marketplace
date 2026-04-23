'use client'

import { useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../../lib/supabase/client'

type DbCounts = {
  products: number
  orders: number
  sellers: number
}

export default function SupabaseTestPage() {
  const [status, setStatus] = useState<'idle' | 'checking' | 'connected' | 'error' | 'not-configured'>('idle')
  const [message, setMessage] = useState('')
  const [counts, setCounts] = useState<DbCounts>({ products: 0, orders: 0, sellers: 0 })

  const checkConnection = async () => {
    if (!isSupabaseConfigured) {
      setStatus('not-configured')
      setMessage('Supabase URL 또는 Publishable Key가 설정되지 않았다. frontend/.env.local을 확인해라.')
      return
    }

    try {
      setStatus('checking')
      setMessage('Supabase 연결을 확인하는 중이다...')

      const [productsResult, ordersResult, sellersResult] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }),
        supabase.from('orders').select('id', { count: 'exact', head: true }),
        supabase.from('seller_profiles').select('id', { count: 'exact', head: true }),
      ])

      const firstError = productsResult.error || ordersResult.error || sellersResult.error

      if (firstError) {
        setStatus('error')
        setMessage(`Supabase 연결은 되었지만 RLS 정책 또는 조회 권한 확인이 필요하다: ${firstError.message}`)
        return
      }

      setCounts({
        products: productsResult.count ?? 0,
        orders: ordersResult.count ?? 0,
        sellers: sellersResult.count ?? 0,
      })
      setStatus('connected')
      setMessage('Supabase DB 연결이 정상이다. products/orders/seller_profiles 테이블 조회가 가능하다.')
    } catch (error) {
      setStatus('error')
      setMessage(error instanceof Error ? error.message : 'Supabase 연결 확인 중 오류가 발생했다.')
    }
  }

  useEffect(() => {
    checkConnection()
  }, [])

  return (
    <main className="min-h-screen bg-black px-6 py-12 text-white">
      <div className="mx-auto max-w-4xl rounded-3xl border border-emerald-500/20 bg-emerald-500/10 p-8 shadow-2xl shadow-emerald-950/30">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-emerald-200">STEP 49-2</div>
        <h1 className="mt-3 text-3xl font-bold">Supabase 연결 테스트</h1>
        <p className="mt-3 text-sm leading-6 text-emerald-100/80">
          이 화면은 Supabase URL/Key, 테이블 생성, RLS 정책 상태를 확인하기 위한 테스트 페이지다.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs text-emerald-200/70">키 설정</div>
            <div className="mt-1 text-lg font-bold">{isSupabaseConfigured ? '설정됨' : '설정 필요'}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs text-emerald-200/70">DB 상태</div>
            <div className="mt-1 text-lg font-bold">
              {status === 'connected' ? '연결 정상' : status === 'checking' ? '확인 중' : status === 'error' ? '확인 필요' : status === 'not-configured' ? '키 없음' : '대기'}
            </div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs text-emerald-200/70">상품 테이블</div>
            <div className="mt-1 text-lg font-bold">{counts.products}개</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
            <div className="text-xs text-emerald-200/70">주문 테이블</div>
            <div className="mt-1 text-lg font-bold">{counts.orders}건</div>
          </div>
        </div>

        {message && (
          <div className="mt-6 rounded-2xl border border-emerald-500/20 bg-black/30 p-4 text-sm text-emerald-100">
            {message}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-3">
          <button onClick={checkConnection} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500">
            DB 연결 다시 확인
          </button>
          <a href="/" className="rounded-xl border border-white/10 bg-zinc-900 px-5 py-3 text-sm font-semibold text-zinc-200 hover:bg-zinc-800">
            마켓플레이스로 돌아가기
          </a>
        </div>

        <div className="mt-6 rounded-2xl border border-yellow-500/20 bg-yellow-500/10 p-4 text-xs leading-5 text-yellow-200">
          RLS를 켠 상태에서 정책이 없으면 조회/저장이 제한될 수 있다. 그 경우 ZIP 안의 supabase_rls_dev_policies_step49_2.sql을 SQL Editor에서 실행하면 개발용 테스트가 가능하다.
        </div>
      </div>
    </main>
  )
}
