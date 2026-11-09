import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const EXIT_MS = 160
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Modal accesible hecho a mano:
 * - Animación de entrada/salida, fondo con desenfoque.
 * - En móvil se muestra como hoja inferior (bottom sheet).
 * - Esc y clic fuera cierran (salvo `dismissable={false}`), foco atrapado y restaurado al cerrar.
 */
export default function Modal({ open, onClose, title, description, dismissable = true, size = 'md', children, footer }) {
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const panelRef = useRef(null)
  const restoreRef = useRef(null)
  const titleId = useId()
  const descId = useId()

  // Montar/desmontar con animación de salida
  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (!mounted) return
    setClosing(true)
    const t = setTimeout(() => {
      setMounted(false)
      setClosing(false)
    }, EXIT_MS)
    return () => clearTimeout(t)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Foco inicial, bloqueo de scroll y restauración de foco
  useEffect(() => {
    if (!mounted) return
    restoreRef.current = document.activeElement
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const panel = panelRef.current
    // Foco en [data-autofocus] si existe; si no, en el panel (sin anillo visible)
    ;(panel?.querySelector('[data-autofocus]') ?? panel)?.focus({ preventScroll: true })
    return () => {
      document.body.style.overflow = prevOverflow
      restoreRef.current?.focus?.({ preventScroll: true })
    }
  }, [mounted])

  // Esc + foco atrapado con Tab
  useEffect(() => {
    if (!mounted) return
    const onKey = (e) => {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation()
        onClose?.()
      }
      if (e.key === 'Tab') {
        const items = [...(panelRef.current?.querySelectorAll(FOCUSABLE) ?? [])]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mounted, dismissable, onClose])

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className={cn(
          'absolute inset-0 bg-neutral-950/40 backdrop-blur-[3px] dark:bg-black/60',
          closing ? 'opacity-0 transition-opacity duration-150' : 'animate-fade-in',
        )}
        onClick={() => dismissable && onClose?.()}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-hidden outline-none',
          'rounded-t-3xl border border-neutral-200 bg-white shadow-2xl sm:rounded-3xl',
          'dark:border-neutral-800 dark:bg-neutral-900',
          size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
          closing ? 'translate-y-2 opacity-0 transition-all duration-150' : 'animate-pop-in',
        )}
      >
        {/* Asa para la hoja inferior en móvil */}
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-neutral-200 sm:hidden dark:bg-neutral-700" aria-hidden />
        {(title || dismissable) && (
          <div className="flex items-start gap-4 px-6 pb-1 pt-5 sm:pt-6">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={titleId} className="truncate text-lg font-semibold tracking-tight">
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                  {description}
                </p>
              )}
            </div>
            {dismissable && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="focus-ring -mr-2 -mt-1 rounded-lg p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}
        <div className="overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-neutral-100 px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end dark:border-neutral-800">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
