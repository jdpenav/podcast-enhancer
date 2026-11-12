// Modelo Job: forma EXACTA del contrato (docs/API.md), rutas de archivos y estimaciones.
import fs from 'node:fs'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import { CALIBRATION_MIN_DURATION_SEC, CALIBRATION_SAMPLES, MODES, jobDir, workDir } from './config.js'
import { calibrationRatios } from './db.js'

export const newJobId = (() => {
  const gen = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)
  return () => `j_${gen()}`
})()

export const files = (job) => {
  const dir = jobDir(job.id)
  return {
    dir,
    work: workDir(job.id),
    original: path.join(dir, `original${job.ext}`),
    wav: path.join(dir, 'result.wav'),
    mp3: path.join(dir, 'result.mp3'),
    log: path.join(dir, 'engine.log'),
    waveform: (which) => path.join(dir, `waveform-${which}.json`),
  }
}

export function resultsExist(job) {
  const f = files(job)
  return fs.existsSync(f.wav) && fs.existsSync(f.mp3)
}

/** Serializa al formato del contrato (oculta campos internos: ext, pid, activeSec). */
export function toApi(job) {
  if (!job) return null
  return {
    id: job.id,
    filename: job.filename,
    sizeBytes: job.sizeBytes,
    durationSec: job.durationSec,
    mode: job.mode,
    quality: job.mode === 'denoise' ? null : job.quality,
    status: job.status,
    progress: job.progress ?? null,
    estimatedSec: job.estimatedSec,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    error: job.error ?? null,
    outputs:
      job.status === 'done'
        ? { mp3: `/api/jobs/${job.id}/audio/result.mp3`, wav: `/api/jobs/${job.id}/audio/result.wav` }
        : null,
    guest: job.owner && job.owner !== 'local' ? job.owner : null,
    episodeId: job.episodeId ?? null,
  }
}

/** ¿Puede este visitante ver el trabajo? El dueño ve todo; un invitado, solo lo suyo. */
export const canSee = (viewer, job) => !!job && (viewer?.role !== 'guest' || job.owner === viewer.owner)

/** Trabajo visible para el visitante o 404 (un id ajeno es indistinguible de uno inexistente). */
export function visibleJob(req, id, getJob) {
  const job = getJob(id)
  if (!canSee(req.viewer, job)) {
    const e = new Error('El trabajo no existe.')
    e.statusCode = 404
    e.code = 'NOT_FOUND'
    throw e
  }
  return job
}

export function findMode(mode, quality) {
  return MODES.find((m) => m.mode === mode && (mode === 'denoise' || m.quality === quality)) ?? null
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Factor de tiempo (s de proceso por s de audio). Empieza con el medido en una GPU de 4 GB
 * y se recalibra con la mediana de los últimos trabajos reales terminados (≥ 5 min).
 */
export function factorFor(mode, quality) {
  const m = findMode(mode, quality)
  if (!m) return null
  const ratios = calibrationRatios(m.mode, m.quality, CALIBRATION_MIN_DURATION_SEC, CALIBRATION_SAMPLES)
  return ratios.length ? Math.round(median(ratios) * 1000) / 1000 : m.factor
}

export function publicConfigModes() {
  return MODES.map((m) => ({
    mode: m.mode,
    quality: m.quality,
    label: m.label,
    description: m.description,
    factor: factorFor(m.mode, m.quality),
  }))
}
