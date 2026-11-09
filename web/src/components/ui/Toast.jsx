import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const ToastContext = createContext(null)

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info }
const ICON_COLOR = { success: 'text-emerald-500', error: 'text-red-500', info: 'text-neutral-400' }

/**
 * Toasts abajo a la derecha (abajo centrados en móvil).
 * toast({ title, description?, tone?: 'info'|'success'|'error', action?: { label, onClick }, duration? })
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)

  const dismiss = useCallback((id) => {
    setToasts((ts) => ts.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== id)), 180)
  }, [])

  const toast = useCallback((opts) => {
    const id = ++idRef.current
    setToasts((ts) => [...ts.slice(-3), { id, tone: 'info', duration: 4500, ...opts }])
    return id
  }, [])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-end sm:p-6"
      >
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast, onDismiss: dismissById }) {
  const [hover, setHover] = useState(false)
  const id = toast.id
  const onDismiss = useCallback(() => dismissById(id), [dismissById, id])
  const Icon = ICONS[toast.tone] ?? Info

  // Se cierra solo; se detiene mientras el ratón está encima
  useEffect(() => {
    if (hover || !toast.duration) return
    const t = setTimeout(onDismiss, toast.duration)
    return () => clearTimeout(t)
  }, [hover, toast.duration, onDismiss])

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={cn(
        'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl bg-neutral-900 p-4 text-white shadow-2xl shadow-neutral-900/20',
        'dark:bg-white dark:text-neutral-900',
        toast.leaving ? 'translate-y-2 opacity-0 transition-all duration-150' : 'animate-slide-up',
      )}
    >
      <Icon size={18} className={cn('mt-0.5 shrink-0', ICON_COLOR[toast.tone])} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-[13px] leading-5 text-neutral-400 dark:text-neutral-500">{toast.description}</p>}
        {toast.action && (
          <button
            type="button"
            onClick={() => {
              toast.action.onClick()
              onDismiss()
            }}
            className="mt-2 rounded-lg bg-white/10 px-2.5 py-1 text-[13px] font-medium transition-colors hover:bg-white/20 dark:bg-neutral-900/10 dark:hover:bg-neutral-900/20"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Cerrar aviso"
        className="-m-1 rounded-lg p-1 text-neutral-500 transition-colors hover:text-white dark:hover:text-neutral-900"
      >
        <X size={16} />
      </button>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
