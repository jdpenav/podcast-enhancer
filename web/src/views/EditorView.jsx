import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle, ArrowLeft, Check, CheckCircle2, Download, FastForward, Info, Loader2, Pause, Play, Rewind,
  Scissors, SkipBack, SkipForward, Upload, X, XCircle, ZoomIn, ZoomOut,
} from 'lucide-react'
import WaveEditor, { newCutId } from '../components/editor/WaveEditor.jsx'
import { CurtainsPanel, CutsPanel, Panel, PresetEditor, Structure } from '../components/editor/EditorPanels.jsx'
import EpisodeRow from '../components/library/EpisodeRow.jsx'
import Button from '../components/ui/Button.jsx'
import ProgressBar from '../components/ui/ProgressBar.jsx'
import Tooltip from '../components/ui/Tooltip.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { cn } from '../lib/cn.js'
import { EXPORT_STAGE, statusMeta, liveJob } from '../lib/episodes.js'
import { formatBytes, formatClock, formatDate, formatRelative, formatTimecode } from '../lib/format.js'
import { routeHref } from '../hooks/useRoute.js'

const SAVE_DELAY = 800
const MAX_ZOOM = 100 // px por segundo

/** Une/recorta cortes solapados y los ordena (lo mismo que hará el servidor al exportar). */
function tidy(cuts, duration) {
  return cuts
    .map((c) => ({ ...c, start: Math.max(0, Math.min(c.start, duration)), end: Math.max(0, Math.min(c.end, duration)) }))
    .filter((c) => c.end - c.start >= 0.05)
    .sort((a, b) => a.start - b.start)
}

function removedSeconds(cuts) {
  let total = 0
  let reach = 0
  for (const c of [...cuts].sort((a, b) => a.start - b.start)) {
    const s = Math.max(c.start, reach)
    if (c.end > s) total += c.end - s
    reach = Math.max(reach, c.end)
  }
  return total
}

function Kbd({ children }) {
  return (
    <kbd className="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-px font-sans text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
      {children}
    </kbd>
  )
}

/** Pantalla cuando el episodio aún no tiene audio mejorado: muestra en qué va y la acción siguiente. */
function NotReady({ ep, jobs, api, now, library, onEnhance }) {
  const toast = useToast()
  const onAction = async (kind) => {
    try {
      if (kind === 'download') await library.actions.download(ep.id)
      else if (kind === 'retry') await library.actions.retry(ep.id)
      else if (kind === 'cancel') await library.actions.cancel(ep.id)
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo completar', description: e.message })
    }
  }
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-2xl bg-neutral-100 p-4 text-sm text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300">
        <Info size={18} className="mt-0.5 shrink-0" aria-hidden />
        <p>Para editar y exportar, primero hay que {ep.files.source ? 'mejorar' : 'descargar y mejorar'} el audio. Cuando termine, esta pantalla se abre sola con la onda.</p>
      </div>
      <EpisodeRow ep={ep} jobs={jobs} api={api} now={now} onAction={onAction} onEnhance={onEnhance} onEdit={() => {}} />
    </div>
  )
}

/** Resumen de la exportación: duración, tamaño, sonoridad y si cumple con Castbox. */
function ExportResult({ ep, api, stale }) {
  const x = ep.export
  const Check2 = ({ ok, children }) => (
    <li className="flex items-center gap-2">
      {ok ? <CheckCircle2 size={15} className="shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <XCircle size={15} className="shrink-0 text-red-600 dark:text-red-400" aria-hidden />}
      <span>{children}</span>
    </li>
  )
  const stats = [
    ['Duración', formatClock(x.durationSec)],
    ['Tamaño', formatBytes(x.sizeBytes)],
    ['Formato', `${x.bitrateKbps} kbps · ${x.channels === 1 ? 'mono' : 'estéreo'}`],
    ['Sonoridad', x.lufs != null ? `${x.lufs} LUFS` : '—'],
  ]
  return (
    <div className="space-y-4">
      {stale && (
        <p className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
          Hay cambios sin exportar: este MP3 es de la versión anterior.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-2">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-neutral-100 px-3 py-2 dark:bg-neutral-800/60">
            <dt className="text-[11px] text-neutral-500 dark:text-neutral-400">{k}</dt>
            <dd className="text-sm font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <ul className="space-y-1.5 text-[13px]">
        <Check2 ok={x.checks.sizeOk}>Pesa menos de 400 MB (límite de Castbox)</Check2>
        <Check2 ok={x.checks.durationOk}>Duración coherente ({formatClock(x.expectedDurationSec)} esperados)</Check2>
        <Check2 ok={x.checks.loudnessOk}>
          Sonoridad cerca de {x.preset.lufs} LUFS{x.truePeak != null ? ` · pico ${x.truePeak} dBTP` : ''}
        </Check2>
      </ul>
      <audio controls preload="none" src={api.episodeAudioUrl(ep, 'final')} className="h-10 w-full" aria-label="Escuchar el MP3 final" />
      <a
        href={api.episodeDownloadUrl(ep, 'final')}
        className="focus-ring flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-neutral-900 text-sm font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
      >
        <Download size={17} aria-hidden /> Descargar MP3
      </a>
      <p className="flex gap-2 text-[12px] text-neutral-500 dark:text-neutral-400">
        <Upload size={14} className="mt-px shrink-0" aria-hidden />
        La subida a Castbox sigue siendo manual: descarga el MP3 y súbelo desde tu panel de Castbox.
      </p>
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500">Exportado {formatRelative(x.exportedAt)}</p>
    </div>
  )
}

/**
 * Editor de un episodio: onda (wavesurfer, desde picos), cortes, cortinas y exportación para Castbox.
 * El navegador solo marca tiempos; el servidor (ffmpeg) ejecuta todo al exportar.
 */
export default function EditorView({ api, config, id, library, jobs, now, mock, onEnhance }) {
  const toast = useToast()
  const ep = library.episodes.find((e) => e.id === id) ?? null
  const ready = !!ep?.files.enhanced
  const exporting = ep?.status === 'exporting'

  const [peaks, setPeaks] = useState(null) // { peaks, durationSec } | 'error'
  const [assets, setAssets] = useState(null) // { items, defaults }
  const [edit, setEdit] = useState(null) // { cuts, introId, outroId, preset }
  const [save, setSave] = useState('saved') // 'saved' | 'dirty' | 'saving' | 'error'
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [skipCuts, setSkipCuts] = useState(true)
  const [zoom, setZoom] = useState(0) // 0 = ajustar
  const [fit, setFit] = useState(0.2)
  const [exportBusy, setExportBusy] = useState(false)
  const [title, setTitle] = useState('')
  const wave = useRef(null)
  const history = useRef([])
  const lastTime = useRef(0)
  const dirtyRef = useRef(false)
  const editRef = useRef(edit)
  editRef.current = edit
  // library.actions es un objeto nuevo en cada render: usarlo por ref para no reiniciar temporizadores
  const actionsRef = useRef(library.actions)
  actionsRef.current = library.actions

  const duration = peaks && peaks !== 'error' ? peaks.durationSec : ep?.durationSec ?? 0

  // --- Carga: picos (cuando hay audio mejorado) y cortinas ---
  useEffect(() => {
    if (!api || !ready) return
    let alive = true
    setPeaks(null)
    api
      .getEpisodePeaks(id)
      .then((p) => alive && setPeaks(p))
      .catch(() => alive && setPeaks('error'))
    return () => {
      alive = false
    }
  }, [api, id, ready, ep?.enhance?.mode, ep?.enhance?.quality]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cortinas del espacio del episodio (cada espacio tiene las suyas)
  const wsId = ep?.workspaceId
  const loadAssets = useCallback(() => {
    if (!api || !wsId) return
    api.listAssets(wsId).then(setAssets).catch(() => setAssets({ items: [], defaults: {} }))
  }, [api, wsId])
  useEffect(loadAssets, [loadAssets])

  useEffect(() => {
    if (ep) setTitle(ep.title)
  }, [ep?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Estado inicial del editor (una vez por episodio) ---
  useEffect(() => {
    if (edit || !ep || !assets || !config) return
    const s = ep.editState
    setEdit({
      cuts: s?.cuts ?? [],
      introId: s ? s.introId : assets.defaults?.introId ?? null,
      outroId: s ? s.outroId : assets.defaults?.outroId ?? null,
      preset: { ...config.exportPreset, ...(s?.preset ?? {}) },
    })
    // Sin edición guardada pero con cortinas predeterminadas: guardar para que "Exportar" las use
    if (!s && (assets.defaults?.introId || assets.defaults?.outroId)) dirtyRef.current = true
  }, [ep, assets, config, edit])

  // --- Guardado automático ---
  const flush = useCallback(async () => {
    if (!dirtyRef.current || !editRef.current) return true
    dirtyRef.current = false
    setSave('saving')
    try {
      await actionsRef.current.saveEdit(id, editRef.current)
      setSave(dirtyRef.current ? 'dirty' : 'saved')
      return true
    } catch (e) {
      dirtyRef.current = true
      setSave('error')
      toast({ tone: 'error', title: 'No se pudo guardar la edición', description: e.message })
      return false
    }
  }, [id, toast])

  useEffect(() => {
    if (!edit || !dirtyRef.current || exporting) return
    setSave('dirty')
    const t = setTimeout(flush, SAVE_DELAY)
    return () => clearTimeout(t)
  }, [edit, flush, exporting])

  // Guardar al salir de la pantalla
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => () => void flushRef.current(), [])

  const change = useCallback((patch, { record = true } = {}) => {
    const prev = editRef.current
    if (!prev) return
    if (record && patch.cuts) history.current = [...history.current.slice(-49), prev.cuts]
    dirtyRef.current = true
    const next = { ...prev, ...patch }
    editRef.current = next
    setEdit(next)
  }, [])

  const setCuts = useCallback((cuts) => change({ cuts: tidy(cuts, duration) }), [change, duration])
  const undo = () => {
    const prev = history.current.pop()
    if (prev) change({ cuts: prev }, { record: false })
  }

  // --- Acciones sobre cortes ---
  const cuts = edit?.cuts ?? []
  const updateCut = (cid, patch) => {
    const c = cuts.find((x) => x.id === cid)
    const next = { ...c, ...patch }
    if (!(next.end - next.start >= 0.05) || next.start < 0 || next.start >= duration) return false
    setCuts(cuts.map((x) => (x.id === cid ? next : x)))
    return true
  }
  const cursor = () => wave.current?.time() ?? time
  const addCut = (start, end) => setCuts([...cuts, { id: newCutId(), start, end }])
  const cutStart = () => {
    const t = cursor()
    if (t < 0.5) return toast({ title: 'Mueve el cursor', description: 'Pon el cursor donde empieza lo que quieres conservar y vuelve a pulsar.' })
    setCuts([...cuts.filter((c) => c.start > 0.01), { id: newCutId(), start: 0, end: t }])
  }
  const cutEnd = () => {
    const t = cursor()
    if (duration - t < 0.5) return toast({ title: 'Mueve el cursor', description: 'Pon el cursor donde termina lo que quieres conservar y vuelve a pulsar.' })
    setCuts([...cuts.filter((c) => c.end < duration - 0.01), { id: newCutId(), start: t, end: duration }])
  }

  // --- Reproducción ---
  const onTime = useCallback((t) => {
    // ~10 actualizaciones por segundo bastan para el reloj
    if (Math.abs(t - lastTime.current) >= 0.1 || t === 0) {
      lastTime.current = t
      setTime(t)
    }
  }, [])

  // Zoom en escala logarítmica entre "ajustar" y MAX_ZOOM px/s
  const zoomLevel = zoom ? Math.round((Math.log(zoom / fit) / Math.log(MAX_ZOOM / fit)) * 100) : 0
  const setZoomLevel = (lvl) => setZoom(lvl <= 0 ? 0 : fit * Math.pow(MAX_ZOOM / fit, lvl / 100))
  const zoomBy = (d) => setZoomLevel(Math.max(0, Math.min(100, zoomLevel + d)))

  // Atajos de teclado
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || e.target?.isContentEditable || document.querySelector('[role="dialog"]')) return
      if (e.key === ' ' || e.key === 'k') {
        e.preventDefault()
        wave.current?.toggle()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        wave.current?.skip((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30 : 10))
      } else if (e.key === '+' || e.key === '=') zoomBy(15)
      else if (e.key === '-') zoomBy(-15)
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // --- Exportar ---
  const doExport = async () => {
    setExportBusy(true)
    try {
      if (!edit) return
      dirtyRef.current = true // asegurar que el servidor tiene exactamente lo que se ve
      if (!(await flush())) return
      await library.actions.export(id)
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo exportar', description: e.message })
    } finally {
      setExportBusy(false)
    }
  }
  const cancelExport = async () => {
    try {
      await library.actions.cancel(id)
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo cancelar', description: e.message })
    }
  }

  const saveTitle = async () => {
    const t = title.trim()
    if (!t || t === ep.title) return setTitle(ep.title)
    try {
      await library.actions.rename(id, t)
    } catch (e) {
      setTitle(ep.title)
      toast({ tone: 'error', title: 'No se pudo renombrar', description: e.message })
    }
  }

  // --- Derivados ---
  const items = assets?.items ?? []
  const intro = items.find((a) => a.id === edit?.introId) ?? null
  const outro = items.find((a) => a.id === edit?.outroId) ?? null
  const removed = useMemo(() => removedSeconds(cuts), [cuts])
  const bodySec = Math.max(0, duration - removed)
  const fadeSec = edit?.preset?.curtainFadeSec ?? 0
  const totalSec = bodySec + (intro?.durationSec ?? 0) + (outro?.durationSec ?? 0) - fadeSec * ((intro ? 1 : 0) + (outro ? 1 : 0))
  const stale = !!(ep?.export && ep?.editState?.savedAt && ep.editState.savedAt > ep.export.exportedAt)
  const job = ep ? liveJob(ep, jobs) : null
  const reEnhancing = ep?.status === 'enhancing' && job && ['pending', 'processing', 'paused'].includes(job.status)

  // --- Render ---
  if (!library.loaded || (ep && ready && (!edit || !assets))) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <p className="flex items-center justify-center gap-2 text-sm text-neutral-500">
          <Loader2 size={16} className="animate-spin" /> Cargando el editor…
        </p>
      </main>
    )
  }
  if (!ep) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <p className="font-semibold">Este episodio no existe</p>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Puede que se haya eliminado.</p>
        <a href={routeHref.library} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium underline-offset-2 hover:underline">
          <ArrowLeft size={15} /> Volver a la Biblioteca
        </a>
      </main>
    )
  }

  const s = statusMeta(ep, job)
  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      {/* Cabecera */}
      <div className="flex flex-wrap items-start gap-3">
        <a
          href={routeHref.library}
          className="focus-ring mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300"
          aria-label="Volver a la Biblioteca"
          title="Volver a la Biblioteca"
        >
          <ArrowLeft size={17} />
        </a>
        <div className="min-w-0 flex-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Título del episodio (se usa en las etiquetas del MP3)"
            className="focus-ring -mx-1.5 w-full truncate rounded-lg bg-transparent px-1.5 py-0.5 text-lg font-semibold tracking-tight hover:bg-white sm:text-xl dark:hover:bg-neutral-900"
          />
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-neutral-500 dark:text-neutral-400">
            <span>{s.label}</span>
            {ep.publishedAt && (
              <>
                <span aria-hidden>·</span>
                <span>{formatDate(ep.publishedAt)}</span>
              </>
            )}
            {ready && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1" aria-live="polite">
                  {save === 'saving' || save === 'dirty' ? (
                    <>
                      <Loader2 size={12} className="animate-spin" aria-hidden /> Guardando…
                    </>
                  ) : save === 'error' ? (
                    <span className="text-red-600 dark:text-red-400">No guardado</span>
                  ) : (
                    <>
                      <Check size={12} aria-hidden /> Guardado
                    </>
                  )}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {!ready ? (
        <div className="max-w-3xl">
          <NotReady ep={ep} jobs={jobs} api={api} now={now} library={library} onEnhance={onEnhance} />
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Columna principal: onda y transporte */}
          <div className="min-w-0 space-y-5">
            {reEnhancing && (
              <p className="flex gap-2 rounded-xl bg-neutral-100 px-3.5 py-2.5 text-[13px] text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300">
                <Info size={15} className="mt-0.5 shrink-0" aria-hidden />
                Se está mejorando de nuevo este audio. Puedes seguir editando; para exportar espera a que termine.
              </p>
            )}
            <section className="card overflow-hidden p-4 sm:p-5" aria-label="Onda del audio mejorado">
              <Structure intro={intro} outro={outro} bodySec={bodySec} totalSec={totalSec} removedSec={removed} />
              <div className="mt-4">
                {peaks === 'error' ? (
                  <p className="py-12 text-center text-sm text-red-600 dark:text-red-400">No se pudo cargar la forma de onda. Recarga la página.</p>
                ) : !peaks ? (
                  <div className="flex h-[200px] items-center justify-center gap-2 text-sm text-neutral-500">
                    <Loader2 size={16} className="animate-spin" /> Preparando la onda…
                  </div>
                ) : (
                  <WaveEditor
                    ref={wave}
                    src={mock ? '/mock/result.mp3' : api.episodeAudioUrl(ep, 'enhanced')}
                    peaks={peaks.peaks}
                    duration={peaks.durationSec}
                    cuts={cuts}
                    onCutsChange={(c) => setCuts(c)}
                    skipCuts={skipCuts}
                    zoom={zoom}
                    onTime={onTime}
                    onPlayChange={setPlaying}
                    onZoomFit={setFit}
                  />
                )}
              </div>

              {/* Transporte */}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3">
                <div className="flex items-center gap-1">
                  <Tooltip content="−30 s (Mayús+←)">
                    <Button variant="ghost" size="icon" icon={Rewind} onClick={() => wave.current?.skip(-30)} aria-label="Retroceder 30 segundos" />
                  </Tooltip>
                  <Tooltip content="−10 s (←)">
                    <Button variant="ghost" size="icon" icon={SkipBack} onClick={() => wave.current?.skip(-10)} aria-label="Retroceder 10 segundos" />
                  </Tooltip>
                  <button
                    type="button"
                    onClick={() => wave.current?.toggle()}
                    aria-label={playing ? 'Pausar' : 'Reproducir'}
                    className="focus-ring mx-1 grid h-11 w-11 place-items-center rounded-full bg-neutral-900 text-white shadow-sm transition-transform active:scale-95 dark:bg-white dark:text-neutral-900"
                  >
                    {playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" className="translate-x-px" />}
                  </button>
                  <Tooltip content="+10 s (→)">
                    <Button variant="ghost" size="icon" icon={SkipForward} onClick={() => wave.current?.skip(10)} aria-label="Adelantar 10 segundos" />
                  </Tooltip>
                  <Tooltip content="+30 s (Mayús+→)">
                    <Button variant="ghost" size="icon" icon={FastForward} onClick={() => wave.current?.skip(30)} aria-label="Adelantar 30 segundos" />
                  </Tooltip>
                </div>
                <p className="font-mono text-sm tabular-nums">
                  {formatTimecode(time)} <span className="text-neutral-400">/ {formatClock(duration)}</span>
                </p>
                <label className="ml-auto flex cursor-pointer items-center gap-2 text-[13px] text-neutral-600 dark:text-neutral-300">
                  <input type="checkbox" checked={skipCuts} onChange={(e) => setSkipCuts(e.target.checked)} className="h-4 w-4 accent-neutral-900 dark:accent-white" />
                  Saltar cortes al reproducir
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
                <Button size="sm" icon={Scissors} onClick={cutStart} disabled={exporting}>
                  Cortar inicio hasta aquí
                </Button>
                <Button size="sm" icon={Scissors} onClick={cutEnd} disabled={exporting}>
                  Cortar final desde aquí
                </Button>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button variant="ghost" size="icon-sm" icon={ZoomOut} onClick={() => zoomBy(-15)} aria-label="Alejar" disabled={zoomLevel <= 0} />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={zoomLevel}
                    onChange={(e) => setZoomLevel(Number(e.target.value))}
                    aria-label="Zoom"
                    className="w-24 accent-neutral-900 sm:w-32 dark:accent-white"
                  />
                  <Button variant="ghost" size="icon-sm" icon={ZoomIn} onClick={() => zoomBy(15)} aria-label="Acercar" disabled={zoomLevel >= 100} />
                </div>
              </div>
            </section>

            <p className="hidden flex-wrap items-center gap-1.5 text-xs text-neutral-400 sm:flex dark:text-neutral-500">
              Arrastra sobre la onda para marcar un corte · <Kbd>Espacio</Kbd> reproducir · <Kbd>←</Kbd> <Kbd>→</Kbd> 10 s (<Kbd>Mayús</Kbd> 30 s) · <Kbd>+</Kbd> <Kbd>−</Kbd> zoom · <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> deshacer
            </p>
          </div>

          {/* Panel lateral */}
          <aside className="space-y-4">
            <CurtainsPanel assets={items} introId={edit.introId} outroId={edit.outroId} onChange={(p) => change(p)} disabled={exporting} />
            <CutsPanel
              cuts={cuts}
              duration={duration}
              disabled={exporting}
              canUndo={history.current.length > 0}
              onUndo={undo}
              onUpdate={updateCut}
              onRemove={(cid) => setCuts(cuts.filter((c) => c.id !== cid))}
              onAddAtCursor={() => {
                const t = cursor()
                addCut(t, Math.min(duration, t + 10))
              }}
              onListen={(c) => wave.current?.playRange(c.start, c.end, { skip: false })}
              onPreview={(c) => wave.current?.playRange(Math.max(0, c.start - 3), Math.min(duration, c.end + 3), { skip: true })}
            />
            <Panel title="Exportar para Castbox">
              <div className="space-y-4">
                <PresetEditor preset={edit.preset} defaults={config.exportPreset} limits={config.presetLimits} onChange={(preset) => change({ preset })} disabled={exporting} />
                {exporting ? (
                  <div className="space-y-2" aria-live="polite">
                    <ProgressBar value={ep.progress?.percent ?? 0} shimmer={ep.progress?.stage === 'validating'} label="Exportación" />
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="text-neutral-600 dark:text-neutral-300">
                        {EXPORT_STAGE[ep.progress?.stage] ?? 'Exportando…'}
                        {ep.progress?.stage !== 'queued' && Number.isFinite(ep.progress?.percent) && <span className="tabular-nums"> {Math.floor(ep.progress.percent)} %</span>}
                      </span>
                      <Button variant="ghost" size="sm" icon={X} onClick={cancelExport}>
                        Cancelar
                      </Button>
                    </div>
                    <p className="text-[12px] text-neutral-500 dark:text-neutral-400">Unos 2–3 minutos por cada hora de audio. Puedes salir de esta pantalla.</p>
                  </div>
                ) : (
                  <Button variant="primary" className="w-full" icon={Download} onClick={doExport} loading={exportBusy} disabled={reEnhancing}>
                    {ep.export ? 'Exportar de nuevo' : 'Exportar MP3'}
                  </Button>
                )}
                {ep.status === 'error' && ep.error?.step === 'export' && (
                  <p role="alert" className="flex gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-[13px] text-red-700 dark:bg-red-500/10 dark:text-red-400">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
                    {ep.error.message}
                  </p>
                )}
                {ep.export && ep.files.final && !exporting && <ExportResult ep={ep} api={api} stale={stale} />}
              </div>
            </Panel>
          </aside>
        </div>
      )}
    </main>
  )
}
