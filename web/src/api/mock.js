// Backend simulado en memoria. MISMA interfaz que client.js.
// Simula la cola real: un trabajo a la vez, pending → processing (decoding → processing → merging) → done.
// El progreso avanza en segundos, pero etaSec/elapsedSec se reportan a escala realista.
//
// Trucos para probar:
//  - Un archivo cuyo nombre contenga "error" falla con GPU_OOM al ~35 % (Reintentar lo retoma).
//  - Recargar la página reinicia los datos.
//  - ?escenario=completo añade trabajos en todos los estados (procesando, en cola, pausado, cancelado).
//  - ?escenario=vacio empieza sin trabajos.
//  - Biblioteca: episodios en todos los estados; descargar/exportar se simulan en unos segundos.
//    Un episodio cuyo título contenga "privado" falla al descargar.
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
    episodeId: null,
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
      libraryJobDone(current)
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


// ===========================================================================
// Biblioteca (episodios), cortinas y sistema — misma interfaz que client.js
// ===========================================================================
const CONFIG_EXPORT = {
  podcastName: 'Mi podcast',
  exportPreset: { name: 'castbox', bitrateKbps: 128, channels: 1, sampleRate: 44100, lufs: -16, truePeak: -1, cutCrossfadeMs: 20, curtainFadeSec: 0 },
  presetLimits: { bitrateKbps: [64, 96, 128, 160, 192, 256, 320], channels: [1, 2], lufs: [-24, -12], cutCrossfadeMs: [0, 200], curtainFadeSec: [0, 5] },
}
Object.assign(CONFIG, CONFIG_EXPORT)

const episodes = new Map()
const assets = new Map()
let assetDefaults = { introId: 'a_intro', outroId: 'a_outro' }
const MOCK_PEAKS_SEC = 60 // los audios de prueba (public/mock) duran ~60 s

function makeEpisode(o) {
  const t = nowIso()
  return {
    id: o.id,
    source: o.source ?? 'youtube',
    youtubeVideoId: o.youtubeVideoId ?? null,
    youtubeUrl: o.youtubeVideoId ? `https://www.youtube.com/watch?v=${o.youtubeVideoId}` : null,
    title: o.title,
    publishedAt: o.publishedAt ?? t,
    durationSec: o.durationSec ?? 3390,
    thumbnailUrl: null,
    status: o.status ?? 'discovered',
    progress: null,
    retry: null,
    error: null,
    jobId: o.jobId ?? null,
    job: null,
    enhance: o.enhance ?? null,
    files: { source: null, enhanced: null, final: null, ...(o.files ?? {}) },
    editState: o.editState ?? null,
    export: o.export ?? null,
    guest: null,
    createdAt: t,
    updatedAt: t,
  }
}

const files = (id, ...which) => Object.fromEntries(which.map((w) => [w, `/api/episodes/${id}/audio/${w}`]))
const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString()

;(function seedLibrary() {
  if (new URLSearchParams(window.location.search).get('escenario') === 'vacio') return
  const preset = { ...CONFIG_EXPORT.exportPreset }
  const list = [
    makeEpisode({ id: 'yt_demo1', youtubeVideoId: 'demo1', title: 'Episodio 48 · Directo del domingo', publishedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), status: 'youtube_processing' }),
    makeEpisode({ id: 'yt_demo2', youtubeVideoId: 'demo2', title: 'Episodio 47 · Cómo empezar un proyecto', publishedAt: daysAgo(2), status: 'downloaded', files: files('yt_demo2', 'source') }),
    makeEpisode({ id: 'yt_demo3', youtubeVideoId: 'demo3', title: 'Episodio 46 · Preguntas de la audiencia', publishedAt: daysAgo(9), status: 'editing', enhance: { mode: 'enhance', quality: 'standard' }, files: files('yt_demo3', 'source', 'enhanced'), editState: { cuts: [{ id: 'c_a', start: 0, end: 4.2 }, { id: 'c_b', start: 31, end: 36.5 }], introId: 'a_intro', outroId: 'a_outro', preset, savedAt: nowIso() } }),
    makeEpisode({
      id: 'yt_demo4', youtubeVideoId: 'demo4', title: 'Episodio 45 · Entrevista con invitada', publishedAt: daysAgo(16), status: 'ready', enhance: { mode: 'enhance', quality: 'standard' }, files: files('yt_demo4', 'source', 'enhanced', 'final'),
      editState: { cuts: [{ id: 'c_c', start: 0, end: 3 }], introId: 'a_intro', outroId: 'a_outro', preset, savedAt: daysAgo(15) },
      export: fakeExport(3374.2, preset, daysAgo(14)),
    }),
    makeEpisode({ id: 'yt_demo5', youtubeVideoId: 'demo5', title: 'Episodio 44 · Lo que aprendimos este año', publishedAt: daysAgo(23) }),
    makeEpisode({ id: 'yt_demo6', youtubeVideoId: 'demo6', title: 'Episodio 43 · Ensayo (privado)', publishedAt: daysAgo(30) }),
    makeEpisode({ id: 'yt_demo7', youtubeVideoId: 'demo7', title: 'Episodio 42 · Herramientas que usamos', publishedAt: daysAgo(37) }),
    makeEpisode({ id: 'e_demo01', source: 'upload', title: 'Charla del sábado', publishedAt: daysAgo(0.1), status: 'enhanced', jobId: 'j_demo01', enhance: { mode: 'denoise', quality: null }, files: files('e_demo01', 'source', 'enhanced') }),
  ]
  const r = list[0]
  r.retry = { attempts: 2, firstAt: new Date(Date.now() - 50 * 60e3).toISOString(), lastAttemptAt: new Date(Date.now() - 20 * 60e3).toISOString(), nextAt: new Date(Date.now() + 10 * 60e3).toISOString(), giveUpAt: new Date(Date.now() + 11 * 3600e3).toISOString(), intervalMin: 30 }
  for (const e of list) episodes.set(e.id, e)
  const demoJob = jobs.get('j_demo01')
  if (demoJob) demoJob.episodeId = 'e_demo01'
  assets.set('a_intro', { id: 'a_intro', name: 'Intro del podcast', filename: 'intro.mp3', durationSec: 12.4, sizeBytes: 198_000, createdAt: daysAgo(40), url: '/mock/original.mp3' })
  assets.set('a_outro', { id: 'a_outro', name: 'Outro con despedida', filename: 'outro.wav', durationSec: 18.1, sizeBytes: 3_190_000, createdAt: daysAgo(40), url: '/mock/result.mp3' })
})()

function fakeExport(durationSec, preset, exportedAt = nowIso()) {
  return {
    exportedAt, durationSec, expectedDurationSec: durationSec, sizeBytes: Math.round(durationSec * preset.bitrateKbps * 125),
    bitrateKbps: preset.bitrateKbps, sampleRate: 44100, channels: preset.channels, lufs: preset.lufs - 0.4, truePeak: -1.2, inputLufs: -27.9,
    removedSec: 3, cuts: 1, intro: { id: 'a_intro', name: 'Intro del podcast', durationSec: 12.4 }, outro: { id: 'a_outro', name: 'Outro con despedida', durationSec: 18.1 },
    preset, checks: { sizeOk: true, durationOk: true, loudnessOk: true }, castboxOk: true,
  }
}


function withJob(ep) {
  const j = ep.jobId ? jobs.get(ep.jobId) : null
  return { ...ep, job: j ? { id: j.id, status: j.status, percent: j.progress?.percent ?? 0, stage: j.progress?.stage ?? null } : null }
}
function saveEp(ep, patch) {
  Object.assign(ep, patch, { updatedAt: nowIso() })
  emit('onEpisode', withJob(ep))
  return clone(withJob(ep))
}
function mustEp(id) {
  const ep = episodes.get(id)
  if (!ep) throw new ApiError('El episodio no existe.', { code: 'NOT_FOUND', status: 404 })
  return ep
}
const resting = (ep) => (ep.files.final ? 'ready' : ep.files.enhanced ? (ep.editState ? 'editing' : 'enhanced') : ep.files.source ? 'downloaded' : 'discovered')

// Tareas simuladas (descarga / exportación), una a la vez
const taskQueue = []
let taskRunning = null
function runTasks() {
  if (taskRunning || !taskQueue.length) return
  const { id, kind } = taskQueue.shift()
  const ep = episodes.get(id)
  if (!ep) return runTasks()
  taskRunning = { id, timer: null }
  let pct = 0
  const total = kind === 'download' ? 52_000_000 : 0
  taskRunning.timer = setInterval(() => {
    pct = Math.min(100, pct + (kind === 'download' ? 4 : 3))
    if (kind === 'download') {
      if (/privado/i.test(ep.title) && pct >= 8) {
        finishTask()
        return saveEp(ep, { status: 'error', progress: null, error: { code: 'VIDEO_UNAVAILABLE', message: 'El video no está disponible (privado, borrado o restringido). Detalle: Private video', step: 'download' } })
      }
      ep.progress = { stage: pct < 6 ? 'checking' : 'downloading', percent: pct < 6 ? null : pct, downloadedBytes: Math.round((total * pct) / 100), totalBytes: total, speedBps: 6_400_000, etaSec: Math.round((100 - pct) / 4 * 0.25) }
    } else {
      ep.progress = { stage: pct < 45 ? 'measuring' : pct < 92 ? 'encoding' : 'validating', percent: pct }
    }
    emit('onEpisodeProgress', { id, progress: clone(ep.progress) })
    if (pct >= 100) {
      finishTask()
      if (kind === 'download') saveEp(ep, { status: 'downloaded', progress: null, retry: null, files: { ...ep.files, ...files(id, 'source') } })
      else {
        const preset = { ...CONFIG_EXPORT.exportPreset, ...(ep.editState?.preset ?? {}) }
        saveEp(ep, { status: 'ready', progress: null, export: fakeExport(ep.durationSec - 6, preset), files: { ...ep.files, ...files(id, 'final') } })
      }
    }
  }, 250)
}
function finishTask() {
  clearInterval(taskRunning?.timer)
  taskRunning = null
  setTimeout(runTasks, 0)
}
function enqueue(id, kind) {
  taskQueue.push({ id, kind })
  setTimeout(runTasks, 0)
}

function libraryJobDone(job) {
  const ep = job.episodeId && episodes.get(job.episodeId)
  if (!ep || ep.jobId !== job.id) return
  saveEp(ep, { status: ep.editState ? 'editing' : 'enhanced', enhance: { mode: job.mode, quality: job.quality }, files: { ...ep.files, ...files(ep.id, 'enhanced') } })
}

export async function listEpisodes() {
  await delay(150)
  return [...episodes.values()].map((e) => clone(withJob(e))).sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
}
export async function getEpisode(id) {
  await delay(80)
  return clone(withJob(mustEp(id)))
}
export async function renameEpisode(id, title) {
  await delay(120)
  return saveEp(mustEp(id), { title })
}
export async function syncEpisodes() {
  await delay(1800)
  const id = 'yt_demo_new'
  if (!episodes.has(id)) {
    episodes.set(id, makeEpisode({ id, youtubeVideoId: 'demonew', title: 'Episodio 49 · Recién terminado', publishedAt: new Date(Date.now() - 600e3).toISOString() }))
    emit('onLibrary', { reason: 'sync', added: 1, updated: 0 })
    return { added: 1, updated: 0, total: episodes.size, full: true, warnings: [] }
  }
  return { added: 0, updated: 0, total: episodes.size, full: true, warnings: [] }
}
export async function downloadEpisode(id) {
  await delay(150)
  const ep = mustEp(id)
  if (ep.files.source) throw conflict('Este episodio ya está descargado.')
  enqueue(id, 'download')
  return saveEp(ep, { status: 'downloading', progress: { stage: 'queued', percent: null }, error: null })
}
export async function retryEpisode(id) {
  await delay(150)
  const ep = mustEp(id)
  if (ep.status === 'youtube_processing' || ep.error?.step === 'download') return downloadEpisode(id)
  if (ep.error?.step === 'export') return exportEpisode(id)
  return saveEp(ep, { status: resting(ep), error: null })
}
export async function cancelEpisode(id) {
  await delay(150)
  const ep = mustEp(id)
  const i = taskQueue.findIndex((t) => t.id === id)
  if (i >= 0) taskQueue.splice(i, 1)
  if (taskRunning?.id === id) finishTask()
  return saveEp(ep, { status: resting(ep), progress: null, retry: null })
}
export async function deleteEpisode(id) {
  await delay(200)
  const ep = mustEp(id)
  if (ep.source === 'upload') {
    episodes.delete(id)
    emit('onEpisodeDeleted', { id })
    return null
  }
  return saveEp(ep, { status: 'discovered', files: { source: null, enhanced: null, final: null }, editState: null, export: null, enhance: null, jobId: null })
}
export async function getEpisodePeaks() {
  const res = await fetch('/mock/peaks-result.json')
  if (!res.ok) throw new ApiError('No hay forma de onda de prueba. Ejecuta: npm run mock:assets', { status: res.status })
  const w = await res.json()
  return { peaks: w.peaks, durationSec: w.durationSec ?? MOCK_PEAKS_SEC, pointsPerSec: 20 }
}
export async function saveEpisodeEdit(id, state) {
  await delay(200)
  const ep = mustEp(id)
  if (state.introId || state.outroId) assetDefaults = { introId: state.introId ?? null, outroId: state.outroId ?? null }
  return saveEp(ep, { editState: { ...state, savedAt: nowIso() }, status: 'editing' })
}
export async function exportEpisode(id) {
  await delay(150)
  const ep = mustEp(id)
  enqueue(id, 'export')
  return saveEp(ep, { status: 'exporting', progress: { stage: 'queued', percent: 0 }, error: null })
}
export async function createJobFromEpisode(episodeId, { mode, quality }) {
  await delay(250)
  const ep = mustEp(episodeId)
  const job = makeJob({ filename: `${ep.title}.m4a`, sizeBytes: 52_000_000, durationSec: ep.durationSec, mode, quality, episodeId })
  jobs.set(job.id, job)
  emit('onJob', job)
  saveEp(ep, { status: 'enhancing', jobId: job.id })
  return clone(job)
}
export const episodeAudioUrl = (_ep, which) => (which === 'source' ? '/mock/original.mp3' : '/mock/result.mp3')
export const episodeDownloadUrl = (_ep, which) => (which === 'source' ? '/mock/original.mp3' : '/mock/result.mp3')

export async function listAssets() {
  await delay(120)
  return { items: clone([...assets.values()]), defaults: { ...assetDefaults } }
}
export async function uploadAsset(file, name) {
  await delay(600)
  const id = randomId().replace('j_', 'a_')
  const a = { id, name: name || file.name.replace(/\.[^.]+$/, ''), filename: file.name, durationSec: 15, sizeBytes: file.size, createdAt: nowIso(), url: URL.createObjectURL(file) }
  assets.set(id, a)
  return clone(a)
}
export async function renameAsset(id, name) {
  await delay(120)
  const a = assets.get(id)
  a.name = name
  return clone(a)
}
export async function deleteAsset(id) {
  await delay(150)
  assets.delete(id)
  return null
}
export async function setAssetDefaults(d) {
  await delay(100)
  assetDefaults = { introId: d.introId ?? null, outroId: d.outroId ?? null }
  return { ...assetDefaults }
}
export const assetAudioUrl = (a) => a.url

export async function getSystem() {
  await delay(300)
  return {
    ytDlp: { installed: true, version: '2026.10.22', path: 'tools/bin/yt-dlp', canUpdate: true },
    ffmpeg: { installed: true, version: '4.4.2' },
    model: { present: true },
    disk: { freeBytes: 182e9, totalBytes: 251e9 },
    library: { channelUrl: 'https://www.youtube.com/@mi-canal/streams', vodRetryMin: 30, vodRetryMaxHours: 12, rssSyncHours: 3 },
  }
}
export async function updateYtdlp() {
  await delay(2500)
  return { ok: true, before: '2026.10.22', after: '2026.10.22', output: 'yt-dlp is up to date (stable@2026.10.22 from yt-dlp/yt-dlp)' }
}
