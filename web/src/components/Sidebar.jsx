import { useEffect, useState } from 'react'
import { Bell, BellOff, Clock, Lock, MonitorOff, Sparkles, Thermometer, Wind } from 'lucide-react'
import Button from './ui/Button.jsx'
import { formatApprox, formatTimeOfDay } from '../lib/format.js'

function Stat({ label, value }) {
  return (
    <div className="rounded-xl bg-neutral-100 px-3 py-2.5 dark:bg-neutral-800/60">
      <p className="text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">{label}</p>
    </div>
  )
}

function SummaryCard({ counts, waitSec, health, now }) {
  const temp = health?.gpu?.tempC
  return (
    <section className="card p-5" aria-label="Resumen">
      <h2 className="text-sm font-semibold">Resumen</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="En cola" value={counts.pending} />
        <Stat label="Procesando" value={counts.processing} />
        <Stat label="Listos" value={counts.done} />
      </div>
      <div className="mt-3 space-y-2 text-[13px] text-neutral-500 dark:text-neutral-400">
        {waitSec > 0 && (
          <p className="flex items-center gap-2">
            <Clock size={14} aria-hidden />
            La cola termina hacia las{' '}
            <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{formatTimeOfDay(new Date(now + waitSec * 1000))}</strong>
          </p>
        )}
        {Number.isFinite(temp) && (
          <p className="flex items-center gap-2">
            <Thermometer size={14} aria-hidden className={temp >= 83 ? 'text-red-600' : ''} />
            GPU a <span className="tabular-nums">{temp} °C</span>
            {temp >= 83 && <span className="text-red-600 dark:text-red-400">· usa una base ventilada</span>}
          </p>
        )}
      </div>
    </section>
  )
}

function ModesCard({ config }) {
  if (!config) return null
  const icon = { denoise: Wind, enhance: Sparkles }
  return (
    <section className="card p-5" aria-label="Modos">
      <h2 className="text-sm font-semibold">Modos</h2>
      <p className="mt-1 text-[13px] text-neutral-500 dark:text-neutral-400">Tiempo de proceso por cada hora de audio.</p>
      <ul className="mt-3 space-y-2.5">
        {config.modes.map((m) => {
          const Icon = icon[m.mode]
          return (
            <li key={`${m.mode}-${m.quality}`} className="flex items-start gap-3">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{m.mode === 'denoise' ? m.label : m.label.replace('Mejora completa · ', 'Mejora · ')}</p>
                  <p className="shrink-0 text-[13px] tabular-nums text-neutral-500 dark:text-neutral-400">{formatApprox(3600 * m.factor)}</p>
                </div>
                <p className="text-[13px] text-neutral-500 dark:text-neutral-400">{m.description}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function permissionState() {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
}

function TipsCard() {
  const [perm, setPerm] = useState(permissionState)
  useEffect(() => {
    const t = setInterval(() => setPerm(permissionState()), 2000) // el permiso puede cambiar desde el navegador
    return () => clearInterval(t)
  }, [])

  return (
    <section className="card space-y-3 p-5 text-[13px] text-neutral-600 dark:text-neutral-400" aria-label="Consejos">
      <p className="flex gap-2.5">
        <Lock size={15} className="mt-0.5 shrink-0" aria-hidden />
        Todo se procesa en esta computadora. Tu archivo original nunca se modifica.
      </p>
      <p className="flex gap-2.5">
        <MonitorOff size={15} className="mt-0.5 shrink-0" aria-hidden />
        Puedes cerrar esta pestaña: el trabajo sigue en segundo plano.
      </p>
      {perm === 'default' && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-neutral-100 p-3 dark:bg-neutral-800/60">
          <p className="flex gap-2.5">
            <Bell size={15} className="mt-0.5 shrink-0" aria-hidden />
            Avisarme cuando un audio esté listo
          </p>
          <Button size="sm" variant="primary" onClick={() => Notification.requestPermission().then(setPerm)}>
            Activar
          </Button>
        </div>
      )}
      {perm === 'granted' && (
        <p className="flex gap-2.5">
          <Bell size={15} className="mt-0.5 shrink-0" aria-hidden />
          Te avisaremos con una notificación cuando termine.
        </p>
      )}
      {perm === 'denied' && (
        <p className="flex gap-2.5">
          <BellOff size={15} className="mt-0.5 shrink-0" aria-hidden />
          Los avisos están bloqueados en el navegador.
        </p>
      )}
    </section>
  )
}

export default function Sidebar({ counts, waitSec, health, config, now }) {
  return (
    <aside className="space-y-4 lg:sticky lg:top-24">
      <SummaryCard counts={counts} waitSec={waitSec} health={health} now={now} />
      <ModesCard config={config} />
      <TipsCard />
    </aside>
  )
}
