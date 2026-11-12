import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Header from './components/Header.jsx'
import DropOverlay from './components/DropOverlay.jsx'
import ConfigModal from './components/ConfigModal.jsx'
import ResultModal from './components/ResultModal.jsx'
import LibraryPicker from './components/library/LibraryPicker.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import EnhanceView from './views/EnhanceView.jsx'
import LibraryView from './views/LibraryView.jsx'
import EditorView from './views/EditorView.jsx'
import SettingsView from './views/SettingsView.jsx'
import { useToast } from './components/ui/Toast.jsx'
import { useApi } from './hooks/useApi.js'
import { useConfig } from './hooks/useConfig.js'
import { useJobs } from './hooks/useJobs.js'
import { useEpisodes } from './hooks/useEpisodes.js'
import { useNotify } from './hooks/useNotify.js'
import { useWindowDrop } from './hooks/useWindowDrop.js'
import { useNow } from './hooks/useNow.js'
import { navigate, routeHref, useRoute } from './hooks/useRoute.js'
import { getAudioDuration } from './lib/audio.js'
import { baseName, extOf, formatTimeOfDay } from './lib/format.js'
import { counts as countJobs, queueSec } from './lib/jobs.js'

/**
 * Armazón de la app: datos en vivo (trabajos + biblioteca), cabecera con navegación,
 * la vista según la ruta y los modales compartidos (procesar audio, escuchar resultado).
 */
export default function App() {
  const loaded = useApi()
  const api = loaded?.api ?? null
  const config = useConfig(api)
  const toast = useToast()
  const { notify, requestPermission } = useNotify()
  const now = useNow(15000)
  const route = useRoute()

  const [resultId, setResultId] = useState(null)
  // Audio a procesar: { file, durationSec } (subida) o { episode } (de la biblioteca)
  const [pending, setPending] = useState(null)
  const [picking, setPicking] = useState(false)
  const [unseenDone, setUnseenDone] = useState(false)

  const editEpisode = useCallback((id) => navigate(routeHref.editor(id)), [])

  // Avisos cuando un trabajo cambia de estado (llega por SSE)
  const onJobTransition = useCallback(
    (job, prev) => {
      if (job.status === 'done') {
        const open = () => setResultId(job.id)
        toast({
          tone: 'success',
          title: 'Listo para descargar',
          description: job.filename,
          action: { label: 'Escuchar', onClick: open },
          duration: 12000,
        })
        notify('✓ Audio listo', { body: `${job.filename} ya se puede escuchar, editar y descargar.`, tag: job.id, onClick: open })
        if (document.hidden) setUnseenDone(true)
      } else if (job.status === 'error' && prev !== 'error') {
        toast({ tone: 'error', title: 'Hubo un problema', description: job.error?.message ?? job.filename, duration: 8000 })
        notify('Error al procesar', { body: job.filename, tag: job.id })
      }
    },
    [toast, notify],
  )

  // Avisos de la biblioteca (descargas y exportaciones)
  const onEpisodeTransition = useCallback(
    (ep, prev) => {
      if (prev === 'downloading' && ep.status === 'downloaded') {
        toast({ tone: 'success', title: 'Audio descargado', description: ep.title, action: { label: 'Mejorar', onClick: () => setPending({ episode: ep }) }, duration: 10000 })
      } else if (prev === 'downloading' && ep.status === 'youtube_processing' && ep.retry?.attempts === 1) {
        toast({
          title: 'YouTube todavía procesa este stream',
          description: `Lo descargaremos solos en cuanto esté listo. Próximo intento a las ${formatTimeOfDay(new Date(ep.retry.nextAt))}.`,
          duration: 10000,
        })
      } else if (prev === 'exporting' && ep.status === 'ready') {
        toast({ tone: 'success', title: 'Listo para Castbox', description: ep.title, action: { label: 'Abrir', onClick: () => editEpisode(ep.id) }, duration: 12000 })
        notify('✓ Episodio exportado', { body: `${ep.title} está listo para subir a Castbox.`, tag: ep.id, onClick: () => editEpisode(ep.id) })
      } else if (ep.status === 'error' && prev !== 'error' && ep.error?.step !== 'enhance') {
        toast({ tone: 'error', title: ep.error?.step === 'export' ? 'No se pudo exportar' : 'No se pudo descargar', description: ep.error?.message ?? ep.title, duration: 10000 })
      }
    },
    [toast, notify, editEpisode],
  )

  const { jobs, loaded: jobsLoaded, health, connected, actions } = useJobs(api, { onTransition: onJobTransition })
  const library = useEpisodes(api, { onTransition: onEpisodeTransition })
  const c = useMemo(() => countJobs(jobs), [jobs])
  const waitSec = useMemo(() => queueSec(jobs), [jobs])
  const resultJob = jobs.find((j) => j.id === resultId && j.status === 'done') ?? null

  // --- Elegir / soltar archivos ---
  const pickFiles = useCallback(
    async (files) => {
      if (!config) return toast({ title: 'Un momento…', description: 'Cargando la configuración.' })
      if (pending) return
      const [file] = files
      if (files.length > 1) toast({ title: 'Se procesará solo el primero', description: 'Suelta los demás audios uno por uno.' })
      if (!config.acceptedTypes.includes(extOf(file.name))) {
        return toast({
          tone: 'error',
          title: 'Formato no soportado',
          description: `Usa ${config.acceptedTypes.map((t) => t.slice(1).toUpperCase()).join(', ')}.`,
        })
      }
      if (file.size > config.maxUploadMB * 1024 * 1024) {
        return toast({
          tone: 'error',
          title: 'Archivo demasiado grande',
          description:
            config.role === 'guest'
              ? `Por internet el máximo es ${config.maxUploadMB} MB. Sube el MP3 (1 h de audio pesa 30–80 MB).`
              : `El máximo es ${config.maxUploadMB} MB.`,
        })
      }
      setPending({ file, durationSec: undefined })
      const durationSec = await getAudioDuration(file)
      setPending((p) => (p?.file === file ? { ...p, durationSec } : p))
    },
    [config, pending, toast],
  )
  // Soltar archivos solo en la pantalla de inicio (en el editor/ajustes confundiría)
  const dragging = useWindowDrop(pickFiles, !!api && !pending && route.name === 'enhance')

  const submit = async (choice, opts) => {
    requestPermission() // gesto del usuario: buen momento para pedir permiso de avisos
    if (pending.episode) {
      const job = await api.createJobFromEpisode(pending.episode.id, choice)
      actions.added(job)
      toast({ tone: 'info', title: 'Añadido a la cola', description: pending.episode.title, action: route.name !== 'enhance' ? { label: 'Ver', onClick: () => navigate(routeHref.enhance) } : undefined })
    } else {
      const job = await api.createJob(pending.file, choice, opts)
      actions.added(job)
      toast({ tone: 'info', title: 'Añadido a la cola', description: job.filename })
    }
    setPending(null)
  }

  // Enlace directo al reproductor: #escuchar=<id>
  useEffect(() => {
    if (!jobsLoaded) return
    const m = window.location.hash.match(/escuchar=([\w-]+)/)
    if (m) setResultId(m[1])
  }, [jobsLoaded])

  // Solo en modo demo: ?preview=config abre el modal de configuración con un archivo ficticio
  useEffect(() => {
    if (!loaded?.mock || !config) return
    if (new URLSearchParams(window.location.search).get('preview') === 'config') {
      setPending({ file: new File([new Uint8Array(1024)], 'Podcast - Episodio 12.mp3', { type: 'audio/mpeg' }), durationSec: 3395.03 })
    }
  }, [loaded?.mock, config])

  // --- Título de la pestaña: progreso o "listo" ---
  const processing = jobs.find((j) => j.status === 'processing')
  useEffect(() => {
    if (unseenDone) document.title = '✓ Listo · Enhance'
    else if (processing) {
      const st = processing.progress?.stage
      const pct = st === 'merging' ? 'Casi listo' : `${Math.floor(processing.progress?.percent ?? 0)} %`
      document.title = `${pct} · ${baseName(processing.filename)} — Enhance`
    } else document.title = 'Enhance'
  }, [unseenDone, processing?.progress?.percent, processing?.progress?.stage, processing?.filename]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onVisible = () => !document.hidden && setUnseenDone(false)
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  // Conservar el contenido de los modales durante su animación de salida
  const lastPending = useRef(null)
  if (pending) lastPending.current = pending
  const shownPending = pending ?? lastPending.current

  const libraryActive = library.episodes.filter((e) => ['downloading', 'exporting', 'youtube_processing'].includes(e.status)).length

  return (
    <div className="min-h-dvh">
      <Header health={health} connected={connected} mock={loaded?.mock} queued={c.pending} route={route} libraryActive={libraryActive} />
      <OfflineBanner visible={connected === false && !loaded?.mock} />

      {route.name === 'enhance' && (
        <EnhanceView
          api={api}
          config={config}
          jobs={jobs}
          jobsLoaded={jobsLoaded}
          counts={c}
          waitSec={waitSec}
          health={health}
          now={now}
          actions={actions}
          onFiles={pickFiles}
          onPickLibrary={() => setPicking(true)}
          onListen={(j) => setResultId(j.id)}
          onEdit={(j) => editEpisode(j.episodeId)}
        />
      )}
      {route.name === 'library' && (
        <LibraryView
          api={api}
          config={config}
          library={library}
          jobs={jobs}
          now={now}
          onEnhance={(episode) => setPending({ episode })}
          onEdit={(ep) => editEpisode(ep.id)}
        />
      )}
      {route.name === 'editor' && (
        <EditorView
          key={route.id}
          api={api}
          config={config}
          id={route.id}
          library={library}
          jobs={jobs}
          now={now}
          mock={loaded?.mock}
          onEnhance={(episode) => setPending({ episode })}
        />
      )}
      {route.name === 'settings' && <SettingsView api={api} config={config} mock={loaded?.mock} />}

      <DropOverlay visible={dragging} />

      <LibraryPicker
        open={picking}
        episodes={library.episodes}
        loaded={library.loaded}
        jobs={jobs}
        onPick={(episode) => {
          setPicking(false)
          setPending({ episode })
        }}
        onClose={() => setPicking(false)}
      />

      <ConfigModal
        open={!!pending}
        file={shownPending?.file}
        episode={shownPending?.episode}
        durationSec={shownPending?.episode ? shownPending.episode.durationSec : shownPending?.durationSec}
        config={config}
        waitSec={waitSec}
        aheadCount={c.pending + c.processing}
        onSubmit={submit}
        onClose={() => setPending(null)}
      />

      {api && <ResultModal job={resultJob} api={api} mock={loaded?.mock} onClose={() => setResultId(null)} onEdit={(j) => { setResultId(null); editEpisode(j.episodeId) }} />}
    </div>
  )
}
