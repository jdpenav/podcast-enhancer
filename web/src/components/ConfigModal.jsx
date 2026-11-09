import { useEffect, useRef, useState } from 'react'
import { Check, Clock, FileAudio, Loader2, Sparkles, Wind } from 'lucide-react'
import Modal from './ui/Modal.jsx'
import Button from './ui/Button.jsx'
import Segmented from './ui/Segmented.jsx'
import ProgressBar from './ui/ProgressBar.jsx'
import { cn } from '../lib/cn.js'
import { formatApprox, formatBytes, formatClock, formatTimeOfDay } from '../lib/format.js'
import { estimateFor } from '../lib/jobs.js'

const STORAGE_KEY = 'enhance:lastChoice'

function loadChoice() {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE_KEY))
    if (c?.mode === 'denoise' || c?.mode === 'enhance') return { mode: c.mode, quality: c.quality === 'max' ? 'max' : 'standard' }
  } catch {
    /* sin almacenamiento */
  }
  return { mode: 'enhance', quality: 'standard' }
}

function saveChoice(c) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c))
  } catch {
    /* sin almacenamiento */
  }
}

/** Tarjeta seleccionable (radio). */
function ModeOption({ selected, onSelect, icon: Icon, title, description, estimate, disabled, children }) {
  return (
    <div
      className={cn(
        'rounded-2xl border transition-[border-color,box-shadow,background-color] duration-200',
        selected
          ? 'border-neutral-900 bg-white shadow-[0_0_0_1px] shadow-neutral-900 dark:border-white dark:bg-neutral-900 dark:shadow-white'
          : 'border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:border-neutral-700 dark:hover:bg-neutral-800/50',
        disabled && 'pointer-events-none opacity-60',
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        disabled={disabled}
        className="focus-ring flex w-full items-start gap-3.5 rounded-2xl p-4 text-left"
      >
        <span
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors',
            selected ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
          )}
        >
          <Icon size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3">
            <span className="font-semibold tracking-tight">{title}</span>
            {estimate && <span className="shrink-0 text-sm tabular-nums text-neutral-500 dark:text-neutral-400">{estimate}</span>}
          </span>
          <span className="mt-0.5 block text-sm text-neutral-500 dark:text-neutral-400">{description}</span>
        </span>
        <span
          className={cn(
            'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors',
            selected ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900' : 'border-neutral-300 dark:border-neutral-600',
          )}
          aria-hidden
        >
          {selected && <Check size={12} strokeWidth={3} />}
        </span>
      </button>
      {/* Contenido expandible (transición de altura con grid-rows) */}
      {children && (
        <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', selected ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className="overflow-hidden">
            <div className="px-4 pb-4">{children}</div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Elegir modo y subir.
 * - durationSec: undefined = leyendo, null = desconocida, número = segundos.
 * - waitSec: segundos de cola por delante (para "listo hacia las …").
 * - onSubmit(choice, { onProgress, signal }) → Promise<Job>
 */
export default function ConfigModal({ open, file, durationSec, config, waitSec = 0, aheadCount = 0, onSubmit, onClose }) {
  const [choice, setChoice] = useState(loadChoice)
  const [upload, setUpload] = useState(null) // { fraction, loaded, total } mientras sube
  const [error, setError] = useState(null)
  const abortRef = useRef(null)

  // Reiniciar al abrir con un archivo nuevo
  useEffect(() => {
    if (open) {
      setUpload(null)
      setError(null)
    }
  }, [open, file])

  const uploading = upload !== null
  const est = (mode, quality) => estimateFor(config, durationSec, mode, quality)
  const fmtEst = (mode, quality) => (Number.isFinite(durationSec) ? formatApprox(est(mode, quality)) : null)
  const selectedEst = est(choice.mode, choice.mode === 'enhance' ? choice.quality : null)
  const readyAt = Number.isFinite(selectedEst) ? new Date(Date.now() + (waitSec + selectedEst) * 1000) : null

  const submit = async () => {
    setError(null)
    setUpload({ fraction: 0, loaded: 0, total: file.size })
    const ctrl = new AbortController()
    abortRef.current = ctrl
    saveChoice(choice)
    try {
      await onSubmit(
        { mode: choice.mode, quality: choice.mode === 'enhance' ? choice.quality : undefined },
        { signal: ctrl.signal, onProgress: (fraction, loaded, total) => setUpload({ fraction, loaded, total }) },
      )
    } catch (e) {
      setUpload(null)
      if (e?.name !== 'AbortError') setError(e?.message ?? 'No se pudo subir el archivo.')
    } finally {
      abortRef.current = null
    }
  }

  const cancel = () => {
    if (uploading) abortRef.current?.abort()
    else onClose()
  }

  const finishing = uploading && upload.fraction >= 1

  return (
    <Modal
      open={open}
      onClose={cancel}
      dismissable={!uploading}
      title="Procesar audio"
      footer={
        <>
          <Button onClick={cancel}>{uploading ? 'Cancelar subida' : 'Cancelar'}</Button>
          <Button variant="primary" onClick={submit} loading={uploading} disabled={!config}>
            {uploading ? 'Subiendo…' : 'Procesar'}
          </Button>
        </>
      }
    >
      {file && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl bg-neutral-100 p-3 dark:bg-neutral-800/60">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-neutral-700 shadow-sm dark:bg-neutral-900 dark:text-neutral-200">
            <FileAudio size={19} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={file.name}>
              {file.name}
            </p>
            <p className="flex items-center gap-1.5 text-[13px] tabular-nums text-neutral-500 dark:text-neutral-400">
              {durationSec === undefined ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Leyendo duración…
                </>
              ) : durationSec === null ? (
                'Duración desconocida'
              ) : (
                formatClock(durationSec)
              )}
              <span aria-hidden>·</span>
              {formatBytes(file.size)}
            </p>
          </div>
        </div>
      )}

      <div role="radiogroup" aria-label="Modo de procesamiento" className="space-y-3">
        <ModeOption
          icon={Wind}
          title="Limpiar ruido"
          description="Quita el ruido de fondo. Rápido."
          estimate={fmtEst('denoise', null)}
          selected={choice.mode === 'denoise'}
          onSelect={() => setChoice((c) => ({ ...c, mode: 'denoise' }))}
          disabled={uploading}
        />
        <ModeOption
          icon={Sparkles}
          title="Mejora completa"
          description="Quita el ruido y regenera la voz con sonido de estudio."
          selected={choice.mode === 'enhance'}
          onSelect={() => setChoice((c) => ({ ...c, mode: 'enhance' }))}
          disabled={uploading}
        >
          <Segmented
            label="Calidad"
            value={choice.quality}
            onChange={(quality) => setChoice((c) => ({ ...c, quality }))}
            options={[
              { value: 'standard', label: 'Estándar', hint: fmtEst('enhance', 'standard') ?? 'Buen balance' },
              { value: 'max', label: 'Máxima', hint: fmtEst('enhance', 'max') ?? 'Más lento' },
            ]}
          />
        </ModeOption>
      </div>

      <div className="mt-5 min-h-[44px]" aria-live="polite">
        {uploading ? (
          <div className="animate-fade-in space-y-2">
            <div className="flex items-baseline justify-between text-[13px]">
              <span className="font-medium">{finishing ? 'Registrando en la cola…' : 'Subiendo copia del audio…'}</span>
              <span className="tabular-nums text-neutral-500 dark:text-neutral-400">
                {Math.round(upload.fraction * 100)} % · {formatBytes(upload.loaded)} de {formatBytes(upload.total)}
              </span>
            </div>
            <ProgressBar value={upload.fraction * 100} shimmer={finishing} label="Progreso de subida" />
          </div>
        ) : error ? (
          <p role="alert" className="animate-fade-in rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        ) : readyAt ? (
          <p className="flex items-center gap-2 text-[13px] text-neutral-500 dark:text-neutral-400">
            <Clock size={14} className="shrink-0" />
            <span>
              {aheadCount > 0 ? `${aheadCount} ${aheadCount === 1 ? 'trabajo' : 'trabajos'} antes en la cola · ` : ''}
              Listo hacia las <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{formatTimeOfDay(readyAt)}</strong>
            </span>
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
