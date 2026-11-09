import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { formatClock } from '../lib/format.js'

const BAR = 3 // ancho de barra (px)
const GAP = 2 // separación (px)

/**
 * Reduce los 1000 picos al número de barras que caben.
 * Usa el promedio de cada tramo (el máximo aplana la onda) y normaliza al más alto.
 */
function resample(peaks, n) {
  if (!peaks?.length || n <= 0) return new Array(Math.max(0, n)).fill(0.12)
  const avg = new Array(n)
  const size = peaks.length / n
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * size)
    const end = Math.max(start + 1, Math.min(peaks.length, Math.floor((i + 1) * size)))
    let sum = 0
    for (let j = start; j < end; j++) sum += peaks[j]
    avg[i] = sum / (end - start)
  }
  const top = Math.max(...avg) || 1
  // Curva suave para que la voz baja también se vea; mínimo visible en silencios
  return avg.map((v) => Math.max(0.08, Math.pow(v / top, 0.8)))
}

const Bars = memo(function Bars({ heights, className }) {
  return (
    <div className={`absolute inset-0 flex items-center ${className}`} style={{ gap: GAP }}>
      {heights.map((h, i) => (
        <span
          key={i}
          className="h-full shrink-0 rounded-full bg-current transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ width: BAR, transform: `scaleY(${h})` }}
        />
      ))}
    </div>
  )
})

/**
 * Forma de onda clicable/arrastrable para adelantar.
 * Dos capas de barras: gris (base) y blanca (reproducida, recortada con clip-path).
 * Al cambiar `peaks` (Original ↔ Mejorado) las barras se transforman con animación.
 */
export default function Waveform({ peaks, progress, duration, onSeek, loading }) {
  const ref = useRef(null)
  const [width, setWidth] = useState(0)
  const [hover, setHover] = useState(null) // fracción bajo el puntero
  const dragging = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const n = Math.max(0, Math.floor((width + GAP) / (BAR + GAP)))
  const heights = useMemo(() => resample(loading ? null : peaks, n), [peaks, n, loading])
  const pct = Math.max(0, Math.min(1, progress || 0)) * 100

  const fractionAt = (e) => {
    const r = ref.current.getBoundingClientRect()
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
  }

  const onPointerDown = (e) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    onSeek(fractionAt(e))
  }
  const onPointerMove = (e) => {
    const f = fractionAt(e)
    setHover(f)
    if (dragging.current) onSeek(f)
  }
  const onPointerUp = () => {
    dragging.current = false
  }

  const onKeyDown = (e) => {
    const step = e.shiftKey ? 30 : 5
    if (!duration) return
    if (e.key === 'ArrowRight') onSeek(Math.min(1, progress + step / duration))
    else if (e.key === 'ArrowLeft') onSeek(Math.max(0, progress - step / duration))
    else if (e.key === 'Home') onSeek(0)
    else if (e.key === 'End') onSeek(0.999)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={0}
      aria-label="Posición de reproducción"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration || 0)}
      aria-valuenow={Math.round((progress || 0) * (duration || 0))}
      aria-valuetext={`${formatClock((progress || 0) * (duration || 0))} de ${formatClock(duration)}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKeyDown}
      className="group relative h-10 min-w-0 flex-1 cursor-pointer touch-none select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
    >
      <Bars heights={heights} className={loading ? 'animate-pulse text-neutral-700' : 'text-neutral-600'} />
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pct}% 0 0)` }}>
        <Bars heights={heights} className="text-white" />
      </div>
      {/* Indicador al pasar el ratón */}
      {hover !== null && !loading && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-white/70" style={{ left: `${hover * 100}%` }} />
          <div
            className="pointer-events-none absolute -top-9 -translate-x-1/2 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-neutral-900 shadow"
            style={{ left: `${hover * 100}%` }}
          >
            {formatClock(hover * (duration || 0))}
          </div>
        </>
      )}
    </div>
  )
}
