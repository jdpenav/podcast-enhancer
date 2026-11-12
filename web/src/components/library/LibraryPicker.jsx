import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, FileAudio, Search, Sparkles, Upload, Youtube } from 'lucide-react'
import Modal from '../ui/Modal.jsx'
import { formatClock, formatDate } from '../../lib/format.js'
import { liveJob, normalizeText } from '../../lib/episodes.js'
import { routeHref } from '../../hooks/useRoute.js'

/** Elegir un audio de la biblioteca (ya descargado o subido) para mejorarlo. */
export default function LibraryPicker({ open, episodes, loaded, jobs, onPick, onClose }) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const available = useMemo(() => {
    const q = normalizeText(query.trim())
    return episodes.filter((ep) => {
      if (!ep.files.source) return false
      const job = liveJob(ep, jobs)
      if (job && ['pending', 'processing', 'paused'].includes(job.status)) return false
      if (['downloading', 'exporting'].includes(ep.status)) return false
      return !q || normalizeText(ep.title).includes(q)
    })
  }, [episodes, jobs, query])

  return (
    <Modal open={open} onClose={onClose} title="Elegir de la biblioteca" description="Audios ya descargados de YouTube o subidos antes." size="lg">
      <label className="relative mb-3 block">
        <span className="sr-only">Buscar</span>
        <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden />
        <input
          data-autofocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por título"
          className="focus-ring h-10 w-full rounded-xl border border-neutral-200 bg-white pl-10 pr-3 text-sm placeholder:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900"
        />
      </label>

      {!loaded ? (
        <p className="py-8 text-center text-sm text-neutral-500">Cargando…</p>
      ) : available.length === 0 ? (
        <div className="py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          <FileAudio size={20} className="mx-auto mb-2" aria-hidden />
          {query ? 'Nada coincide con la búsqueda.' : 'Todavía no hay audios descargados.'}
          <p className="mt-1">
            <a href={routeHref.library} onClick={onClose} className="font-medium text-neutral-800 underline-offset-2 hover:underline dark:text-neutral-200">
              Ir a la Biblioteca
            </a>{' '}
            para descargar un directo del canal.
          </p>
        </div>
      ) : (
        <ul className="-mx-2 max-h-[55dvh] space-y-0.5 overflow-y-auto pb-1">
          {available.map((ep) => (
            <li key={ep.id}>
              <button
                type="button"
                onClick={() => onPick(ep)}
                className="focus-ring group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                {ep.thumbnailUrl ? (
                  <img src={ep.thumbnailUrl} alt="" loading="lazy" className="aspect-video w-20 shrink-0 rounded-md object-cover" />
                ) : (
                  <span className="grid aspect-video w-20 shrink-0 place-items-center rounded-md bg-neutral-100 text-neutral-400 dark:bg-neutral-800">
                    <FileAudio size={18} aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm font-medium">{ep.title}</span>
                  <span className="flex flex-wrap items-center gap-x-1.5 text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
                    {ep.source === 'youtube' ? <Youtube size={12} aria-hidden /> : <Upload size={12} aria-hidden />}
                    {formatDate(ep.publishedAt, { short: true })}
                    {Number.isFinite(ep.durationSec) && <> · {formatClock(ep.durationSec)}</>}
                    {ep.files.enhanced && (
                      <span className="inline-flex items-center gap-1">
                        · <Sparkles size={12} aria-hidden /> ya mejorado
                      </span>
                    )}
                  </span>
                </span>
                <ChevronRight size={16} className="shrink-0 text-neutral-300 transition-transform group-hover:translate-x-0.5 dark:text-neutral-600" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}
