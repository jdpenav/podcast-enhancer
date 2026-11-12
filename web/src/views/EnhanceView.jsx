import { useRef, useState } from 'react'
import UploadCard from '../components/UploadCard.jsx'
import JobCard from '../components/JobCard.jsx'
import ConfirmModal from '../components/ConfirmModal.jsx'
import Sidebar from '../components/Sidebar.jsx'
import EmptyState, { JobSkeleton } from '../components/EmptyState.jsx'
import Segmented from '../components/ui/Segmented.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { finishInSec, jobsAhead } from '../lib/jobs.js'

const FILTERS = {
  all: () => true,
  active: (j) => ['pending', 'processing', 'paused', 'error'].includes(j.status),
  done: (j) => j.status === 'done',
}

/**
 * Pantalla de inicio: subir un audio (o elegirlo de la biblioteca), la cola de trabajos de la GPU
 * y el resumen. Es el dashboard original, sin cambios de comportamiento.
 */
export default function EnhanceView({ api, config, jobs, allJobs = jobs, othersQueued = 0, jobsLoaded, counts, waitSec, health, now, actions, onFiles, onPickLibrary, onListen, onEdit }) {
  const toast = useToast()
  const [confirm, setConfirm] = useState(null) // { kind, job }
  const [filter, setFilter] = useState('all')

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

  const visibleJobs = jobs.filter(FILTERS[filter])
  const showFilter = jobs.length >= 4

  // Conservar el contenido del modal durante su animación de salida
  const lastConfirm = useRef(null)
  if (confirm) lastConfirm.current = confirm
  const cf = confirm ?? lastConfirm.current

  return (
    <>
      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <UploadCard config={config} onFiles={onFiles} onPickLibrary={onPickLibrary} />

          <section aria-labelledby="jobs-title" className="space-y-3">
            <div className="flex min-h-9 items-center justify-between gap-3">
              <h2 id="jobs-title" className="text-sm font-semibold">
                Trabajos {jobs.length > 0 && <span className="font-normal text-neutral-400">· {jobs.length}</span>}
                {othersQueued > 0 && (
                  <span className="ml-2 font-normal text-neutral-500 dark:text-neutral-400" title="La GPU es una sola: estos trabajos van antes o después de los tuyos">
                    +{othersQueued} de otros espacios en la cola
                  </span>
                )}
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
                  queue={job.status === 'pending' ? { ahead: jobsAhead(allJobs, job), finishSec: finishInSec(allJobs, job) } : null}
                  onAction={onAction}
                  onListen={onListen}
                  onEdit={onEdit}
                  showGuest={config?.role === 'owner'}
                />
              ))
            )}
          </section>
        </div>

        <Sidebar counts={counts} waitSec={waitSec} health={health} config={config} now={now} />
      </main>

      <ConfirmModal
        open={!!confirm}
        danger
        title={cf?.kind === 'delete' ? '¿Eliminar este trabajo?' : '¿Cancelar el proceso?'}
        description={
          cf?.kind === 'delete'
            ? cf?.job.episodeId
              ? 'Se borran la copia y los resultados de este trabajo. El audio sigue en la Biblioteca y tu archivo original en el escritorio no se toca.'
              : 'Se borran la copia subida y los resultados. Tu archivo original en el escritorio no se toca.'
            : `Se perderá el avance de «${cf?.job.filename}». Si solo quieres detenerlo un rato, usa Pausar.`
        }
        confirmLabel={cf?.kind === 'delete' ? 'Eliminar' : 'Cancelar proceso'}
        onConfirm={doConfirm}
        onClose={() => setConfirm(null)}
      />
    </>
  )
}
