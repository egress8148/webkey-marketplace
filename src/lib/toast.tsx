'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

// ✨ Patch v15: 가벼운 토스트 시스템
// 사용법:
//   const toast = useToast()
//   toast.success('저장 완료')
//   toast.info('...')
//   toast.error('...')
//   toast.custom({title:'등록됨', description:'내 판매 관리에서 확인', actionLabel:'바로가기', onAction: () => ...})

export type ToastKind = 'success' | 'info' | 'error' | 'warning'

export type ToastItem = {
  id: string
  kind: ToastKind
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  ttlMs?: number
}

type ToastContextType = {
  show: (item: Omit<ToastItem, 'id'>) => void
  success: (title: string, description?: string) => void
  info: (title: string, description?: string) => void
  error: (title: string, description?: string) => void
  warning: (title: string, description?: string) => void
  custom: (item: Omit<ToastItem, 'id'>) => void
  dismiss: (id: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Provider 가 없어도 앱이 터지지 않도록 no-op
    return {
      show: () => undefined,
      success: () => undefined,
      info: () => undefined,
      error: () => undefined,
      warning: () => undefined,
      custom: () => undefined,
      dismiss: () => undefined,
    } as ToastContextType
  }
  return ctx
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback(
    (t: Omit<ToastItem, 'id'>) => {
      const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const ttl = t.ttlMs ?? 4500
      setItems((prev) => [...prev, { ...t, id }])
      if (ttl > 0) {
        setTimeout(() => dismiss(id), ttl)
      }
    },
    [dismiss],
  )

  const ctxValue: ToastContextType = {
    show: push,
    success: (title, description) => push({ kind: 'success', title, description }),
    info: (title, description) => push({ kind: 'info', title, description }),
    error: (title, description) => push({ kind: 'error', title, description, ttlMs: 6000 }),
    warning: (title, description) => push({ kind: 'warning', title, description }),
    custom: (item) => push(item),
    dismiss,
  }

  return (
    <ToastContext.Provider value={ctxValue}>
      {children}
      <ToastViewport items={items} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

function ToastViewport({
  items,
  dismiss,
}: {
  items: ToastItem[]
  dismiss: (id: string) => void
}) {
  // SSR/CSR mismatch 방지
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  return (
    <div className="pointer-events-none fixed inset-0 z-[9999] flex flex-col items-end gap-2 p-4 sm:p-6">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto pp-toast w-full max-w-sm rounded-2xl border shadow-2xl backdrop-blur-2xl"
          style={{
            background:
              t.kind === 'success'
                ? 'linear-gradient(180deg, rgba(236,253,245,0.96), rgba(209,250,229,0.92))'
                : t.kind === 'error'
                ? 'linear-gradient(180deg, rgba(254,242,242,0.96), rgba(254,226,226,0.92))'
                : t.kind === 'warning'
                ? 'linear-gradient(180deg, rgba(255,251,235,0.96), rgba(254,243,199,0.92))'
                : 'linear-gradient(180deg, rgba(239,246,255,0.96), rgba(219,234,254,0.92))',
            borderColor:
              t.kind === 'success'
                ? 'rgba(16,185,129,0.45)'
                : t.kind === 'error'
                ? 'rgba(239,68,68,0.45)'
                : t.kind === 'warning'
                ? 'rgba(245,158,11,0.45)'
                : 'rgba(59,130,246,0.45)',
          }}
        >
          <div className="flex items-start gap-3 p-4">
            <div className="text-2xl">
              {t.kind === 'success' ? '✅' : t.kind === 'error' ? '❌' : t.kind === 'warning' ? '⚠️' : 'ℹ️'}
            </div>
            <div className="flex-1">
              <div className="text-sm font-black text-slate-900">{t.title}</div>
              {t.description && (
                <div className="mt-1 text-xs leading-5 text-slate-700">{t.description}</div>
              )}
              {t.actionLabel && t.onAction && (
                <button
                  onClick={() => {
                    t.onAction?.()
                    dismiss(t.id)
                  }}
                  className="mt-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-500 px-3 py-1.5 text-xs font-black text-white shadow"
                >
                  {t.actionLabel}
                </button>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="rounded-full px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-100"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
