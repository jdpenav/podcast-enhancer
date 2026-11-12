import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Pause, Play, Plus, Scissors, Settings2, Trash2, Undo2 } from 'lucide-react'
import Button from '../ui/Button.jsx'
import Segmented from '../ui/Segmented.jsx'
import Tooltip from '../ui/Tooltip.jsx'
import { cn } from '../../lib/cn.js'
import { formatClock, formatTimecode, parseTimecode } from '../../lib/format.js'
import { routeHref } from '../../hooks/useRoute.js'

export function Panel({ title, action, children, className }) {
  return (
    <section className={cn('card p-5', className)} aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Estructura final: [Intro] [Contenido] [Outro]
// ---------------------------------------------------------------------------
export function Structure({ intro, outro, bodySec, totalSec, removedSec }) {
  const Block = ({ label, sec, kind }) => (
    <div
      className={cn(
        'flex min-w-0 flex-col justify-center rounded-lg px-2.5 py-1.5',
        kind === 'body' ? 'flex-1 bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'w-24 shrink-0 bg-neutral-100 dark:bg-neutral-800',
      )}
    >
      <span className="truncate text-[12px] font-medium">{label}</span>
      <span className={cn('text-[11px] tabular-nums', kind === 'body' ? 'opacity-70' : 'text-neutral-500 dark:text-neutral-400')}>{formatClock(sec)}</span>
    </div>
  )
  return (
    <div>
      <div className="flex gap-1.5" aria-label="Estructura del episodio final">
        {intro && <Block label={`Intro · ${intro.name}`} sec={intro.durationSec} />}
        <Block label="Contenido" sec={bodySec} kind="body" />
        {outro && <Block label={`Outro · ${outro.name}`} sec={outro.durationSec} />}
      </div>
      <p className="mt-2 text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
        Duración final ≈ <strong className="font-semibold text-neutral-800 dark:text-neutral-200">{formatClock(totalSec)}</strong>
        {removedSec > 0.5 && <> · se quitan {formatClock(removedSec)} con los cortes</>}
        {!intro && !outro && <> · sin cortinas</>}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cortinas
// ---------------------------------------------------------------------------
function useMiniPlayer() {
  const audio = useRef(null)
  const [playing, setPlaying] = useState(null) // url en reproducción
  useEffect(() => () => audio.current?.pause(), [])
  const toggle = (url) => {
    if (!audio.current) {
      audio.current = new Audio()
      audio.current.addEventListener('ended', () => setPlaying(null))
      audio.current.addEventListener('pause', () => setPlaying(null))
    }
    const a = audio.current
    if (playing === url) return a.pause()
    a.src = url
    a.play().then(() => setPlaying(url)).catch(() => setPlaying(null))
  }
  return { playing, toggle }
}

function CurtainSelect({ label, value, assets, onChange, disabled, player }) {
  const current = assets.find((a) => a.id === value) ?? null
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium" htmlFor={`curtain-${label}`}>
        {label}
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <select
            id={`curtain-${label}`}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value || null)}
            disabled={disabled}
            className="focus-ring h-10 w-full appearance-none truncate rounded-xl border border-neutral-200 bg-white pl-3 pr-9 text-sm disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Ninguna</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({formatClock(a.durationSec)})
              </option>
            ))}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden />
        </div>
        <Button
          size="icon"
          icon={player.playing === current?.url ? Pause : Play}
          disabled={!current}
          onClick={() => current && player.toggle(current.url)}
          aria-label={`Escuchar ${label.toLowerCase()}`}
        />
      </div>
    </div>
  )
}

export function CurtainsPanel({ assets, introId, outroId, onChange, disabled }) {
  const player = useMiniPlayer()
  return (
    <Panel
      title="Cortinas"
      action={
        <a href={routeHref.settings} className="text-[13px] font-medium text-neutral-500 underline-offset-2 hover:text-neutral-900 hover:underline dark:text-neutral-400 dark:hover:text-white">
          Gestionar
        </a>
      }
    >
      {assets.length === 0 ? (
        <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
          Todavía no hay cortinas. Súbelas en{' '}
          <a href={routeHref.settings} className="font-medium text-neutral-800 underline-offset-2 hover:underline dark:text-neutral-200">
            Ajustes
          </a>{' '}
          y aparecerán aquí.
        </p>
      ) : (
        <div className="space-y-3">
          <CurtainSelect label="Entrada (intro)" value={introId} assets={assets} onChange={(v) => onChange({ introId: v })} disabled={disabled} player={player} />
          <CurtainSelect label="Salida (outro)" value={outroId} assets={assets} onChange={(v) => onChange({ outroId: v })} disabled={disabled} player={player} />
          <p className="text-[12px] text-neutral-500 dark:text-neutral-400">Tu elección queda como predeterminada para el próximo episodio.</p>
        </div>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Cortes
// ---------------------------------------------------------------------------
function TimeInput({ value, onCommit, label, disabled }) {
  const [text, setText] = useState(formatTimecode(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setText(formatTimecode(value))
    setInvalid(false)
  }, [value])
  const commit = () => {
    const v = parseTimecode(text)
    if (v == null || !onCommit(v)) {
      setInvalid(true)
      setTimeout(() => {
        setText(formatTimecode(value))
        setInvalid(false)
      }, 900)
    }
  }
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setText(formatTimecode(value))
          e.currentTarget.blur()
        }
      }}
      className={cn(
        'focus-ring h-8 w-[4.75rem] min-w-0 rounded-lg border bg-white px-1 text-center font-mono text-[12px] tabular-nums dark:bg-neutral-900',
        invalid ? 'border-red-500 text-red-600' : 'border-neutral-200 dark:border-neutral-700',
      )}
    />
  )
}

export function CutsPanel({ cuts, duration, onUpdate, onRemove, onAddAtCursor, onUndo, canUndo, onPreview, onListen, disabled }) {
  return (
    <Panel
      title={`Cortes${cuts.length ? ` · ${cuts.length}` : ''}`}
      action={
        <div className="flex items-center gap-1">
          <Tooltip content="Deshacer (Ctrl+Z)">
            <Button variant="ghost" size="icon-sm" icon={Undo2} onClick={onUndo} disabled={!canUndo || disabled} aria-label="Deshacer" />
          </Tooltip>
          <Button variant="ghost" size="sm" icon={Plus} onClick={onAddAtCursor} disabled={disabled}>
            En el cursor
          </Button>
        </div>
      }
    >
      {cuts.length === 0 ? (
        <p className="text-[13px] text-neutral-500 dark:text-neutral-400">
          Arrastra sobre la onda para marcar una parte que no va en el podcast (silencios al inicio, avisos…). Se quita al exportar.
        </p>
      ) : (
        <ul className="-mx-1 max-h-80 space-y-1 overflow-y-auto overflow-x-hidden px-1">
          {cuts.map((c, i) => (
            <li key={c.id} className="flex items-center gap-1 rounded-xl bg-neutral-50 p-1.5 dark:bg-neutral-800/50">
              <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-neutral-400">{i + 1}</span>
              <TimeInput label={`Inicio del corte ${i + 1}`} value={c.start} disabled={disabled} onCommit={(v) => onUpdate(c.id, { start: v })} />
              <span className="text-[11px] text-neutral-400" aria-hidden>–</span>
              <TimeInput label={`Fin del corte ${i + 1}`} value={c.end} disabled={disabled} onCommit={(v) => onUpdate(c.id, { end: Math.min(v, duration) })} />
              <div className="ml-auto flex shrink-0">
                <Tooltip content="Escuchar lo que se quita">
                  <Button variant="ghost" size="icon-sm" icon={Play} onClick={() => onListen(c)} aria-label={`Escuchar el corte ${i + 1}`} />
                </Tooltip>
                <Tooltip content="Escuchar cómo queda la unión">
                  <Button variant="ghost" size="icon-sm" icon={Scissors} onClick={() => onPreview(c)} aria-label={`Previsualizar la unión del corte ${i + 1}`} />
                </Tooltip>
                <Tooltip content="Quitar corte">
                  <Button variant="ghost" size="icon-sm" icon={Trash2} onClick={() => onRemove(c.id)} disabled={disabled} aria-label={`Quitar el corte ${i + 1}`} />
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// Preajuste de exportación
// ---------------------------------------------------------------------------
export function PresetEditor({ preset, defaults, limits, onChange, disabled }) {
  const [open, setOpen] = useState(false)
  const isDefault = ['bitrateKbps', 'channels', 'lufs', 'cutCrossfadeMs', 'curtainFadeSec'].every((k) => preset[k] === defaults[k])
  const set = (patch) => onChange({ ...preset, ...patch, name: 'personalizado' })
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="focus-ring flex w-full items-center gap-3 rounded-xl px-3.5 py-2.5 text-left"
      >
        <Settings2 size={16} className="shrink-0 text-neutral-500" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{isDefault ? 'Castbox (voz)' : 'Personalizado'}</span>
          <span className="block text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
            MP3 {preset.bitrateKbps} kbps CBR · {preset.channels === 1 ? 'mono' : 'estéreo'} · {preset.lufs} LUFS
          </span>
        </span>
        <ChevronDown size={15} className={cn('shrink-0 text-neutral-400 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      <div className={cn('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <fieldset disabled={disabled} className="space-y-3.5 border-t border-neutral-100 px-3.5 pb-3.5 pt-3 dark:border-neutral-800">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-neutral-600 dark:text-neutral-400">Bitrate</span>
                <select
                  value={preset.bitrateKbps}
                  onChange={(e) => set({ bitrateKbps: Number(e.target.value) })}
                  className="focus-ring h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {limits.bitrateKbps.map((b) => (
                    <option key={b} value={b}>
                      {b} kbps
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-neutral-600 dark:text-neutral-400">Sonoridad (LUFS)</span>
                <input
                  type="number"
                  step="0.5"
                  min={limits.lufs[0]}
                  max={limits.lufs[1]}
                  value={preset.lufs}
                  onChange={(e) => e.target.value !== '' && set({ lufs: Number(e.target.value) })}
                  className="focus-ring h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
            </div>
            <div>
              <span className="mb-1 block text-[12px] font-medium text-neutral-600 dark:text-neutral-400">Canales</span>
              <Segmented
                size="sm"
                label="Canales"
                value={preset.channels}
                onChange={(v) => set({ channels: v })}
                options={[
                  { value: 1, label: 'Mono' },
                  { value: 2, label: 'Estéreo' },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-neutral-600 dark:text-neutral-400">Fundido en cortes (ms)</span>
                <input
                  type="number"
                  min={limits.cutCrossfadeMs[0]}
                  max={limits.cutCrossfadeMs[1]}
                  step="5"
                  value={preset.cutCrossfadeMs}
                  onChange={(e) => e.target.value !== '' && set({ cutCrossfadeMs: Number(e.target.value) })}
                  className="focus-ring h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm tabular-nums dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-neutral-600 dark:text-neutral-400">Unión con cortinas</span>
                <select
                  value={preset.curtainFadeSec}
                  onChange={(e) => set({ curtainFadeSec: Number(e.target.value) })}
                  className="focus-ring h-9 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <option value={0}>Corte seco</option>
                  <option value={0.5}>Fundido 0,5 s</option>
                  <option value={1}>Fundido 1 s</option>
                  <option value={2}>Fundido 2 s</option>
                  <option value={3}>Fundido 3 s</option>
                </select>
              </label>
            </div>
            <p className="text-[12px] text-neutral-500 dark:text-neutral-400">
              -16 LUFS es la referencia para podcast; para voz en mono hay quien usa -19. CBR asegura que la duración y el adelantar funcionen en todos los reproductores.
            </p>
            {!isDefault && (
              <Button size="sm" onClick={() => onChange({ ...defaults })}>
                Volver a Castbox (voz)
              </Button>
            )}
          </fieldset>
        </div>
      </div>
    </div>
  )
}
