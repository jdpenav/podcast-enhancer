import { cn } from '../../lib/cn.js'

/**
 * Barra de progreso suave.
 * - `value`: 0–100 (anima el ancho con transición).
 * - `indeterminate`: barra corta que recorre la pista (sin porcentaje conocido).
 * - `shimmer`: brillo que pasa por encima del relleno (p. ej. "uniendo y exportando").
 * - `tone`: 'default' | 'muted' (pausado) | 'success' | 'error'.
 */
export default function ProgressBar({ value = 0, indeterminate = false, shimmer = false, tone = 'default', size = 'md', label, className }) {
  const pct = Math.max(0, Math.min(100, value))
  const fill = {
    default: 'bg-neutral-900 dark:bg-white',
    muted: 'bg-neutral-400 dark:bg-neutral-500',
    success: 'bg-emerald-600 dark:bg-emerald-500',
    error: 'bg-red-600',
  }[tone]

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800',
        size === 'sm' ? 'h-1.5' : 'h-2',
        className,
      )}
    >
      {indeterminate ? (
        <div className={cn('absolute inset-y-0 left-0 w-1/3 animate-shimmer rounded-full', fill)} />
      ) : (
        <div
          className={cn('relative h-full overflow-hidden rounded-full transition-[width] duration-700 ease-out', fill)}
          style={{ width: `${pct}%` }}
        >
          {shimmer && (
            <div className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-neutral-900/40" />
          )}
        </div>
      )}
    </div>
  )
}
