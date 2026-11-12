import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Gauge, Keyboard, Scissors } from 'lucide-react'
import Modal from './ui/Modal.jsx'
import Button from './ui/Button.jsx'
import Menu from './ui/Menu.jsx'
import Segmented from './ui/Segmented.jsx'
import AudioPlayer from './AudioPlayer.jsx'
import { DownloadMenu } from './JobCard.jsx'
import { cn } from '../lib/cn.js'
import { baseName, formatClock, modeLabel } from '../lib/format.js'

const SPEEDS = [0.75, 1, 1.25, 1.5, 2]
const peaksCache = new Map()

function usePeaks(api, jobId, which) {
  const key = `${jobId}:${which}`
  const [peaks, setPeaks] = useState(() => peaksCache.get(key) ?? null)
  useEffect(() => {
    if (!api || !jobId) return
    if (peaksCache.has(key)) return setPeaks(peaksCache.get(key))
    let alive = true
    setPeaks(null)
    api
      .getWaveform(jobId, which)
      .then((w) => {
        peaksCache.set(key, w.peaks)
        if (alive) setPeaks(w.peaks)
      })
      .catch(() => alive && setPeaks(new Array(200).fill(0.15))) // sin onda: barras planas
    return () => {
      alive = false
    }
  }, [api, jobId, which, key])
  return peaks
}

/** Escuchar el resultado, comparar con el original y descargar. */
export default function ResultModal({ job, api, mock, onClose, onEdit }) {
  const [active, setActive] = useState('result')
  const [rate, setRate] = useState(1)
  const open = !!job
  const [shown, setShown] = useState(job) // mantener contenido durante la animación de salida

  useEffect(() => {
    if (job) {
      setShown(job)
    }
  }, [job])

  useEffect(() => {
    if (open) {
      setActive('result')
    }
  }, [open, job?.id])

  const peaksOriginal = usePeaks(api, shown?.id, 'original')
  const peaksResult = usePeaks(api, shown?.id, 'result')
  const toggleCompare = useCallback(() => setActive((a) => (a === 'result' ? 'original' : 'result')), [])

  if (!shown) return null

  return (
    <Modal open={open} onClose={onClose} size="lg" title={baseName(shown.filename)} description={`${modeLabel(shown.mode, shown.quality)} · ${formatClock(shown.durationSec)}`}>
      <div className="flex flex-col gap-5 pb-2 pt-2">
        <Segmented
          label="Comparar"
          className="mx-auto w-full max-w-xs"
          value={active}
          onChange={setActive}
          options={[
            { value: 'original', label: 'Original' },
            { value: 'result', label: 'Mejorado' },
          ]}
        />

        {open && (
          <AudioPlayer
            key={shown.id}
            active={active}
            rate={rate}
            fallbackDuration={shown.durationSec}
            onToggleCompare={toggleCompare}
            tracks={{
              original: { src: api.audioUrl(shown, 'original'), peaks: peaksOriginal },
              result: { src: api.audioUrl(shown, 'result'), peaks: peaksResult },
            }}
          />
        )}

        <div className="flex flex-wrap items-center justify-center gap-2">
          <Menu
            label="Velocidad"
            placement="top"
            items={SPEEDS.map((s) => ({ key: String(s), label: `${s}x`, selected: s === rate, onSelect: () => setRate(s) }))}
            trigger={({ open: o, props }) => (
              <Button icon={Gauge} {...props}>
                Velocidad: <span className="tabular-nums">{rate}x</span>
                <ChevronDown size={15} className={cn('-mr-1 transition-transform duration-200', o && 'rotate-180')} aria-hidden />
              </Button>
            )}
          />
          <DownloadMenu job={shown} api={api} placement="top" align="end" />
          {onEdit && shown.episodeId && (
            <Button variant="primary" icon={Scissors} onClick={() => onEdit(shown)}>
              Editar y exportar
            </Button>
          )}
        </div>

        <p className="hidden items-center justify-center gap-1.5 text-xs text-neutral-400 sm:flex dark:text-neutral-500">
          <Keyboard size={13} aria-hidden />
          <Kbd>Espacio</Kbd> reproducir · <Kbd>←</Kbd> <Kbd>→</Kbd> 5 s · <Kbd>C</Kbd> comparar
        </p>
        {mock && (
          <p className="-mt-2 text-center text-xs text-neutral-400 dark:text-neutral-500">
            Modo demo: se reproduce un fragmento de prueba de 60 s.
          </p>
        )}
      </div>
    </Modal>
  )
}

function Kbd({ children }) {
  return (
    <kbd className="rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-px font-sans text-[11px] font-medium text-neutral-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-400">
      {children}
    </kbd>
  )
}
