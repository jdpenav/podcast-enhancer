import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'
import Waveform from './Waveform.jsx'
import { formatClock } from '../lib/format.js'

/**
 * Reproductor "píldora" negra con forma de onda y comparación A/B.
 * - tracks: { [key]: { src, peaks } } — se precargan todas para cambiar sin cortes largos.
 * - active: clave de la pista que suena. Al cambiarla se conserva posición y estado (play/pausa).
 * - rate: velocidad de reproducción.
 * - onToggleCompare: tecla "C" alterna pistas.
 * Atajos: Espacio/K reproducir, ← → 5 s (Mayús: 30 s), C comparar.
 */
export default function AudioPlayer({ tracks, active, rate = 1, fallbackDuration = 0, onToggleCompare }) {
  const audios = useRef({})
  const [playing, setPlaying] = useState(false)
  const [buffering, setBuffering] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState(null)
  const prevActive = useRef(active)
  const raf = useRef(0)

  // Bucle de animación para que la onda avance suave mientras suena
  const loop = useCallback(() => {
    const a = audios.current[prevActive.current]
    if (a) setCurrent(a.currentTime)
    raf.current = requestAnimationFrame(loop)
  }, [])

  useEffect(() => {
    if (playing) raf.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf.current)
  }, [playing, loop])

  // Cambio Original ↔ Mejorado: misma posición, mismo estado
  useEffect(() => {
    const from = audios.current[prevActive.current]
    const to = audios.current[active]
    prevActive.current = active
    if (!from || !to || from === to) return
    const wasPlaying = !from.paused
    try {
      to.currentTime = from.currentTime
    } catch {
      /* aún sin metadatos */
    }
    from.pause()
    if (wasPlaying) to.play().catch(() => setPlaying(false))
    if (Number.isFinite(to.duration)) setDuration(to.duration)
  }, [active])

  useEffect(() => {
    Object.values(audios.current).forEach((a) => a && (a.playbackRate = rate))
  }, [rate])

  const toggle = useCallback(() => {
    const a = audios.current[prevActive.current]
    if (!a) return
    if (a.paused) a.play().catch((e) => setError(e.message))
    else a.pause()
  }, [])

  const seek = useCallback(
    (fraction) => {
      const a = audios.current[prevActive.current]
      const d = Number.isFinite(a?.duration) ? a.duration : 0
      if (!a || !d) return
      a.currentTime = fraction * d
      setCurrent(a.currentTime)
    },
    [],
  )

  const skip = useCallback((sec) => {
    const a = audios.current[prevActive.current]
    if (!a || !Number.isFinite(a.duration)) return
    a.currentTime = Math.max(0, Math.min(a.duration - 0.05, a.currentTime + sec))
    setCurrent(a.currentTime)
  }, [])

  // Atajos de teclado (mientras el reproductor está montado)
  useEffect(() => {
    const onKey = (e) => {
      const t = e.target
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const onControl = ['BUTTON', 'A'].includes(t.tagName) || t.getAttribute?.('role')?.startsWith('menuitem')
      if ((e.key === ' ' && !onControl) || e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        toggle()
      } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !t.getAttribute?.('role')?.match(/radio|slider|menuitem/)) {
        e.preventDefault()
        skip((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 30 : 5))
      } else if (e.key === 'c' || e.key === 'C') {
        onToggleCompare?.()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toggle, skip, onToggleCompare])

  // Al desmontar, parar el audio
  useEffect(() => () => Object.values(audios.current).forEach((a) => a?.pause()), [])

  const bind = (key) => ({
    ref: (node) => (audios.current[key] = node),
    preload: 'auto',
    onLoadedMetadata: (e) => {
      if (key === prevActive.current) setDuration(e.currentTarget.duration)
      e.currentTarget.playbackRate = rate
    },
    onPlay: () => key === prevActive.current && setPlaying(true),
    onPause: () => key === prevActive.current && setPlaying(false),
    onEnded: () => key === prevActive.current && setPlaying(false),
    onWaiting: () => key === prevActive.current && setBuffering(true),
    onPlaying: () => key === prevActive.current && setBuffering(false),
    onCanPlay: () => key === prevActive.current && setBuffering(false),
    onError: () => key === prevActive.current && setError('No se pudo cargar el audio.'),
  })

  const d = duration || fallbackDuration
  const track = tracks[active]

  return (
    <div>
      {Object.entries(tracks).map(([key, t]) => (
        <audio key={key} src={t.src} {...bind(key)} />
      ))}
      <div className="flex h-[72px] items-center gap-3 rounded-full bg-neutral-950 py-3 pl-3 pr-5 shadow-xl shadow-neutral-900/20 ring-1 ring-white/5 sm:gap-4 sm:pr-6 dark:shadow-black/40 dark:ring-neutral-800">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pausar' : 'Reproducir'}
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-white text-neutral-950 shadow-md transition-transform duration-150 hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
        >
          {playing && buffering ? (
            <Loader2 size={20} className="animate-spin" />
          ) : playing ? (
            <Pause size={20} fill="currentColor" strokeWidth={0} />
          ) : (
            <Play size={20} fill="currentColor" strokeWidth={0} className="ml-0.5" />
          )}
        </button>
        <Waveform peaks={track?.peaks} loading={!track?.peaks} progress={d ? current / d : 0} duration={d} onSeek={seek} />
        <div className="shrink-0 text-right text-sm font-medium tabular-nums text-white">
          {formatClock(current)}
          <span className="hidden text-neutral-500 sm:inline"> / {formatClock(d)}</span>
        </div>
      </div>
      {error && <p className="mt-2 text-center text-[13px] text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
