// Backend simulado en memoria. MISMA interfaz que client.js.
// Simula la cola real: un trabajo a la vez, pending → processing (decoding → processing → merging) → done.
// El progreso avanza en segundos, pero etaSec/elapsedSec se reportan a escala realista.
//
// Trucos para probar:
//  - Un archivo cuyo nombre contenga "error" falla con GPU_OOM al ~35 % (Reintentar lo retoma).
//  - Recargar la página reinicia los datos.
//  - ?escenario=completo añade trabajos en todos los estados (procesando, en cola, pausado, cancelado).
//  - ?escenario=vacio empieza sin trabajos.
import { ApiError } from './client.js'
import { getAudioDuration } from '../lib/audio.js'
import { extOf } from '../lib/format.js'

export const isMock = true

const CONFIG = {
  modes: [
    { mode: 'denoise', quality: null, label: 'Limpiar ruido', description: 'Quita el ruido de fondo. Rápido.', factor: 0.06 },
    { mode: 'enhance', quality: 'standard', label: 'Mejora completa · Estándar', description: 'Voz tipo estudio. Buen balance.', factor: 0.68 },
    { mode: 'enhance', quality: 'max', label: 'Mejora completa · Máxima', description: 'La mejor calidad. Más lento.', factor: 1.02 },
  ],
  maxUploadMB: 500,
  acceptedTypes: ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4'],
  role: 'owner',
}

// Segundos reales que tarda la simulación de cada modo.
const SIM_SECONDS = { denoise: 10, standard: 28, max: 40 }
const DECODING_MS = 1500
const MERGING_MS = 3000
const TICK_MS = 250
const GROUP_SEC = 125 // 25 trozos × 5 s de avance (como el motor)

const jobs = new Map()
const sims = new Map() // id → { fraction, stageAt, failedOnce }
const listeners = new Set()
let health = {
  ok: true,
  ffmpeg: true,
  gpu: { name: 'NVIDIA GeForce RTX 3060', vramGB: 12, tempC: 52, busy: false },
}

const clone = (x) => structuredClone(x)
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const nowIso = () => new Date().toISOString()
const factorOf = (mode, quality) => CONFIG.modes.find((m) => m.mode === mode && (m.quality ?? null) === (quality ?? null))?.factor ?? 1

function emit(handler, data) {
  const payload = clone(data)
  setTimeout(() => listeners.forEach((l) => l[handler]?.(payload)), 0)
}

function randomId() {
  return 'j_' + Math.random().toString(36).slice(2, 8)
}

function makeJob({ filename, sizeBytes, durationSec, mode, quality, ...rest }) {
  return {
    id: randomId(),
    filename,
    sizeBytes,
    durationSec,
    mode,
    quality: mode === 'enhance' ? quality : null,
    status: 'pending',
    progress: null,
    estimatedSec: Math.round(durationSec * factorOf(mode, quality)),
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    error: null,
    outputs: null,
    guest: null,
    ...rest,
  }
}

function outputsFor(id) {
  return { mp3: `/api/jobs/${id}/audio/result.mp3`, wav: `/api/jobs/${id}/audio/result.wav` }
}

// --- Datos de ejemplo para no empezar en blanco ---
;(function seed() {
  const t = Date.now()
  const done = makeJob({
    filename: 'Charla del sábado.mp3',
    sizeBytes: 27_400_000,
    durationSec: 2890.4,
    mode: 'denoise',
    quality: null,
    status: 'done',
    createdAt: new Date(t - 2 * 3600e3).toISOString(),
    startedAt: new Date(t - 2 * 3600e3 + 3e3).toISOString(),
    finishedAt: new Date(t - 2 * 3600e3 + 175e3).toISOString(),
  })
  done.progress = { percent: 100, done: 24, total: 24, elapsedSec: 172, etaSec: 0, stage: 'processing' }
  done.outputs = outputsFor(done.id)

  const failed = makeJob({
    filename: 'Conferencia - Keynote.m4a',
    sizeBytes: 41_900_000,
    durationSec: 2512.7,
    mode: 'enhance',
    quality: 'max',
    status: 'error',
    createdAt: new Date(t - 50 * 60e3).toISOString(),
    startedAt: new Date(t - 50 * 60e3 + 2e3).toISOString(),
  })
  failed.progress = { percent: 61.9, done: 13, total: 21, elapsedSec: 1590, etaSec: 980, stage: 'processing' }
  failed.error = {
    code: 'GPU_OOM',
    message: 'La GPU se quedó sin memoria. Cierra otros programas que usen la GPU y pulsa Reintentar: seguirá donde quedó.',
  }
  sims.set(failed.id, { fraction: 13 / 21, failedOnce: true })

  done.id = 'j_demo01'
  done.outputs = outputsFor(done.id)
  const list = [done, failed]

  const scenario = new URLSearchParams(window.location.search).get('escenario')
  if (scenario === 'vacio') return
  if (scenario === 'completo') {
    const running = makeJob({
      filename: 'Podcast - Episodio 12.mp3',
      sizeBytes: 31_701_737,
      durationSec: 3395.03,
      mode: 'enhance',
      quality: 'standard',
      createdAt: new Date(t - 20 * 60e3).toISOString(),
    })
    sims.set(running.id, { fraction: 0.42, failedOnce: false })
    running.progress = { percent: 42.9, done: 12, total: 28, elapsedSec: 990, etaSec: 1320, stage: 'processing' }
    const queued = makeJob({ filename: 'Entrevista con invitada.mp3', sizeBytes: 22_100_000, durationSec: 2700, mode: 'denoise', quality: null, guest: 'k7m2qx', createdAt: new Date(t - 5 * 60e3).toISOString() })
    const paused = makeJob({ filename: 'Clase grabada - Módulo 3.wav', sizeBytes: 298_000_000, durationSec: 3540, mode: 'enhance', quality: 'max', status: 'paused', createdAt: new Date(t - 30 * 60e3).toISOString() })
    paused.progress = { percent: 18.5, done: 5, total: 27, elapsedSec: 640, etaSec: 2900, stage: 'processing' }
    sims.set(paused.id, { fraction: 5 / 27, failedOnce: false })
    const canceled = makeJob({ filename: 'Prueba de micrófono.m4a', sizeBytes: 3_200_000, durationSec: 312, mode: 'denoise', quality: null, status: 'canceled', createdAt: new Date(t - 3 * 3600e3).toISOString(), finishedAt: new Date(t - 3 * 3600e3 + 60e3).toISOString() })
    list.push(running, queued, paused, canceled)
  }
  for (const j of list) jobs.set(j.id, j)
})()

// --- Simulación de la cola ---
function updateHealth() {
  const busy = [...jobs.values()].some((j) => j.status === 'processing')
  const target = busy ? 79 : 52
  const temp = health.gpu.tempC + Math.sign(target - health.gpu.tempC) * Math.min(Math.abs(target - health.gpu.tempC), 2)
  const changed = busy !== health.gpu.busy
  health = { ...health, gpu: { ...health.gpu, busy, tempC: Math.round(temp) } }
  return changed
}

function startNext() {
  const next = [...jobs.values()]
    .filter((j) => j.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  if (!next) return
  const total = Math.max(4, Math.ceil(next.durationSec / GROUP_SEC))
  const sim = sims.get(next.id) ?? { fraction: 0, failedOnce: false }
  sim.stageAt = Date.now()
  sims.set(next.id, sim)
  next.status = 'processing'
  next.startedAt ??= nowIso()
  next.error = null
  next.progress = {
    percent: next.progress?.percent ?? 0,
    done: next.progress?.done ?? 0,
    total,
    elapsedSec: next.progress?.elapsedSec ?? 0,
    etaSec: next.estimatedSec * (1 - sim.fraction),
    stage: 'decoding',
  }
  emit('onJob', next)
}

function tick() {
  const current = [...jobs.values()].find((j) => j.status === 'processing')
  if (!current) {
    startNext()
  } else {
    const sim = sims.get(current.id)
    const p = current.progress
    const since = Date.now() - sim.stageAt

    if (p.stage === 'decoding' && since >= DECODING_MS) {
      p.stage = 'processing'
      sim.stageAt = Date.now()
      emit('onProgress', { id: current.id, progress: p })
    } else if (p.stage === 'processing') {
      const simSec = SIM_SECONDS[current.mode === 'denoise' ? 'denoise' : current.quality]
      sim.fraction = Math.min(1, sim.fraction + TICK_MS / 1000 / simSec)
      const done = Math.floor(sim.fraction * p.total + 1e-9)
      if (done !== p.done) {
        p.done = done
        p.percent = Math.round((done / p.total) * 1000) / 10
        p.elapsedSec = Math.round(sim.fraction * current.estimatedSec * 10) / 10
        // ETA con un poco de ruido, como la estimación real
        const jitter = 1 + (Math.random() - 0.5) * 0.08
        p.etaSec = Math.max(0, Math.round((1 - sim.fraction) * current.estimatedSec * jitter))
        if (done === p.total) {
          p.stage = 'merging'
          p.etaSec = 0
          sim.stageAt = Date.now()
        }
        emit('onProgress', { id: current.id, progress: p })

        if (/error/i.test(current.filename) && !sim.failedOnce && p.percent >= 35) {
          sim.failedOnce = true
          current.status = 'error'
          current.error = {
            code: 'GPU_OOM',
            message: 'La GPU se quedó sin memoria. Cierra otros programas que usen la GPU y pulsa Reintentar: seguirá donde quedó.',
          }
          emit('onJob', current)
        }
      }
    } else if (p.stage === 'merging' && since >= MERGING_MS) {
      current.status = 'done'
      current.finishedAt = nowIso()
      current.outputs = outputsFor(current.id)
      p.percent = 100
      sims.delete(current.id)
      emit('onJob', current)
    }
  }
  if (updateHealth()) emit('onHealth', health)
}

setInterval(tick, TICK_MS)
setInterval(() => emit('onHealth', health), 4000)

// --- Interfaz pública (igual que client.js) ---
function mustGet(id) {
  const job = jobs.get(id)
  if (!job) throw new ApiError('El trabajo no existe.', { code: 'NOT_FOUND', status: 404 })
  return job
}

function conflict(message) {
  return new ApiError(message, { code: 'CONFLICT', status: 409 })
}

export async function getHealth() {
  await delay(120)
  return clone(health)
}

export async function getConfig() {
  await delay(150)
  return clone(CONFIG)
}

export async function listJobs() {
  await delay(350)
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(clone)
}

export async function getJob(id) {
  await delay(80)
  return clone(mustGet(id))
}

export async function createJob(file, { mode, quality }, { onProgress, signal } = {}) {
  if (!CONFIG.acceptedTypes.includes(extOf(file.name))) {
    throw new ApiError('Formato no soportado. Usa MP3, WAV, M4A, AAC, OGG, FLAC o MP4.', { code: 'INVALID_FILE', status: 400 })
  }
  if (file.size > CONFIG.maxUploadMB * 1024 * 1024) {
    throw new ApiError('El archivo supera el tamaño máximo permitido.', { code: 'TOO_LARGE', status: 413 })
  }
  const durationSec = (await getAudioDuration(file)) ?? 3395.03

  // Subida simulada (más lenta cuanto más pesa el archivo, máx. ~3 s)
  const totalMs = Math.min(3000, 900 + file.size / 50_000)
  const start = Date.now()
  await new Promise((resolve, reject) => {
    const abort = () => {
      clearInterval(timer)
      reject(new DOMException('Subida cancelada', 'AbortError'))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setInterval(() => {
      const f = Math.min(1, (Date.now() - start) / totalMs)
      onProgress?.(f, Math.round(f * file.size), file.size)
      if (f >= 1) {
        clearInterval(timer)
        signal?.removeEventListener('abort', abort)
        resolve()
      }
    }, 80)
  })

  const job = makeJob({ filename: file.name, sizeBytes: file.size, durationSec, mode, quality })
  jobs.set(job.id, job)
  emit('onJob', job)
  return clone(job)
}

export async function pauseJob(id) {
  await delay(200)
  const job = mustGet(id)
  if (job.status !== 'processing') throw conflict('Solo se puede pausar un trabajo en proceso.')
  job.status = 'paused'
  emit('onJob', job)
  return clone(job)
}

export async function resumeJob(id) {
  await delay(200)
  const job = mustGet(id)
  if (!['paused', 'error'].includes(job.status)) throw conflict('Solo se puede reanudar un trabajo pausado o con error.')
  job.status = 'pending'
  job.error = null
  emit('onJob', job)
  return clone(job)
}

export async function cancelJob(id) {
  await delay(200)
  const job = mustGet(id)
  if (!['pending', 'processing', 'paused'].includes(job.status)) throw conflict('Este trabajo ya no se puede cancelar.')
  job.status = 'canceled'
  job.finishedAt = nowIso()
  sims.delete(id)
  emit('onJob', job)
  return clone(job)
}

export async function deleteJob(id) {
  await delay(200)
  const job = mustGet(id)
  if (job.status === 'processing') throw conflict('Pausa o cancela el trabajo antes de eliminarlo.')
  jobs.delete(id)
  sims.delete(id)
  emit('onDeleted', { id })
  return null
}

export async function getWaveform(_id, which) {
  const res = await fetch(`/mock/peaks-${which === 'original' ? 'original' : 'result'}.json`)
  if (!res.ok) throw new ApiError('No hay forma de onda de prueba. Ejecuta: npm run mock:assets', { status: res.status })
  return res.json()
}

export function audioUrl(_job, which) {
  return which === 'original' ? '/mock/original.mp3' : '/mock/result.mp3'
}

export function downloadUrl(_job, format) {
  return `/mock/result.${format}`
}

export function subscribeEvents(handlers) {
  listeners.add(handlers)
  setTimeout(() => handlers.onOpen?.(), 0)
  return () => listeners.delete(handlers)
}
