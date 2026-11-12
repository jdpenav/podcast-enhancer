import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js'
import MinimapPlugin from 'wavesurfer.js/dist/plugins/minimap.esm.js'
import HoverPlugin from 'wavesurfer.js/dist/plugins/hover.esm.js'
import { useIsDark } from '../../hooks/useIsDark.js'
import { formatClock } from '../../lib/format.js'

const MIN_CUT = 0.2 // s: selecciones más cortas se descartan (clics accidentales)

function colors(dark) {
  return dark
    ? { wave: '#525252', progress: '#f5f5f5', cursor: '#ffffff', cut: 'rgba(248, 113, 113, 0.28)', overlay: 'rgba(255,255,255,0.12)', label: '#a3a3a3' }
    : { wave: '#c7c7c7', progress: '#171717', cursor: '#171717', cut: 'rgba(239, 68, 68, 0.22)', overlay: 'rgba(23,23,23,0.08)', label: '#737373' }
}

export const newCutId = () => `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/**
 * Onda del editor con wavesurfer.js.
 *  - Se dibuja desde PICOS PRECALCULADOS (el navegador nunca decodifica la hora de audio) y
 *    suena por streaming con un <audio> normal (HTTP Range).
 *  - Los cortes son regiones: arrastrar sobre la onda crea uno; se mueven y redimensionan.
 *  - wavesurfer NO edita audio: solo marca tiempos. El corte real lo hace ffmpeg al exportar.
 *
 * Props: src, peaks, duration, cuts, onCutsChange(cuts), skipCuts, zoom (px/s; 0 = ajustar),
 *        onTime(t), onPlayChange(bool), onReady(), onZoomFit(pxPerSec)
 * Ref: play(), pause(), toggle(), seek(t), skip(s), time(), playRange(from, to?)
 */
const WaveEditor = forwardRef(function WaveEditor({ src, peaks, duration, cuts, onCutsChange, skipCuts, zoom, onTime, onPlayChange, onReady, onZoomFit }, ref) {
  const waveRef = useRef(null)
  const miniRef = useRef(null)
  const ws = useRef(null)
  const regions = useRef(null)
  const syncing = useRef(false)
  const ready = useRef(false) // regiones solo después de 'ready' (antes, addRegion se difiere y emite eventos tarde)
  const stopAt = useRef(null)
  const skipOverride = useRef(null) // fuerza saltar (o no) los cortes durante una previsualización puntual
  const dark = useIsDark()

  // Últimos valores para los manejadores de eventos (sin recrear wavesurfer)
  const latest = useRef({})
  latest.current = { cuts, onCutsChange, skipCuts, onTime, onPlayChange, onReady, onZoomFit }

  const collect = () =>
    regions.current
      .getRegions()
      .map((r) => ({ id: r.id, start: Math.round(r.start * 1000) / 1000, end: Math.round(r.end * 1000) / 1000 }))
      .sort((a, b) => a.start - b.start)

  // Crear wavesurfer una vez por audio
  useEffect(() => {
    if (!waveRef.current || !peaks?.length || !duration) return
    const c = colors(document.documentElement.classList.contains('dark'))
    const media = new Audio()
    media.preload = 'metadata'
    media.src = src
    const reg = RegionsPlugin.create()
    const instance = WaveSurfer.create({
      container: waveRef.current,
      media,
      peaks: [peaks],
      duration,
      height: 132,
      waveColor: c.wave,
      progressColor: c.progress,
      cursorColor: c.cursor,
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      autoScroll: true,
      autoCenter: true,
      hideScrollbar: false,
      plugins: [
        reg,
        TimelinePlugin.create({ height: 18, insertPosition: 'beforebegin', formatTimeCallback: (s) => formatClock(s), style: { fontSize: '11px', color: c.label } }),
        MinimapPlugin.create({ container: miniRef.current, height: 36, waveColor: c.wave, progressColor: c.progress, cursorColor: c.cursor, overlayColor: c.overlay, barWidth: 1, barGap: 1, normalize: true }),
        HoverPlugin.create({ lineColor: c.cursor, lineWidth: 1, labelBackground: dark ? '#fafafa' : '#171717', labelColor: dark ? '#171717' : '#fafafa', labelSize: '11px', formatTimeCallback: (s) => formatClock(s) }),
      ],
    })
    ws.current = instance
    regions.current = reg
    reg.enableDragSelection({ color: c.cut }, 4)

    const emit = () => latest.current.onCutsChange?.(collect())
    reg.on('region-created', (r) => {
      if (syncing.current || !ready.current) return
      if (r.end - r.start < MIN_CUT) return r.remove()
      // Ids estables y legibles para la lista de cortes
      if (!r.id.startsWith('c_')) r.setOptions({ id: newCutId() })
      emit()
    })
    reg.on('region-updated', () => !syncing.current && ready.current && emit())
    reg.on('region-clicked', (r, e) => {
      e.stopPropagation()
      instance.setTime(r.start)
    })

    instance.on('timeupdate', (t) => {
      latest.current.onTime?.(t)
      if (!instance.isPlaying()) return
      if (stopAt.current != null && t >= stopAt.current) {
        stopAt.current = null
        skipOverride.current = null
        instance.pause()
        return
      }
      // Previsualizar el resultado: saltar las partes marcadas para cortar
      if (skipOverride.current ?? latest.current.skipCuts) {
        const cut = latest.current.cuts?.find((x) => t >= x.start && t < x.end - 0.05)
        if (cut) instance.setTime(Math.min(cut.end, duration))
      }
    })
    instance.on('interaction', () => {
      stopAt.current = null
      skipOverride.current = null
    })
    instance.on('play', () => latest.current.onPlayChange?.(true))
    instance.on('pause', () => latest.current.onPlayChange?.(false))
    instance.on('finish', () => latest.current.onPlayChange?.(false))
    instance.on('ready', () => {
      // Pintar los cortes que ya existían (con la duración ya conocida, addRegion es inmediato)
      ready.current = true
      const col = colors(document.documentElement.classList.contains('dark'))
      syncing.current = true
      for (const cut of latest.current.cuts ?? []) reg.addRegion({ id: cut.id, start: cut.start, end: cut.end, color: col.cut })
      syncing.current = false
      const fit = (waveRef.current?.clientWidth || 800) / duration
      latest.current.onZoomFit?.(fit)
      latest.current.onReady?.()
    })

    return () => {
      ready.current = false
      instance.destroy()
      media.pause()
      media.removeAttribute('src')
      media.load()
      ws.current = null
      regions.current = null
    }
  }, [src, peaks, duration]) // eslint-disable-line react-hooks/exhaustive-deps

  // Colores al cambiar de tema
  useEffect(() => {
    const instance = ws.current
    if (!instance) return
    const c = colors(dark)
    instance.setOptions({ waveColor: c.wave, progressColor: c.progress, cursorColor: c.cursor })
    syncing.current = true
    for (const r of regions.current?.getRegions() ?? []) r.setOptions({ color: c.cut })
    syncing.current = false
  }, [dark])

  // Reconciliar regiones cuando los cortes cambian desde fuera (lista, botones, deshacer)
  useEffect(() => {
    const reg = regions.current
    if (!reg || !ready.current) return
    const c = colors(document.documentElement.classList.contains('dark'))
    const byId = new Map(reg.getRegions().map((r) => [r.id, r]))
    syncing.current = true
    for (const cut of cuts ?? []) {
      const r = byId.get(cut.id)
      if (!r) reg.addRegion({ id: cut.id, start: cut.start, end: cut.end, color: c.cut })
      else if (Math.abs(r.start - cut.start) > 0.0005 || Math.abs(r.end - cut.end) > 0.0005) r.setOptions({ start: cut.start, end: cut.end })
      byId.delete(cut.id)
    }
    for (const r of byId.values()) r.remove()
    syncing.current = false
  }, [cuts])

  // Zoom (px por segundo). 0 = ajustar al ancho.
  useEffect(() => {
    const instance = ws.current
    if (!instance || !instance.getDuration()) return
    try {
      instance.zoom(zoom || 0)
    } catch {
      /* aún sin audio */
    }
  }, [zoom])

  const endPreview = () => {
    stopAt.current = null
    skipOverride.current = null
  }

  useImperativeHandle(ref, () => ({
    // Cualquier control manual termina una previsualización puntual
    play: () => {
      endPreview()
      ws.current?.play().catch(() => {})
    },
    pause: () => {
      endPreview()
      ws.current?.pause()
    },
    toggle: () => {
      endPreview()
      ws.current?.playPause().catch(() => {})
    },
    seek: (t) => ws.current?.setTime(Math.max(0, Math.min(duration, t))),
    skip: (s) => ws.current?.setTime(Math.max(0, Math.min(duration, (ws.current?.getCurrentTime() ?? 0) + s))),
    time: () => ws.current?.getCurrentTime() ?? 0,
    playing: () => !!ws.current?.isPlaying(),
    /** Reproduce desde `from` (y se detiene en `to` si se indica). `skip`: saltar cortes solo esta vez. */
    playRange: (from, to = null, { skip = null } = {}) => {
      if (!ws.current) return
      stopAt.current = to
      skipOverride.current = skip
      ws.current.setTime(Math.max(0, from))
      ws.current.play().catch(() => {})
    },
  }))

  return (
    <div className="select-none">
      <div ref={waveRef} id="editor-wave" className="min-h-[150px]" />
      <div className="mt-2 rounded-lg bg-neutral-100 px-1 py-0.5 dark:bg-neutral-800/60" aria-label="Vista general del episodio">
        <div ref={miniRef} />
      </div>
    </div>
  )
})

export default WaveEditor
