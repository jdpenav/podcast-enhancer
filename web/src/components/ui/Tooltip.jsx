import { cn } from '../../lib/cn.js'

/** Tooltip CSS simple (hover y foco). Para textos cortos. */
export default function Tooltip({ content, children, side = 'bottom', className }) {
  if (!content) return children
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-40 w-max max-w-[16rem] -translate-x-1/2 rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity duration-150 dark:bg-white dark:text-neutral-900',
          'group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
        )}
      >
        {content}
      </span>
    </span>
  )
}
