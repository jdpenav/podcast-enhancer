import { cn } from '../../lib/cn.js'

const TONES = {
  neutral: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  outline: 'border border-neutral-200 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300',
  dark: 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  error: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  muted: 'bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500',
}

/** Badge pequeño. `dot` añade un punto; `pulse` lo anima (para "Procesando"). */
export default function Badge({ tone = 'neutral', dot = false, pulse = false, icon: Icon, className, children }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {dot && (
        <span className={cn('h-1.5 w-1.5 rounded-full bg-current', pulse && 'animate-pulse-dot')} aria-hidden />
      )}
      {Icon && <Icon size={13} strokeWidth={2.25} aria-hidden />}
      {children}
    </span>
  )
}
