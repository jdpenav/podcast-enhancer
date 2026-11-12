import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  Download,
  FileAudio,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  UserRound,
  Wind,
  X,
} from 'lucide-react'
import Badge from './ui/Badge.jsx'
import Button from './ui/Button.jsx'
import Menu from './ui/Menu.jsx'
import ProgressBar from './ui/ProgressBar.jsx'
import Tooltip from './ui/Tooltip.jsx'
import { cn } from '../lib/cn.js'
import {
  baseName,
  formatApprox,
  formatBytes,
  formatClock,
  formatEta,
  formatRelative,
  formatTimeOfDay,
  modeShortLabel,
} from '../lib/format.js'

const STATUS = {
  pending: { label: 'En cola', tone: 'outline' },
  processing: { label: 'Procesando', tone: 'dark', dot: true, pulse: true },
  paused: { label: 'Pausado', tone: 'neutral', icon: Pause },
  done: { label: 'Listo', tone: 'success', icon: Check },
  error: { label: 'Error', tone: 'error', icon: AlertCircle },
  canceled: { label: 'Cancelado', tone: 'muted' },
}

/** Menú de descarga MP3 / WAV, reutilizado en la tarjeta y en el reproductor. */
export function DownloadMenu({ job, api, placement = 'bottom', align = 'start', size = 'md', variant = 'secondary' }) {
  const name = baseName(job.filename)
  return (
    <Menu
      label="Formato de descarga"
      placement={placement}
      align={align}
      items={[
        { key: 'mp3', label: 'MP3', hint: 'Más ligero · para compartir', href: api.downloadUrl(job, 'mp3'), download: `${name}_mejorado.mp3` },
        { key: 'wav', label: 'WAV', hint: 'Sin pérdida · para editar', href: api.downloadUrl(job, 'wav'), download: `${name}_mejorado.wav` },
      ]}
      trigger={({ open, props }) => (
        <Button variant={variant} size={size} icon={Download} {...props}>
          Descargar
          <ChevronDown size={15} className={cn('-mr-1 transition-transform duration-200', open && 'rotate-180')} aria-hidden />
        </Button>
      )}
    />
  )
}

/** Mini ecualizador animado para la miniatura de un trabajo en proceso. */
function Equalizer() {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[3px] animate-pulse rounded-full bg-current"
          style={{ height: `${[60, 100, 45, 80][i]}%`, animationDelay: `${i * 150}ms`, animationDuration: '900ms' }}
        />
      ))}
    </span>
  )
}

function Thumb({ status }) {
  const base = 'grid h-11 w-11 shrink-0 place-items-center rounded-xl transition-colors duration-300'
  if (status === 'processing') return <span className={cn(base, 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900')}><Equalizer /></span>
  if (status === 'done') return <span className={cn(base, 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400')}><Check size={20} strokeWidth={2.5} /></span>
  if (status === 'error') return <span className={cn(base, 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400')}><AlertCircle size={20} /></span>
  return <span className={cn(base, 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400')}><FileAudio size={20} /></span>
}

/**
 * Tarjeta de un trabajo.
 * - onAction(kind, job): 'pause' | 'resume' | 'cancel' | 'delete' → Promise
 * - onListen(job)
 * - onEdit(job): abrir el editor del episodio (cortinas, cortes, exportar)
 * - queue: { ahead, finishSec } para pendientes/procesando
 */
export default function JobCard({ job, api, now, queue, onAction, onListen, onEdit, showGuest = false }) {
  const [busy, setBusy] = useState(null) // acción en curso
  const [flash, setFlash] = useState(false)
  const prevStatus = useRef(job.status)
  const s = STATUS[job.status] ?? STATUS.pending
  const p = job.progress
  const stage = p?.stage ?? 'processing'

  // Resaltar la tarjeta unos segundos cuando termina
  useEffect(() => {
    if (prevStatus.current !== 'done' && job.status === 'done') {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 2500)
      prevStatus.current = job.status
      return () => clearTimeout(t)
    }
    prevStatus.current = job.status
  }, [job.status])

  const run = async (kind) => {
    setBusy(kind)
    try {
      await onAction(kind, job)
    } finally {
      setBusy(null)
    }
  }

  const ModeIcon = job.mode === 'denoise' ? Wind : Sparkles
  const tookSec = job.startedAt && job.finishedAt ? (new Date(job.finishedAt) - new Date(job.startedAt)) / 1000 : null

  return (
    <article
      className={cn(
        'card animate-slide-up p-5 transition-[box-shadow,border-color] duration-700 sm:p-6',
        flash && 'border-emerald-500/60 shadow-[0_0_0_4px] shadow-emerald-500/15 dark:border-emerald-500/50',
        job.status === 'canceled' && 'opacity-70',
      )}
      aria-label={`${job.filename}: ${s.label}`}
    >
      {/* Cabecera */}
      <div className="flex items-start gap-4">
        <Thumb status={job.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="truncate pt-0.5 font-semibold tracking-tight" title={job.filename}>
              {job.filename}
            </h3>
            <Badge tone={s.tone} dot={s.dot} pulse={s.pulse} icon={s.icon}>
              {s.label}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-neutral-500 dark:text-neutral-400">
            <span className="tabular-nums">{formatClock(job.durationSec)}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1">
              <ModeIcon size={13} aria-hidden />
              {job.mode === 'denoise' ? 'Limpiar ruido' : `Mejora · ${modeShortLabel(job.mode, job.quality)}`}
            </span>
            <span aria-hidden className="hidden sm:inline">·</span>
            <span className="hidden tabular-nums sm:inline">{formatBytes(job.sizeBytes)}</span>
            {showGuest && job.guest && (
              <>
                <span aria-hidden>·</span>
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-px text-[12px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  title={`Subido por un invitado (${job.guest}) desde el enlace compartido`}
                >
                  <UserRound size={12} aria-hidden />
                  Invitado · <span className="font-mono">{job.guest}</span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Cuerpo según estado */}
      <div className="mt-5">
        {job.status === 'pending' && (
          <div className="space-y-2.5">
            <ProgressBar value={p?.percent ?? 0} tone="muted" size="sm" label="En cola" />
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
              {queue?.ahead ? `${queue.ahead} ${queue.ahead === 1 ? 'trabajo' : 'trabajos'} antes` : 'Empieza en un momento'}
              {p?.percent ? ` · retoma desde ${Math.round(p.percent)} %` : ''}
              {Number.isFinite(queue?.finishSec) && ` · listo hacia las ${formatTimeOfDay(new Date(now + queue.finishSec * 1000))}`}
            </p>
          </div>
        )}

        {job.status === 'processing' && (
          <div className="space-y-2.5">
            {stage === 'decoding' ? (
              <ProgressBar indeterminate label="Preparando el audio" />
            ) : (
              <ProgressBar value={stage === 'merging' ? 100 : p?.percent ?? 0} shimmer={stage === 'merging'} label="Progreso" />
            )}
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
              {stage === 'decoding' && <span className="text-neutral-500 dark:text-neutral-400">Preparando el audio…</span>}
              {stage === 'merging' && <span className="font-medium">Uniendo y exportando… casi listo</span>}
              {stage === 'processing' && (
                <span>
                  <strong className="font-semibold tabular-nums">{Math.floor(p?.percent ?? 0)} %</strong>
                  <span className="text-neutral-500 dark:text-neutral-400"> · {formatEta(p?.etaSec)}</span>
                </span>
              )}
              {stage === 'processing' && Number.isFinite(p?.etaSec) && (
                <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                  Listo hacia las {formatTimeOfDay(new Date(now + (p.etaSec + 20) * 1000))}
                </span>
              )}
            </div>
          </div>
        )}

        {job.status === 'paused' && (
          <div className="space-y-2.5">
            <ProgressBar value={p?.percent ?? 0} tone="muted" label="Pausado" />
            <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
              Pausado en <strong className="font-semibold tabular-nums text-neutral-800 dark:text-neutral-200">{Math.floor(p?.percent ?? 0)} %</strong> · el avance está guardado
            </p>
          </div>
        )}

        {job.status === 'error' && (
          <div className="flex gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400" role="alert">
            <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <p>{job.error?.message ?? 'Ocurrió un error inesperado.'}</p>
              {p?.percent > 0 && <p className="mt-1 text-[13px] opacity-80">Avance guardado: {Math.floor(p.percent)} %</p>}
            </div>
          </div>
        )}

        {job.status === 'done' && (
          <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
            Terminado {formatRelative(job.finishedAt, now)}
            {tookSec ? ` · tardó ${formatApprox(tookSec).replace('~', '')}` : ''}
          </p>
        )}

        {job.status === 'canceled' && (
          <p className="text-[13px] text-neutral-500 dark:text-neutral-400">Cancelado {formatRelative(job.finishedAt ?? job.createdAt, now)}</p>
        )}
      </div>

      {/* Acciones */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {job.status === 'done' && (
          <>
            <Button variant="primary" icon={Headphones} onClick={() => onListen(job)}>
              Escuchar
            </Button>
            {onEdit && job.episodeId && (
              <Button icon={Scissors} onClick={() => onEdit(job)}>
                Editar y exportar
              </Button>
            )}
            <DownloadMenu job={job} api={api} />
          </>
        )}
        {job.status === 'processing' && (
          <Tooltip content={stage === 'merging' ? 'Casi listo: no hace falta pausar' : null} side="top">
            <Button icon={Pause} onClick={() => run('pause')} loading={busy === 'pause'} disabled={stage === 'merging'}>
              Pausar
            </Button>
          </Tooltip>
        )}
        {job.status === 'paused' && (
          <Button variant="primary" icon={Play} onClick={() => run('resume')} loading={busy === 'resume'}>
            Reanudar
          </Button>
        )}
        {job.status === 'error' && (
          <Button variant="primary" icon={RotateCcw} onClick={() => run('resume')} loading={busy === 'resume'}>
            Reintentar
          </Button>
        )}
        {['pending', 'processing', 'paused'].includes(job.status) && (
          <Button variant="ghost" icon={X} onClick={() => run('cancel')} loading={busy === 'cancel'}>
            Cancelar
          </Button>
        )}
        {['done', 'error', 'canceled'].includes(job.status) && (
          <Tooltip content="Eliminar" side="top" className="ml-auto">
            <Button variant="ghost" size="icon" icon={Trash2} aria-label="Eliminar trabajo" onClick={() => run('delete')} loading={busy === 'delete'} />
          </Tooltip>
        )}
      </div>
    </article>
  )
}
