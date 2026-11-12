import { useState } from 'react'
import {
  AlertCircle, Download, ExternalLink, FileAudio, Hourglass, MoreHorizontal, RotateCcw, Scissors, Sparkles,
  Trash2, Upload, X, Youtube,
} from 'lucide-react'
import Badge from '../ui/Badge.jsx'
import Button from '../ui/Button.jsx'
import Menu from '../ui/Menu.jsx'
import ProgressBar from '../ui/ProgressBar.jsx'
import { cn } from '../../lib/cn.js'
import { DOWNLOAD_STAGE, EXPORT_STAGE, liveJob, statusMeta } from '../../lib/episodes.js'
import { formatBytes, formatClock, formatDate, formatEta, formatSpeed, formatTimeOfDay, modeShortLabel } from '../../lib/format.js'
import { routeHref } from '../../hooks/useRoute.js'

function Thumb({ ep }) {
  const [broken, setBroken] = useState(false)
  if (ep.thumbnailUrl && !broken) {
    return (
      <img
        src={ep.thumbnailUrl}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="aspect-video w-24 shrink-0 self-start rounded-lg bg-neutral-100 object-cover sm:w-32 dark:bg-neutral-800"
      />
    )
  }
  return (
    <span className="grid aspect-video w-24 shrink-0 self-start place-items-center rounded-lg bg-neutral-100 text-neutral-400 sm:w-32 dark:bg-neutral-800 dark:text-neutral-500">
      <FileAudio size={22} aria-hidden />
    </span>
  )
}

const hasBody = (ep, job) =>
  ['downloading', 'youtube_processing', 'exporting', 'error'].includes(ep.status) ||
  (ep.status === 'enhancing' && !!job) ||
  (ep.status === 'ready' && !!ep.export)

/** Cuerpo según el estado: progreso, espera de YouTube o error. */
function StatusBody({ ep, job, now }) {
  const p = ep.progress
  if (ep.status === 'downloading') {
    const known = Number.isFinite(p?.percent)
    return (
      <div className="space-y-1.5">
        <ProgressBar value={p?.percent ?? 0} indeterminate={!known} size="sm" label="Descarga" />
        <p className="flex flex-wrap justify-between gap-x-3 text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
          <span>{DOWNLOAD_STAGE[p?.stage] ?? 'Descargando…'}{known ? ` ${Math.floor(p.percent)} %` : ''}</span>
          {p?.stage === 'downloading' && (
            <span>
              {[p.totalBytes ? `${formatBytes(p.downloadedBytes)} de ${formatBytes(p.totalBytes)}` : '', formatSpeed(p.speedBps)].filter(Boolean).join(' · ')}
            </span>
          )}
        </p>
      </div>
    )
  }
  if (ep.status === 'youtube_processing') {
    const r = ep.retry
    return (
      <div className="flex gap-2.5 rounded-xl bg-neutral-100 p-3 text-[13px] text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300">
        <Hourglass size={15} className="mt-0.5 shrink-0" aria-hidden />
        <p>
          YouTube todavía está procesando este stream. Reintentando automáticamente
          {r?.nextAt && (
            <>
              {' '}— próximo intento a las <strong className="font-semibold tabular-nums">{formatTimeOfDay(new Date(r.nextAt))}</strong>
            </>
          )}
          .
          {r?.attempts > 1 && <span className="text-neutral-500 dark:text-neutral-400"> {r.attempts} intentos.</span>}
        </p>
      </div>
    )
  }
  if (ep.status === 'enhancing' && job) {
    const stage = job.stage ?? job.progress?.stage
    const pct = job.percent ?? job.progress?.percent ?? 0
    const eta = job.progress?.etaSec
    return (
      <div className="space-y-1.5">
        {job.status === 'processing' && stage === 'decoding' ? (
          <ProgressBar indeterminate size="sm" label="Mejora" />
        ) : (
          <ProgressBar value={stage === 'merging' ? 100 : pct} tone={job.status === 'processing' ? 'default' : 'muted'} shimmer={stage === 'merging'} size="sm" label="Mejora" />
        )}
        <p className="text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {job.status === 'pending' && 'En la cola de la GPU'}
          {job.status === 'paused' && `Pausado en ${Math.floor(pct)} %`}
          {job.status === 'processing' && (stage === 'merging' ? 'Uniendo y exportando… casi listo' : stage === 'decoding' ? 'Preparando el audio…' : `${Math.floor(pct)} %${Number.isFinite(eta) ? ` · ${formatEta(eta)}` : ''}`)}
          {' · '}
          <a href={routeHref.enhance} className="font-medium text-neutral-700 underline-offset-2 hover:underline dark:text-neutral-300">
            Ver en la cola
          </a>
        </p>
      </div>
    )
  }
  if (ep.status === 'exporting') {
    return (
      <div className="space-y-1.5">
        <ProgressBar value={p?.percent ?? 0} size="sm" label="Exportación" shimmer={p?.stage === 'validating'} />
        <p className="text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
          {EXPORT_STAGE[p?.stage] ?? 'Exportando…'} {Number.isFinite(p?.percent) && p.stage !== 'queued' ? `${Math.floor(p.percent)} %` : ''}
        </p>
      </div>
    )
  }
  if (ep.status === 'error') {
    return (
      <div className="flex gap-2.5 rounded-xl bg-red-50 p-3 text-[13px] text-red-700 dark:bg-red-500/10 dark:text-red-400" role="alert">
        <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
        <p>{ep.error?.message ?? 'Ocurrió un error inesperado.'}</p>
      </div>
    )
  }
  if (ep.status === 'ready' && ep.export) {
    return (
      <p className="text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
        MP3 {formatClock(ep.export.durationSec)} · {formatBytes(ep.export.sizeBytes)} · {ep.export.lufs ?? '—'} LUFS
      </p>
    )
  }
  return null
}

/**
 * Un episodio de la biblioteca con la acción que toca según su estado.
 * onAction(kind, ep): 'download' | 'retry' | 'cancel' | 'delete'
 */
export default function EpisodeRow({ ep, jobs, api, now, onAction, onEnhance, onEdit }) {
  const [busy, setBusy] = useState(null)
  const job = liveJob(ep, jobs)
  const s = statusMeta(ep, job)
  const jobActive = job && ['pending', 'processing', 'paused'].includes(job.status)

  const run = async (kind) => {
    setBusy(kind)
    try {
      await onAction(kind, ep)
    } finally {
      setBusy(null)
    }
  }

  const menuItems = [
    ep.youtubeUrl && { key: 'yt', label: 'Ver en YouTube', icon: ExternalLink, href: ep.youtubeUrl, target: '_blank' },
    ep.files.source && { key: 'src', label: 'Descargar audio original', icon: Download, href: api.episodeDownloadUrl(ep, 'source') },
    ep.files.enhanced && { key: 'enh', label: 'Descargar audio mejorado', icon: Download, href: api.episodeDownloadUrl(ep, 'enhanced') },
    ep.files.enhanced && !jobActive && !['downloading', 'exporting'].includes(ep.status) && { key: 'again', label: 'Mejorar de nuevo', icon: Sparkles, onSelect: () => onEnhance(ep) },
    !jobActive && !['downloading', 'exporting'].includes(ep.status) && (ep.source === 'upload' || ep.files.source) && {
      key: 'del',
      label: ep.source === 'youtube' ? 'Borrar audios descargados' : 'Eliminar de la biblioteca',
      icon: Trash2,
      onSelect: () => run('delete'),
    },
  ].filter(Boolean)

  const meta = [
    formatDate(ep.publishedAt, { short: true }),
    Number.isFinite(ep.durationSec) ? formatClock(ep.durationSec) : null,
  ].filter(Boolean)

  return (
    <article className="card p-4 sm:p-5" aria-label={`${ep.title}: ${s.label}`}>
      <div className="flex gap-3.5 sm:gap-4">
        <Thumb ep={ep} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight" title={ep.title}>
              {ep.title}
            </h3>
            <Badge tone={s.tone} dot={s.dot} pulse={s.pulse} icon={s.icon} className="hidden sm:inline-flex">
              {s.label}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-neutral-500 dark:text-neutral-400">
            {meta.map((m, i) => (
              <span key={i} className="tabular-nums">
                {i > 0 && <span aria-hidden className="mr-2">·</span>}
                {m}
              </span>
            ))}
            {meta.length > 0 && <span aria-hidden>·</span>}
            <span className="inline-flex items-center gap-1">
              {ep.source === 'youtube' ? <Youtube size={13} aria-hidden /> : <Upload size={13} aria-hidden />}
              {ep.source === 'youtube' ? 'YouTube' : 'Subido'}
            </span>
            {ep.enhance && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-1">
                  <Sparkles size={13} aria-hidden />
                  {ep.enhance.mode === 'denoise' ? 'Limpiar ruido' : `Mejora · ${modeShortLabel(ep.enhance.mode, ep.enhance.quality)}`}
                </span>
              </>
            )}
          </div>
          <Badge tone={s.tone} dot={s.dot} pulse={s.pulse} icon={s.icon} className="mt-2 sm:hidden">
            {s.label}
          </Badge>
        </div>
      </div>

      {hasBody(ep, job) && (
        <div className="mt-3.5">
          <StatusBody ep={ep} job={job} now={now} />
        </div>
      )}

      <div className={cn('mt-3.5 flex flex-wrap items-center gap-2')}>
        {ep.status === 'discovered' && (
          <Button variant="primary" size="sm" icon={Download} onClick={() => run('download')} loading={busy === 'download'}>
            Descargar audio
          </Button>
        )}
        {ep.status === 'youtube_processing' && (
          <>
            <Button size="sm" icon={RotateCcw} onClick={() => run('retry')} loading={busy === 'retry'}>
              Reintentar ahora
            </Button>
            <Button variant="ghost" size="sm" icon={X} onClick={() => run('cancel')} loading={busy === 'cancel'}>
              Dejar de esperar
            </Button>
          </>
        )}
        {['downloading', 'exporting'].includes(ep.status) && (
          <Button variant="ghost" size="sm" icon={X} onClick={() => run('cancel')} loading={busy === 'cancel'}>
            Cancelar
          </Button>
        )}
        {ep.status === 'downloaded' && (
          <Button variant="primary" size="sm" icon={Sparkles} onClick={() => onEnhance(ep)}>
            Mejorar audio
          </Button>
        )}
        {['enhanced', 'editing'].includes(ep.status) && (
          <Button variant="primary" size="sm" icon={Scissors} onClick={() => onEdit(ep)}>
            Editar y exportar
          </Button>
        )}
        {ep.status === 'ready' && (
          <>
            <a
              href={api.episodeDownloadUrl(ep, 'final')}
              className="focus-ring inline-flex h-8 items-center gap-1.5 rounded-lg bg-neutral-900 px-3 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
            >
              <Download size={15} aria-hidden /> Descargar MP3
            </a>
            <Button size="sm" icon={Scissors} onClick={() => onEdit(ep)}>
              Editar
            </Button>
          </>
        )}
        {ep.status === 'error' && (
          <>
            <Button variant="primary" size="sm" icon={RotateCcw} onClick={() => run('retry')} loading={busy === 'retry'}>
              Reintentar
            </Button>
            {ep.files.enhanced && (
              <Button size="sm" icon={Scissors} onClick={() => onEdit(ep)}>
                Abrir editor
              </Button>
            )}
            {!ep.files.enhanced && ep.files.source && ep.error?.step !== 'enhance' && (
              <Button size="sm" icon={Sparkles} onClick={() => onEnhance(ep)}>
                Mejorar audio
              </Button>
            )}
          </>
        )}
        {ep.status === 'exporting' && (
          <Button size="sm" icon={Scissors} onClick={() => onEdit(ep)}>
            Abrir editor
          </Button>
        )}

        {menuItems.length > 0 && (
          <div className="ml-auto">
            <Menu
              label="Más acciones"
              align="end"
              items={menuItems}
              trigger={({ props }) => (
                <Button variant="ghost" size="icon-sm" icon={MoreHorizontal} aria-label="Más acciones" loading={busy === 'delete'} {...props} />
              )}
            />
          </div>
        )}
      </div>
    </article>
  )
}
