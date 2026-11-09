import { AudioWaveform, Thermometer } from 'lucide-react'
import Tooltip from './ui/Tooltip.jsx'
import { cn } from '../lib/cn.js'

const HOT_C = 83

function shortGpu(name = '') {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '')
}

/** Píldora de estado del sistema a partir de /api/health. */
function HealthPill({ health, connected }) {
  let dot = 'bg-neutral-300 dark:bg-neutral-600'
  let text = 'Conectando…'
  let pulse = false
  let tip = null
  const gpu = health?.gpu

  if (connected === false) {
    dot = 'bg-red-500'
    text = 'Sin conexión'
    tip = 'No hay respuesta del servidor local'
  } else if (health && !gpu) {
    text = 'Sin GPU · CPU'
    tip = 'No se detectó GPU: el proceso será mucho más lento'
  } else if (gpu) {
    const name = shortGpu(gpu.name)
    pulse = gpu.busy
    dot = gpu.busy ? 'bg-neutral-900 dark:bg-white' : 'bg-emerald-500'
    text = `${name} · ${gpu.busy ? 'Procesando' : 'Libre'}`
    tip = `${gpu.name} · ${gpu.vramGB} GB${Number.isFinite(gpu.tempC) ? ` · ${gpu.tempC} °C` : ''}`
  }
  if (health && !health.ffmpeg) tip = 'Falta ffmpeg en el servidor'
  const hot = Number.isFinite(gpu?.tempC) && gpu.tempC >= HOT_C

  return (
    <Tooltip content={hot ? `${tip}. Está caliente: usa una base ventilada.` : tip}>
      <span
        tabIndex={0}
        className="focus-ring inline-flex h-9 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 text-[13px] font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <span className={cn('h-2 w-2 rounded-full transition-colors', dot, pulse && 'animate-pulse-dot')} aria-hidden />
        <span className="whitespace-nowrap">{text}</span>
        {hot && <Thermometer size={14} className="text-red-600" aria-label={`${gpu.tempC} °C`} />}
      </span>
    </Tooltip>
  )
}

export default function Header({ health, connected, mock, queued }) {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-neutral-100/80 backdrop-blur-md dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href="/" className="focus-ring flex items-center gap-2.5 rounded-xl" aria-label="Enhance, inicio">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
            <AudioWaveform size={19} strokeWidth={2.25} />
          </span>
          <span className="text-[17px] font-semibold tracking-tight">Enhance</span>
        </a>
        {mock && (
          <Tooltip content="Sin backend: los datos son simulados">
            <span
              tabIndex={0}
              className="focus-ring rounded-full border border-dashed border-neutral-300 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-700"
            >
              Demo
            </span>
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-2">
          {queued > 0 && (
            <span className="hidden text-[13px] text-neutral-500 sm:inline dark:text-neutral-400">
              {queued} en cola
            </span>
          )}
          <HealthPill health={health} connected={connected} />
        </div>
      </div>
    </header>
  )
}
