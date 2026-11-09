import { forwardRef } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn.js'

const VARIANTS = {
  primary:
    'bg-neutral-900 text-white hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200 shadow-sm',
  secondary:
    'bg-white text-neutral-900 border border-neutral-200 hover:bg-neutral-50 dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800',
  ghost:
    'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
}

const SIZES = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-11 px-5 text-sm gap-2 rounded-xl',
  icon: 'h-9 w-9 rounded-xl',
  'icon-sm': 'h-8 w-8 rounded-lg',
}

/**
 * Botón base. `icon` es un componente de lucide-react.
 * `loading` muestra un spinner y desactiva el botón.
 */
const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading = false, className, children, disabled, type = 'button', ...props },
  ref,
) {
  const iconSize = size === 'sm' || size === 'icon-sm' ? 15 : 17
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'focus-ring inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap font-medium',
        'transition-[background-color,color,transform,box-shadow] duration-150 active:scale-[0.97]',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 size={iconSize} className="animate-spin" aria-hidden />
      ) : (
        Icon && <Icon size={iconSize} strokeWidth={2} aria-hidden />
      )}
      {children}
    </button>
  )
})

export default Button
