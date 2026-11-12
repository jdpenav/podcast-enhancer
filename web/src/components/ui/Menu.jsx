import { useEffect, useId, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '../../lib/cn.js'

/**
 * Menú desplegable accesible (role="menu").
 * - `trigger`: función ({ open, toggle, props }) que renderiza el botón; hay que esparcir `props` en él.
 * - items: [{ key, label, hint?, icon?, href?, download?, target?, selected?, onSelect? }]
 * - `placement`: 'bottom' | 'top'; `align`: 'start' | 'end'.
 */
export default function Menu({ trigger, items, placement = 'bottom', align = 'start', label }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const itemRefs = useRef([])
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e) => !rootRef.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        rootRef.current?.querySelector('[aria-haspopup]')?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey, true)
    // Enfocar el elemento seleccionado (o el primero) al abrir
    const sel = items.findIndex((i) => i.selected)
    requestAnimationFrame(() => itemRefs.current[Math.max(0, sel)]?.focus())
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const onMenuKey = (e) => {
    const els = itemRefs.current.filter(Boolean)
    const i = els.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      els[(i + 1) % els.length]?.focus()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      els[(i - 1 + els.length) % els.length]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const select = (item) => {
    item.onSelect?.()
    setOpen(false)
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      {trigger({
        open,
        toggle: () => setOpen((o) => !o),
        props: {
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          'aria-controls': open ? id : undefined,
          onClick: () => setOpen((o) => !o),
          onKeyDown: (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              setOpen(true)
            }
          },
        },
      })}
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cn(
            'absolute z-40 min-w-[11rem] animate-pop-in rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-xl shadow-neutral-900/10',
            'dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40',
            placement === 'top' ? 'bottom-full mb-2 origin-bottom' : 'top-full mt-2 origin-top',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => {
            const Icon = item.icon
            const content = (
              <>
                {Icon ? <Icon size={16} className="shrink-0 text-neutral-500" aria-hidden /> : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium">{item.label}</span>
                  {item.hint && <span className="text-xs text-neutral-500 dark:text-neutral-400">{item.hint}</span>}
                </span>
                {item.selected && <Check size={16} className="shrink-0" aria-hidden />}
              </>
            )
            const cls =
              'flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-neutral-100 focus-visible:bg-neutral-100 dark:hover:bg-neutral-800 dark:focus-visible:bg-neutral-800'
            return item.href ? (
              <a
                key={item.key}
                ref={(el) => (itemRefs.current[i] = el)}
                role="menuitem"
                href={item.href}
                download={item.download}
                target={item.target}
                rel={item.target ? 'noreferrer' : undefined}
                onClick={() => select(item)}
                className={cls}
              >
                {content}
              </a>
            ) : (
              <button
                key={item.key}
                ref={(el) => (itemRefs.current[i] = el)}
                type="button"
                role={item.selected !== undefined ? 'menuitemradio' : 'menuitem'}
                aria-checked={item.selected !== undefined ? !!item.selected : undefined}
                onClick={() => select(item)}
                className={cls}
              >
                {content}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
