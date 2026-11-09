import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Header from './components/Header.jsx'
import UploadCard from './components/UploadCard.jsx'
import DropOverlay from './components/DropOverlay.jsx'
import ConfigModal from './components/ConfigModal.jsx'
import JobCard from './components/JobCard.jsx'
import ResultModal from './components/ResultModal.jsx'
import ConfirmModal from './components/ConfirmModal.jsx'
import Sidebar from './components/Sidebar.jsx'
import OfflineBanner from './components/OfflineBanner.jsx'
import EmptyState, { JobSkeleton } from './components/EmptyState.jsx'
import Segmented from './components/ui/Segmented.jsx'
import { useToast } from './components/ui/Toast.jsx'
import { useApi } from './hooks/useApi.js'
import { useConfig } from './hooks/useConfig.js'
import { useJobs } from './hooks/useJobs.js'
import { useNotify } from './hooks/useNotify.js'
import { useWindowDrop } from './hooks/useWindowDrop.js'
import { useNow } from './hooks/useNow.js'
import { getAudioDuration } from './lib/audio.js'
import { baseName, extOf } from './lib/format.js'
import { counts as countJobs, finishInSec, jobsAhead, queueSec } from './lib/jobs.js'

const FILTERS = {
  all: () => true,
  active: (j) => ['pending', 'processing', 'paused', 'error'].includes(j.status),
  done: (j) => j.status === 'done',
}

export default function App() {
  const loaded = useApi()
  const api = loaded?.api ?? null
  const config = useConfig(api)
  const toast = useToast()
  const { notify, requestPermission } = useNotify()
  const now = useNow(15000)

  const [resultId, setResultId] = useState(null)
  const [pending, setPending] = useState(null) // { file, durationSec }
  const [confirm, setConfirm] = useState(null) // { kind, job }
  const [filter, setFilter] = useState('all')
  const [unseenDone, setUnseenDone] = useState(false)

  // Avisos cuando un trabajo cambia de estado (llega por SSE)
  const onTransition = useCallback(
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
        notify('✓ Audio listo', { body: `${job.filename} ya se puede escuchar y descargar.`, tag: job.id, onClick: open })
        if (document.hidden) setUnseenDone(true)
      } else if (job.status === 'error' && prev !== 'error') {
        toast({ tone: 'error', title: 'Hubo un problema', description: job.error?.message ?? job.filename, duration: 8000 })
        notify('Error al procesar', { body: job.filename, tag: job.id })
      }
    },
    [toast, notify],
  )

  const { jobs, loaded: jobsLoaded, health, connected, actions } = useJobs(api, { onTransition })
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
  const dragging = useWindowDrop(pickFiles, !!api && !pending)

  const submit = async (choice, opts) => {
    requestPermission() // gesto del usuario: buen momento para pedir permiso de avisos
    const job = await api.createJob(pending.file, choice, opts)
    actions.added(job)
    toast({ tone: 'info', title: 'Añadido a la cola', description: job.filename })
    setPending(null)
  }

  // --- Acciones de las tarjetas ---
  const onAction = async (kind, job) => {
    try {
      if (kind === 'pause') {
        await actions.pause(job.id)
        toast({ title: 'Pausado', description: 'El avance quedó guardado. Reanuda cuando quieras.' })
      } else if (kind === 'resume') {
        await actions.resume(job.id)
        toast({ title: job.status === 'error' ? 'Reintentando' : 'Reanudado', description: 'Seguirá donde quedó.' })
      } else if (kind === 'cancel') {
        // Pedir confirmación si hay avance que se perdería
        if (job.progress?.percent > 0 || job.status === 'processing') setConfirm({ kind: 'cancel', job })
        else await doCancel(job)
      } else if (kind === 'delete') {
        setConfirm({ kind: 'delete', job })
      }
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo completar', description: e.message })
    }
  }

  const doCancel = async (job) => {
    await actions.cancel(job.id)
    toast({ title: 'Cancelado', description: job.filename })
  }

  const doConfirm = async () => {
    const { kind, job } = confirm
    try {
      if (kind === 'cancel') await doCancel(job)
      else {
        await actions.remove(job.id)
        toast({ title: 'Eliminado', description: job.filename })
      }
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo completar', description: e.message })
      throw e
    }
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

  const visibleJobs = jobs.filter(FILTERS[filter])
  const showFilter = jobs.length >= 4

  // Conservar el contenido de los modales durante su animación de salida
  const lastPending = useRef(null)
  if (pending) lastPending.current = pending
  const lastConfirm = useRef(null)
  if (confirm) lastConfirm.current = confirm
  const cf = confirm ?? lastConfirm.current

  return (
    <div className="min-h-dvh">
      <Header health={health} connected={connected} mock={loaded?.mock} queued={c.pending} />
      <OfflineBanner visible={connected === false && !loaded?.mock} />

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <UploadCard config={config} onFiles={pickFiles} />

          <section aria-labelledby="jobs-title" className="space-y-3">
            <div className="flex min-h-9 items-center justify-between gap-3">
              <h2 id="jobs-title" className="text-sm font-semibold">
                Trabajos {jobs.length > 0 && <span className="font-normal text-neutral-400">· {jobs.length}</span>}
              </h2>
              {showFilter && (
                <Segmented
                  size="sm"
                  label="Filtrar trabajos"
                  className="w-56"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'Todos' },
                    { value: 'active', label: 'Activos' },
                    { value: 'done', label: 'Listos' },
                  ]}
                />
              )}
            </div>

            {!jobsLoaded ? (
              <>
                <JobSkeleton />
                <JobSkeleton />
              </>
            ) : jobs.length === 0 ? (
              <EmptyState />
            ) : visibleJobs.length === 0 ? (
              <p className="card px-6 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">No hay trabajos en este filtro.</p>
            ) : (
              visibleJobs.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  api={api}
                  now={now}
                  queue={job.status === 'pending' ? { ahead: jobsAhead(jobs, job), finishSec: finishInSec(jobs, job) } : null}
                  onAction={onAction}
                  onListen={(j) => setResultId(j.id)}
                  showGuest={config?.role === 'owner'}
                />
              ))
            )}
          </section>
        </div>

        <Sidebar counts={c} waitSec={waitSec} health={health} config={config} now={now} />
      </main>

      <DropOverlay visible={dragging} />

      <ConfigModal
        open={!!pending}
        file={(pending ?? lastPending.current)?.file}
        durationSec={(pending ?? lastPending.current)?.durationSec}
        config={config}
        waitSec={waitSec}
        aheadCount={c.pending + c.processing}
        onSubmit={submit}
        onClose={() => setPending(null)}
      />

      {api && <ResultModal job={resultJob} api={api} mock={loaded?.mock} onClose={() => setResultId(null)} />}

      <ConfirmModal
        open={!!confirm}
        danger
        title={cf?.kind === 'delete' ? '¿Eliminar este trabajo?' : '¿Cancelar el proceso?'}
        description={
          cf?.kind === 'delete'
            ? 'Se borran la copia subida y los resultados. Tu archivo original en el escritorio no se toca.'
            : `Se perderá el avance de «${cf?.job.filename}». Si solo quieres detenerlo un rato, usa Pausar.`
        }
        confirmLabel={cf?.kind === 'delete' ? 'Eliminar' : 'Cancelar proceso'}
        onConfirm={doConfirm}
        onClose={() => setConfirm(null)}
      />
    </div>
  )
}
