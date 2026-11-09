import { useRef } from 'react'
import { cn } from '../../lib/cn.js'

/**
 * Control segmentado con indicador deslizante (radiogroup).
 * options: [{ value, label, hint? }]
 */
export default function Segmented({ options, value, onChange, label, size = 'md', className }) {
  const refs = useRef([])
  const index = Math.max(0, options.findIndex((o) => o.value === value))

  const onKeyDown = (e) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const next = (index + dir + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('relative grid rounded-xl bg-neutral-100 p-1 dark:bg-neutral-800', className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <div
        aria-hidden
        className="absolute bottom-1 left-1 top-1 rounded-lg bg-white shadow-sm ring-1 ring-neutral-900/5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] dark:bg-neutral-950 dark:ring-white/10"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${index * 100}%)` }}
      />
      {options.map((o, i) => {
        const active = i === index
        return (
          <button
            key={o.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'focus-ring relative z-10 flex flex-col items-center justify-center rounded-lg px-3 font-medium transition-colors',
              size === 'sm' ? 'h-8 text-[13px]' : o.hint ? 'h-12 text-sm' : 'h-9 text-sm',
              active ? 'text-neutral-900 dark:text-white' : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200',
            )}
          >
            <span className="leading-tight">{o.label}</span>
            {o.hint && <span className="mt-0.5 text-xs font-normal tabular-nums text-neutral-500 dark:text-neutral-400">{o.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
