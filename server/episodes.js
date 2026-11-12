// Modelo Episode: rutas de archivos, forma EXACTA del contrato (docs/API.md) y emisión por SSE.
//
// Estados (la UI los muestra en español):
//   discovered          en el canal, sin audio todavía
//   youtube_processing  el stream terminó pero YouTube aún no lo deja descargar (reintento automático)
//   downloading         en cola o descargando
//   downloaded          audio original disponible
//   enhancing           trabajo de mejora (Job) en la cola de la GPU
//   enhanced            audio mejorado disponible
//   editing             con cortes / cortinas guardados
//   exporting           generando el MP3 final
//   ready               MP3 final disponible
//   error               ver error.step: 'download' | 'enhance' | 'export'
//
// Lo que se puede hacer con un episodio depende de los ARCHIVOS que tiene (files.*), no solo del
// estado: así un error al exportar no impide volver a editar, y reintentar no rehace pasos previos.
import fs from 'node:fs'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import { episodeDir } from './config.js'
import { getEpisode, getJob, updateEpisodeRow } from './db.js'
import { broadcast } from './events.js'
import { HttpError } from './errors.js'

export const STATUSES = [
  'discovered', 'youtube_processing', 'downloading', 'downloaded', 'enhancing',
  'enhanced', 'editing', 'exporting', 'ready', 'error',
]

export const newEpisodeId = (() => {
  const gen = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)
  return () => `e_${gen()}`
})()
export const youtubeEpisodeId = (videoId) => `yt_${videoId}`

export function epFiles(ep) {
  const dir = episodeDir(ep.id)
  return {
    dir,
    source: ep.sourceExt ? path.join(dir, `source${ep.sourceExt}`) : null,
    downloadDir: path.join(dir, 'descarga'), // salida temporal de yt-dlp
    enhancedWav: path.join(dir, 'enhanced.wav'), // para exportar (sin pérdida)
    enhancedMp3: path.join(dir, 'enhanced.mp3'), // para escuchar en el editor (ligero)
    peaks: path.join(dir, 'peaks.json'),
    final: path.join(dir, 'final.mp3'),
  }
}

const has = (p) => !!p && fs.existsSync(p)
export const hasSource = (ep) => has(epFiles(ep).source)
export const hasEnhanced = (ep) => {
  const f = epFiles(ep)
  return has(f.enhancedWav) && has(f.enhancedMp3)
}
export const hasFinal = (ep) => has(epFiles(ep).final)

/** Estado "de reposo" según los archivos (al cancelar o terminar algo). */
export function restingStatus(ep) {
  if (hasFinal(ep)) return 'ready'
  if (hasEnhanced(ep)) return ep.editState ? 'editing' : 'enhanced'
  if (hasSource(ep)) return 'downloaded'
  return 'discovered'
}

/** ¿Puede este visitante ver el episodio? Los de YouTube son de todos; las subidas, de quien las subió. */
export const canSeeEpisode = (viewer, ep) => !!ep && (viewer?.role !== 'guest' || ep.owner == null || ep.owner === viewer.owner)

export function visibleEpisode(req, id) {
  const ep = getEpisode(id)
  if (!canSeeEpisode(req.viewer, ep)) throw new HttpError(404, 'NOT_FOUND', 'El episodio no existe.')
  return ep
}

export function mustGetEpisode(id) {
  const ep = getEpisode(id)
  if (!ep) throw new HttpError(404, 'NOT_FOUND', 'El episodio no existe.')
  return ep
}

/** Serializa al formato del contrato. */
export function episodeToApi(ep) {
  if (!ep) return null
  const base = `/api/episodes/${ep.id}/audio`
  const job = ep.jobId ? getJob(ep.jobId) : null
  return {
    id: ep.id,
    source: ep.source,
    youtubeVideoId: ep.youtubeId ?? null,
    youtubeUrl: ep.youtubeId ? `https://www.youtube.com/watch?v=${ep.youtubeId}` : null,
    title: ep.title,
    publishedAt: ep.publishedAt ?? null,
    durationSec: ep.durationSec ?? null,
    thumbnailUrl: ep.thumbnailUrl ?? null,
    status: ep.status,
    progress: ep.progress ?? null,
    retry: ep.status === 'youtube_processing' ? ep.retry ?? null : null,
    error: ep.status === 'error' ? ep.error ?? null : null,
    jobId: ep.jobId ?? null,
    job: job ? { id: job.id, status: job.status, percent: job.progress?.percent ?? 0, stage: job.progress?.stage ?? null } : null,
    enhance: ep.enhance ?? null,
    files: {
      source: hasSource(ep) ? `${base}/source` : null,
      enhanced: hasEnhanced(ep) ? `${base}/enhanced` : null,
      final: hasFinal(ep) ? `${base}/final` : null,
    },
    editState: ep.editState ?? null,
    export: ep.exportInfo ?? null,
    guest: ep.owner && ep.owner !== 'local' ? ep.owner : null,
    createdAt: ep.createdAt,
    updatedAt: ep.updatedAt,
  }
}

/** Dueño para el SSE: undefined = todos (YouTube); si no, el que subió el audio. */
export const audience = (ep) => ep.owner ?? undefined

export function emitEpisode(ep) {
  if (ep) broadcast('episode', episodeToApi(ep), audience(ep))
  return ep
}

/** Actualiza y avisa por SSE. */
export function setEpisode(id, patch) {
  return emitEpisode(updateEpisodeRow(id, patch))
}

/** Progreso de descarga/exportación: se guarda y se emite como evento ligero. */
export function setEpisodeProgress(ep, progress) {
  updateEpisodeRow(ep.id, { progress })
  broadcast('episodeProgress', { id: ep.id, progress }, audience(ep))
}
