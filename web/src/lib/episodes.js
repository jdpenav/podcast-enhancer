// Estados de la biblioteca: etiquetas en español, tonos y helpers.
import { AlertCircle, Check, Download, Hourglass, Scissors, Sparkles } from 'lucide-react'

export const EP_STATUS = {
  discovered: { label: 'Sin descargar', tone: 'outline' },
  youtube_processing: { label: 'Esperando a YouTube', tone: 'neutral', icon: Hourglass },
  downloading: { label: 'Descargando', tone: 'dark', dot: true, pulse: true },
  downloaded: { label: 'Descargado', tone: 'neutral', icon: Download },
  enhancing: { label: 'Mejorando', tone: 'dark', dot: true, pulse: true },
  enhanced: { label: 'Mejorado', tone: 'neutral', icon: Sparkles },
  editing: { label: 'En edición', tone: 'neutral', icon: Scissors },
  exporting: { label: 'Exportando', tone: 'dark', dot: true, pulse: true },
  ready: { label: 'Listo', tone: 'success', icon: Check },
  error: { label: 'Error', tone: 'error', icon: AlertCircle },
}

/** Etiqueta de estado teniendo en cuenta el trabajo de mejora (en cola / en pausa). */
export function statusMeta(ep, job) {
  if (ep.status === 'enhancing' && job) {
    if (job.status === 'pending') return { label: 'En cola', tone: 'outline' }
    if (job.status === 'paused') return { label: 'Mejora en pausa', tone: 'neutral' }
  }
  if (ep.status === 'downloading' && (!ep.progress || ep.progress.stage === 'queued')) return { label: 'En cola', tone: 'outline' }
  if (ep.status === 'exporting' && (!ep.progress || ep.progress.stage === 'queued')) return { label: 'En cola', tone: 'outline' }
  return EP_STATUS[ep.status] ?? EP_STATUS.discovered
}

/** Trabajo de mejora "vivo" (de la lista de trabajos, con progreso en tiempo real) o el resumen del episodio. */
export function liveJob(ep, jobs) {
  if (!ep.jobId) return null
  return jobs?.find((j) => j.id === ep.jobId) ?? ep.job ?? null
}

export const FILTERS = [
  { key: 'all', label: 'Todos', test: () => true },
  { key: 'pending', label: 'Sin descargar', test: (e) => e.status === 'discovered' },
  { key: 'active', label: 'En curso', test: (e) => ['youtube_processing', 'downloading', 'enhancing', 'exporting'].includes(e.status) },
  { key: 'editable', label: 'Para editar', test: (e) => ['downloaded', 'enhanced', 'editing'].includes(e.status) },
  { key: 'ready', label: 'Listos', test: (e) => e.status === 'ready' },
  { key: 'error', label: 'Con error', test: (e) => e.status === 'error' },
]

export const EXPORT_STAGE = {
  queued: 'En cola…',
  measuring: 'Midiendo la sonoridad…',
  encoding: 'Normalizando y codificando el MP3…',
  validating: 'Verificando el resultado…',
}

export const DOWNLOAD_STAGE = {
  queued: 'En cola para descargar…',
  checking: 'Consultando YouTube…',
  downloading: 'Descargando audio…',
}

/** Búsqueda sin tildes ni mayúsculas. */
export const normalizeText = (s) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
