import { useMemo, useRef, useState } from 'react'
import { Library, RefreshCw, Search, X, Youtube } from 'lucide-react'
import EpisodeRow from '../components/library/EpisodeRow.jsx'
import ConfirmModal from '../components/ConfirmModal.jsx'
import { JobSkeleton } from '../components/EmptyState.jsx'
import Button from '../components/ui/Button.jsx'
import Segmented from '../components/ui/Segmented.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { cn } from '../lib/cn.js'
import { FILTERS, normalizeText } from '../lib/episodes.js'
import { routeHref } from '../hooks/useRoute.js'

const PAGE = 30

/**
 * Biblioteca: todos los audios (streams del canal y subidas) en un solo lugar,
 * con su estado y la acción siguiente (descargar → mejorar → editar → exportar).
 */
export default function LibraryView({ api, library, jobs, now, workspace, canManage, onConnectChannel, onEnhance, onEdit }) {
  const toast = useToast()
  const { episodes, loaded, actions } = library
  const [filter, setFilter] = useState('all')
  const [source, setSource] = useState('all')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [syncing, setSyncing] = useState(false)
  const [confirm, setConfirm] = useState(null) // episodio a borrar
  const lastConfirm = useRef(null)
  if (confirm) lastConfirm.current = confirm
  const cf = confirm ?? lastConfirm.current

  const bySource = useMemo(() => episodes.filter((e) => source === 'all' || e.source === source), [episodes, source])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, bySource.filter(f.test).length])), [bySource])
  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.key === filter) ?? FILTERS[0]
    const q = normalizeText(query.trim())
    return bySource.filter(f.test).filter((e) => !q || normalizeText(e.title).includes(q))
  }, [bySource, filter, query])
  const hasYoutube = episodes.some((e) => e.source === 'youtube')
  const channel = workspace?.channel ?? null

  const sync = async () => {
    setSyncing(true)
    try {
      const r = await actions.sync({ full: true })
      toast({
        tone: 'success',
        title: r.added ? `${r.added} ${r.added === 1 ? 'stream nuevo' : 'streams nuevos'}` : 'La biblioteca está al día',
        description: `${r.total} streams en el canal${r.updated ? ` · ${r.updated} actualizados` : ''}.`,
      })
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo sincronizar', description: e.message, duration: 10000 })
    } finally {
      setSyncing(false)
    }
  }

  const onAction = async (kind, ep) => {
    try {
      if (kind === 'download') {
        await actions.download(ep.id)
      } else if (kind === 'retry') {
        await actions.retry(ep.id)
        toast({ title: 'Reintentando', description: ep.title })
      } else if (kind === 'cancel') {
        await actions.cancel(ep.id)
      } else if (kind === 'delete') {
        setConfirm(ep)
      }
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo completar', description: e.message })
    }
  }

  const doDelete = async () => {
    try {
      await actions.remove(confirm.id)
      toast({ title: confirm.source === 'youtube' ? 'Audios borrados' : 'Eliminado', description: confirm.title })
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo eliminar', description: e.message })
      throw e
    }
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Biblioteca</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {channel ? (
              <>
                Los directos de <span className="font-medium text-neutral-700 dark:text-neutral-300">{channel.title ?? channel.handle}</span> y los audios
                subidos{workspace?.name ? ` a «${workspace.name}»` : ''}.
              </>
            ) : (
              <>Los audios de «{workspace?.name}». Conecta su canal de YouTube para traer sus directos.</>
            )}
          </p>
        </div>
        {channel ? (
          <Button icon={RefreshCw} onClick={sync} loading={syncing} className={cn(syncing && '[&_svg]:animate-spin')}>
            {syncing ? 'Sincronizando…' : 'Sincronizar con YouTube'}
          </Button>
        ) : (
          canManage && (
            <Button icon={Youtube} onClick={onConnectChannel}>
              Conectar canal de YouTube
            </Button>
          )
        )}
      </div>

      {/* Búsqueda y filtros */}
      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative block flex-1">
            <span className="sr-only">Buscar por título</span>
            <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setLimit(PAGE)
              }}
              placeholder="Buscar por título"
              className="focus-ring h-10 w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-9 text-sm placeholder:text-neutral-400 dark:border-neutral-800 dark:bg-neutral-900"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Borrar búsqueda"
                className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
              >
                <X size={15} />
              </button>
            )}
          </label>
          <Segmented
            size="sm"
            label="Origen"
            className="h-10 sm:w-64"
            value={source}
            onChange={(v) => {
              setSource(v)
              setLimit(PAGE)
            }}
            options={[
              { value: 'all', label: 'Todo' },
              { value: 'youtube', label: 'YouTube' },
              { value: 'upload', label: 'Subidos' },
            ]}
          />
        </div>
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="radiogroup" aria-label="Filtrar por estado">
          {FILTERS.filter((f) => f.key !== 'error' || counts.error > 0).map((f) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  setFilter(f.key)
                  setLimit(PAGE)
                }}
                className={cn(
                  'focus-ring inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors',
                  active
                    ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
                    : 'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:border-neutral-700',
                  f.key === 'error' && !active && 'text-red-600 dark:text-red-400',
                )}
              >
                {f.label}
                <span className={cn('tabular-nums', active ? 'opacity-70' : 'text-neutral-400')}>{counts[f.key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Lista */}
      <section aria-label="Episodios" className="space-y-3">
        {!loaded ? (
          <>
            <JobSkeleton />
            <JobSkeleton />
          </>
        ) : !channel && (episodes.length === 0 || source === 'youtube') ? (
          <div className="card flex flex-col items-center gap-4 px-6 py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-neutral-100 dark:bg-neutral-800">
              <Youtube size={24} aria-hidden />
            </span>
            <div className="max-w-sm">
              <p className="font-semibold tracking-tight">Conecta el canal de «{workspace?.name}»</p>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Pega el enlace del canal de YouTube y la Biblioteca traerá sus directos. Nada se descarga hasta que tú lo pidas.
              </p>
            </div>
            {canManage ? (
              <Button variant="primary" icon={Youtube} onClick={onConnectChannel}>
                Conectar canal
              </Button>
            ) : (
              <p className="text-[13px] text-neutral-500 dark:text-neutral-400">Pídele a quien administra la app que conecte el canal.</p>
            )}
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
              ¿Tienes el audio en tu computadora? <a href={routeHref.enhance} className="font-medium text-neutral-800 underline-offset-2 hover:underline dark:text-neutral-200">Súbelo desde Mejorar</a>.
            </p>
          </div>
        ) : episodes.length === 0 || (!hasYoutube && source === 'youtube') ? (
          <div className="card flex flex-col items-center gap-4 px-6 py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-neutral-100 dark:bg-neutral-800">
              <Youtube size={24} aria-hidden />
            </span>
            <div className="max-w-sm">
              <p className="font-semibold tracking-tight">Trae los directos de tu canal</p>
              <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                Sincroniza para ver aquí todos los streams de YouTube. Nada se descarga hasta que tú lo pidas.
              </p>
            </div>
            <Button variant="primary" icon={RefreshCw} onClick={sync} loading={syncing}>
              Sincronizar con YouTube
            </Button>
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
              ¿Tienes el audio en tu computadora? <a href={routeHref.enhance} className="font-medium text-neutral-800 underline-offset-2 hover:underline dark:text-neutral-200">Súbelo desde Mejorar</a>.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
            <Library size={20} aria-hidden />
            {query ? `Nada coincide con «${query}».` : 'No hay episodios en este filtro.'}
          </div>
        ) : (
          <>
            {visible.slice(0, limit).map((ep) => (
              <EpisodeRow key={ep.id} ep={ep} jobs={jobs} api={api} now={now} onAction={onAction} onEnhance={onEnhance} onEdit={onEdit} />
            ))}
            {visible.length > limit && (
              <div className="flex justify-center pt-1">
                <Button onClick={() => setLimit((l) => l + PAGE)}>
                  Mostrar más <span className="tabular-nums text-neutral-400">({visible.length - limit})</span>
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      <ConfirmModal
        open={!!confirm}
        danger
        title={cf?.source === 'youtube' ? '¿Borrar los audios de este episodio?' : '¿Eliminar de la biblioteca?'}
        description={
          cf?.source === 'youtube'
            ? `Se borran el audio descargado, el mejorado, la edición y el MP3 exportado de «${cf?.title}». El stream sigue en la lista y lo puedes volver a descargar.`
            : `Se borra «${cf?.title}» de la biblioteca, con su edición y su MP3 exportado. Tu archivo original no se toca.`
        }
        confirmLabel={cf?.source === 'youtube' ? 'Borrar audios' : 'Eliminar'}
        onConfirm={doDelete}
        onClose={() => setConfirm(null)}
      />
    </main>
  )
}
