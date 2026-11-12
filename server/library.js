// Biblioteca: orquesta el recorrido de cada episodio.
//
//   YouTube:  discovered → downloading → downloaded ─┐
//                  ↕ youtube_processing (reintento)   │
//   Subida:   (el upload crea el episodio y su Job) ──┼─→ enhancing (Job en la cola de la GPU)
//                                                     │        ↓ (al terminar el Job: enlaces duros)
//                                                     └── enhanced → editing → exporting → ready
//
// La mejora sigue siendo un Job normal (queue.js): misma cola, pausa/reanudar, estimaciones.
// Los archivos se comparten con enlaces duros (sin duplicar espacio): borrar un Job no borra
// el audio del episodio, y viceversa.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import {
  ASSETS_DIR, MIN_FREE_BYTES, MIN_FREE_BYTES_PER_SEC, PEAKS_PER_SEC, RSS_SYNC_HOURS,
  VOD_RETRY_MAX_HOURS, VOD_RETRY_MIN, jobDir,
} from './config.js'
import {
  deleteEpisodeRow, episodesByStatus, getAsset, getEpisode, getJob, getSetting, insertEpisode,
  insertJob, jobsByEpisode, jobsWithoutEpisode, listEpisodes, setSetting, updateEpisodeRow, updateJob,
  getWorkspace, listWorkspaces,
} from './db.js'
import {
  emitEpisode, epFiles, hasEnhanced, hasFinal, hasSource, mustGetEpisode, newEpisodeId,
  restingStatus, setEpisode, setEpisodeProgress, audience,
} from './episodes.js'
import { broadcast } from './events.js'
import { HttpError } from './errors.js'
import { factorFor, files as jobFiles, findMode, newJobId, resultsExist, toApi as jobToApi } from './jobs.js'
import { freeBytes, linkOrCopy, probe, probeAudio } from './media.js'
import { jobHooks, kick, resume as resumeJob } from './queue.js'
import { cancelTask, enqueueTask, hasTask } from './tasks.js'
import { downloadAudio, videoInfo, YtError } from './ytdlp.js'
import { ExportError, exportAudio, normalizePreset } from './exporter.js'
import { syncCatalog } from './catalog.js'
import { curtainDefaults, defaultWorkspace, setCurtainDefaults } from './workspaces.js'
import { getWaveform } from './waveform.js'
import { log } from './log.js'

const nowIso = () => new Date().toISOString()
const ACTIVE_JOB = ['pending', 'processing', 'paused']
const cleanTitle = (s) => String(s ?? '').replace(/[\\/]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Sin título'
const stripExt = (name) => name.replace(/\.[^.]+$/, '')

export const assetPath = (a) => path.join(ASSETS_DIR, `${a.id}${a.ext}`)

// ===========================================================================
// Arranque
// ===========================================================================
let timers = []

export async function initLibrary() {
  jobHooks.onChange = onJobChange
  jobHooks.onRemove = onJobRemove
  await backfillUploads()
  await recoverEpisodes()
  // Reintentos del VOD: revisar cada minuto si a alguno le toca
  timers.push(setInterval(retryDueVods, 60_000))
  // RSS periódico de cada espacio con canal: solo DETECTA streams nuevos; nunca descarga ni procesa solo
  if (RSS_SYNC_HOURS > 0) {
    const rss = async () => {
      for (const ws of listWorkspaces().filter((w) => w.channelId)) {
        await syncCatalog(ws, { full: false }).catch((e) => log(`RSS de "${ws.name}": ${e.message}`))
      }
    }
    setTimeout(rss, 5_000).unref()
    timers.push(setInterval(rss, RSS_SYNC_HOURS * 3600_000))
  }
  for (const t of timers) t.unref?.()
}

export function stopLibrary() {
  for (const t of timers) clearInterval(t)
  timers = []
}

/** Tras un reinicio: re-encolar descargas/exportaciones a medias y ajustar estados. */
async function recoverEpisodes() {
  for (const ep of episodesByStatus('downloading')) {
    log(`↺ descarga pendiente: ${ep.id}`)
    enqueueTask(ep.id, 'download', (ctx) => runDownload(ep.id, ctx))
  }
  for (const ep of episodesByStatus('exporting')) {
    log(`↺ exportación pendiente: ${ep.id}`)
    enqueueTask(ep.id, 'export', (ctx) => runExport(ep.id, ctx))
  }
  // Episodios "mejorando" cuyo trabajo ya no existe o ya terminó
  for (const ep of episodesByStatus('enhancing')) {
    const job = ep.jobId ? getJob(ep.jobId) : null
    if (!job) updateEpisodeRow(ep.id, { status: restingStatus(ep), jobId: null })
    else if (job.status === 'done' && !hasEnhanced(ep)) await adoptResult(job, ep).catch((e) => log(`adoptar ${job.id}: ${e.message}`))
    else if (!ACTIVE_JOB.includes(job.status)) onJobChange(job)
  }
}

/**
 * Trabajos subidos antes de que existiera la biblioteca: se les crea su episodio (UNA sola vez),
 * así todo el audio queda centralizado. Solo crea enlaces duros; no modifica ni mueve nada.
 * Después ya no se repite: un episodio borrado a propósito no debe volver a aparecer.
 */
async function backfillUploads() {
  if (getSetting('uploadsBackfilled', false)) return
  for (const job of jobsWithoutEpisode()) {
    const f = jobFiles(job)
    if (!fs.existsSync(f.original)) continue
    try {
      const ep = await createUploadEpisode(job, { quiet: true })
      if (job.status === 'done' && resultsExist(job)) await adoptResult(getJob(job.id), ep)
      else onJobChange(getJob(job.id))
      log(`+ episodio ${ep.id} para el trabajo existente ${job.id}`)
    } catch (e) {
      log(`no se pudo crear el episodio de ${job.id}: ${e.message}`)
    }
  }
  setSetting('uploadsBackfilled', true)
}

// ===========================================================================
// Subidas manuales → episodio
// ===========================================================================
/**
 * Crea el episodio de un Job recién subido (y lo enlaza). El audio se comparte por enlace duro.
 * `episodeId` permite reservar el id antes de insertar el Job.
 */
export async function createUploadEpisode(job, { episodeId = newEpisodeId(), quiet = false } = {}) {
  const now = nowIso()
  const ep = {
    id: episodeId,
    workspaceId: job.workspaceId ?? defaultWorkspace()?.id ?? null,
    source: 'upload',
    youtubeId: null,
    owner: job.owner ?? 'local',
    title: cleanTitle(stripExt(job.filename)),
    publishedAt: job.createdAt ?? now,
    durationSec: job.durationSec,
    thumbnailUrl: null,
    status: 'enhancing',
    sourceExt: job.ext,
    jobId: job.id,
    createdAt: job.createdAt ?? now,
    updatedAt: now,
  }
  const f = epFiles(ep)
  await fsp.mkdir(f.dir, { recursive: true })
  await linkOrCopy(jobFiles(job).original, f.source)
  const saved = insertEpisode(ep)
  if (job.episodeId !== ep.id) updateJob(job.id, { episodeId: ep.id })
  if (!quiet) emitEpisode(saved)
  return saved
}

// ===========================================================================
// Mejorar desde la biblioteca (POST /api/jobs con episodeId)
// ===========================================================================
export async function createJobFromEpisode(ep, { mode, quality }, viewer) {
  const m = findMode(mode, mode === 'enhance' ? quality : null)
  if (!m || (mode === 'enhance' && !['standard', 'max'].includes(quality))) throw new HttpError(400, 'INVALID_REQUEST', 'Modo o calidad no válidos.')
  if (!hasSource(ep)) throw new HttpError(409, 'CONFLICT', 'Este episodio todavía no tiene audio. Descárgalo primero.')
  const current = ep.jobId ? getJob(ep.jobId) : null
  if (current && ACTIVE_JOB.includes(current.status)) throw new HttpError(409, 'CONFLICT', 'Este episodio ya se está mejorando.')
  if (['downloading', 'exporting'].includes(ep.status)) throw new HttpError(409, 'CONFLICT', 'Espera a que termine la tarea en curso de este episodio.')

  const f = epFiles(ep)
  const durationSec = ep.durationSec ?? (await probe(f.source))
  if (!durationSec) throw new HttpError(400, 'INVALID_FILE', 'El audio del episodio no es válido o está dañado.')
  const needed = MIN_FREE_BYTES + durationSec * MIN_FREE_BYTES_PER_SEC
  if ((await freeBytes()) < needed) throw new HttpError(507, 'DISK_FULL', `No hay espacio suficiente en disco: se necesitan ~${Math.ceil(needed / 1024 ** 3)} GB libres.`)

  const id = newJobId()
  const dir = jobDir(id)
  await fsp.mkdir(dir, { recursive: true })
  try {
    const original = path.join(dir, `original${ep.sourceExt}`)
    await linkOrCopy(f.source, original)
    const sizeBytes = (await fsp.stat(original)).size
    const job = insertJob({
      id,
      filename: `${cleanTitle(ep.title)}${ep.sourceExt}`,
      ext: ep.sourceExt,
      sizeBytes,
      durationSec: Math.round(durationSec * 100) / 100,
      mode,
      quality: mode === 'enhance' ? quality : null,
      status: 'pending',
      progress: null,
      estimatedSec: Math.round(durationSec * factorFor(mode, quality)),
      createdAt: nowIso(),
      activeSec: 0,
      owner: viewer?.owner ?? 'local',
      episodeId: ep.id,
      workspaceId: ep.workspaceId,
    })
    log(`+ ${job.id} desde episodio ${ep.id} (${mode}${job.quality ? '/' + job.quality : ''})`)
    broadcast('job', jobToApi(job), job.owner)
    setEpisode(ep.id, { status: 'enhancing', jobId: job.id, error: null, progress: null })
    kick()
    const jf = jobFiles(job)
    getWaveform(jf.original, jf.waveform('original'), job.durationSec).catch((e) => log(`onda original ${job.id}: ${e.message}`))
    return job
  } catch (e) {
    await fsp.rm(dir, { recursive: true, force: true })
    throw e
  }
}

// ===========================================================================
// Ganchos de la cola de la GPU
// ===========================================================================
function onJobChange(job) {
  if (!job?.episodeId) return
  const ep = getEpisode(job.episodeId)
  if (!ep || ep.jobId !== job.id) return
  switch (job.status) {
    case 'pending':
    case 'processing':
    case 'paused':
      if (ep.status !== 'enhancing' || ep.error) setEpisode(ep.id, { status: 'enhancing', error: null })
      else emitEpisode(ep) // refresca el resumen del Job embebido
      break
    case 'done':
      adoptResult(job, ep).catch((e) => {
        log(`no se pudo enlazar el resultado de ${job.id}: ${e.message}`)
        setEpisode(ep.id, { status: 'error', error: { code: 'ENGINE_FAILED', message: 'La mejora terminó pero no se pudo guardar el resultado en la biblioteca.', step: 'enhance' } })
      })
      break
    case 'error':
      setEpisode(ep.id, { status: 'error', error: { ...(job.error ?? { code: 'ENGINE_FAILED', message: 'La mejora falló.' }), step: 'enhance' } })
      break
    case 'canceled':
      setEpisode(ep.id, { status: restingStatus(ep), error: null })
      break
  }
}

function onJobRemove(job) {
  if (!job?.episodeId) return
  const ep = getEpisode(job.episodeId)
  if (!ep || ep.jobId !== job.id) return
  const patch = { jobId: null }
  if (ep.status === 'enhancing' || (ep.status === 'error' && ep.error?.step === 'enhance')) Object.assign(patch, { status: restingStatus(ep), error: null })
  setEpisode(ep.id, patch)
}

/** Job terminado: el resultado pasa a ser el audio mejorado del episodio. */
async function adoptResult(job, ep) {
  const jf = jobFiles(job)
  const f = epFiles(ep)
  await fsp.mkdir(f.dir, { recursive: true })
  await linkOrCopy(jf.wav, f.enhancedWav)
  await linkOrCopy(jf.mp3, f.enhancedMp3)
  await fsp.rm(f.peaks, { force: true }) // la onda anterior ya no corresponde
  const fresh = getEpisode(ep.id)
  const updated = setEpisode(ep.id, {
    status: fresh.editState ? 'editing' : 'enhanced',
    enhance: { mode: job.mode, quality: job.mode === 'enhance' ? job.quality : null },
    error: null,
  })
  log(`✓ episodio ${ep.id}: audio mejorado listo`)
  // Picos del editor en segundo plano (CPU)
  episodePeaks(updated).catch((e) => log(`picos ${ep.id}: ${e.message}`))
}

// ===========================================================================
// Descargas (yt-dlp) y reintento del VOD
// ===========================================================================
export function requestDownload(ep, { keepRetry = false } = {}) {
  if (ep.source !== 'youtube') throw new HttpError(409, 'CONFLICT', 'Este audio no viene de YouTube.')
  if (hasSource(ep)) throw new HttpError(409, 'CONFLICT', 'Este episodio ya está descargado.')
  if (hasTask(ep.id)) return ep
  const updated = setEpisode(ep.id, {
    status: 'downloading',
    progress: { stage: 'queued', percent: null },
    error: null,
    retry: keepRetry ? ep.retry : null,
  })
  enqueueTask(ep.id, 'download', (ctx) => runDownload(ep.id, ctx))
  return updated
}

async function runDownload(id, { signal }) {
  let ep = getEpisode(id)
  if (!ep || ep.status !== 'downloading') return
  const f = epFiles({ ...ep, sourceExt: null })
  const fail = (code, message) => setEpisode(id, { status: 'error', progress: null, retry: null, error: { code, message, step: 'download' } })
  try {
    setEpisodeProgress(ep, { stage: 'checking', percent: null })
    // 1) Metadatos: ¿se puede descargar ya? (y fecha/duración exactas)
    const info = await videoInfo(ep.youtubeId, { signal })
    ep = updateEpisodeRow(id, {
      title: info.title || ep.title,
      durationSec: info.durationSec ?? ep.durationSec,
      publishedAt: info.publishedAt ?? ep.publishedAt,
    })
    if (info.liveStatus === 'is_upcoming') throw new YtError('upcoming', 'Este directo todavía no empieza. Descárgalo cuando haya terminado.')
    if (['is_live', 'post_live'].includes(info.liveStatus)) throw new YtError('processing', 'YouTube todavía está procesando este stream.')

    const needed = MIN_FREE_BYTES + (ep.durationSec ?? 3600) * 40_000
    if ((await freeBytes()) < needed) return fail('DISK_FULL', `No hay espacio suficiente en disco: se necesitan ~${Math.ceil(needed / 1024 ** 3)} GB libres.`)

    // 2) Descargar el mejor audio tal cual (m4a/opus), sin convertir
    await fsp.rm(f.downloadDir, { recursive: true, force: true })
    await fsp.mkdir(f.downloadDir, { recursive: true })
    const file = await downloadAudio(ep.youtubeId, f.downloadDir, {
      signal,
      onProgress: (p) => setEpisodeProgress(ep, { stage: 'downloading', ...p }),
    })
    const audio = await probeAudio(file)
    if (!audio) return fail('INVALID_FILE', 'El audio descargado está dañado. Pulsa Reintentar.')
    const ext = path.extname(file).toLowerCase()
    await fsp.rename(file, path.join(f.dir, `source${ext}`))
    await fsp.rm(f.downloadDir, { recursive: true, force: true })
    setEpisode(id, { status: 'downloaded', sourceExt: ext, durationSec: Math.round(audio.durationSec * 100) / 100, progress: null, retry: null, error: null })
    log(`↓ ${id} descargado (${ext}, ${Math.round(audio.durationSec)} s)`)
  } catch (e) {
    if (signal.aborted) {
      // Apagado: queda 'downloading' y se reanuda al arrancar. Cancelación: vuelve a su estado.
      if (signal.reason !== 'shutdown') {
        await fsp.rm(f.downloadDir, { recursive: true, force: true })
        const cur = getEpisode(id)
        setEpisode(id, { status: restingStatus(cur), progress: null, retry: null })
      }
      return
    }
    if (e instanceof YtError && e.kind === 'processing') return scheduleVodRetry(id, e)
    if (e instanceof YtError) {
      const code = { upcoming: 'NOT_STARTED', unavailable: 'VIDEO_UNAVAILABLE', network: 'NETWORK', blocked: 'YTDLP_BLOCKED', missing: 'YTDLP_MISSING' }[e.kind] ?? 'YTDLP_FAILED'
      log(`✗ descarga ${id}: ${e.kind} ${e.detail ?? ''}`)
      return fail(code, e.message)
    }
    log(`✗ descarga ${id}: ${e.stack ?? e.message}`)
    fail('YTDLP_FAILED', `La descarga falló: ${e.message}`)
  }
}

/**
 * El stream terminó pero YouTube aún lo está procesando (puede tardar hasta ~12 h).
 * No es un error: queda en espera y se reintenta cada VOD_RETRY_MIN minutos hasta VOD_RETRY_MAX_HOURS.
 */
function scheduleVodRetry(id, e) {
  const ep = getEpisode(id)
  const now = Date.now()
  const prev = ep.retry
  const firstAt = prev?.firstAt ?? new Date(now).toISOString()
  const giveUpAt = prev?.giveUpAt ?? new Date(now + VOD_RETRY_MAX_HOURS * 3600_000).toISOString()
  const attempts = (prev?.attempts ?? 0) + 1
  if (now >= Date.parse(giveUpAt)) {
    log(`✗ ${id}: YouTube sigue procesando tras ${VOD_RETRY_MAX_HOURS} h`)
    return setEpisode(id, {
      status: 'error',
      progress: null,
      retry: null,
      error: { code: 'VOD_TIMEOUT', message: `YouTube sigue procesando este stream después de ${VOD_RETRY_MAX_HOURS} h. Pulsa Reintentar más tarde.`, step: 'download' },
    })
  }
  const nextAt = new Date(Math.min(now + VOD_RETRY_MIN * 60_000, Date.parse(giveUpAt))).toISOString()
  log(`⏳ ${id}: YouTube aún procesa el stream (intento ${attempts}); próximo a las ${new Date(nextAt).toLocaleTimeString('es')}`)
  setEpisode(id, {
    status: 'youtube_processing',
    progress: null,
    error: null,
    retry: { attempts, firstAt, lastAttemptAt: new Date(now).toISOString(), nextAt, giveUpAt, intervalMin: VOD_RETRY_MIN, detail: e.detail || e.message },
  })
}

function retryDueVods() {
  const now = Date.now()
  for (const ep of episodesByStatus('youtube_processing')) {
    if (ep.retry?.nextAt && Date.parse(ep.retry.nextAt) <= now) {
      try {
        requestDownload(ep, { keepRetry: true })
      } catch (e) {
        log(`reintento ${ep.id}: ${e.message}`)
      }
    }
  }
}

// ===========================================================================
// Acciones genéricas
// ===========================================================================
/** "Reintentar" / "Reintentar ahora": continúa desde el paso que falló, sin rehacer los anteriores. */
export async function retryEpisode(ep) {
  if (ep.status === 'youtube_processing') return requestDownload(ep, { keepRetry: true })
  if (ep.status !== 'error') throw new HttpError(409, 'CONFLICT', 'No hay nada que reintentar en este episodio.')
  const step = ep.error?.step
  if (step === 'download') return requestDownload(ep)
  if (step === 'enhance') {
    const job = ep.jobId ? getJob(ep.jobId) : null
    if (job && ['error', 'paused'].includes(job.status)) {
      resumeJob(job.id)
      return getEpisode(ep.id)
    }
    return setEpisode(ep.id, { status: restingStatus(ep), error: null })
  }
  if (step === 'export') return requestExport(ep)
  return setEpisode(ep.id, { status: restingStatus(ep), error: null })
}

/** Cancela la descarga/exportación en curso, o deja de esperar a YouTube. */
export async function cancelEpisode(ep) {
  if (ep.status === 'youtube_processing') return setEpisode(ep.id, { status: restingStatus(ep), retry: null, progress: null })
  if (!['downloading', 'exporting'].includes(ep.status)) throw new HttpError(409, 'CONFLICT', 'No hay ninguna tarea en curso que cancelar.')
  const r = await cancelTask(ep.id)
  const cur = getEpisode(ep.id)
  // Si no había empezado (o no hay tarea), el runner no limpia: hacerlo aquí
  if (r !== 'aborted' || ['downloading', 'exporting'].includes(cur.status)) {
    await fsp.rm(epFiles(cur).downloadDir, { recursive: true, force: true })
    return setEpisode(ep.id, { status: restingStatus(cur), progress: null, retry: null })
  }
  return cur
}

export function renameEpisode(ep, title) {
  const t = cleanTitle(title)
  if (!String(title ?? '').trim()) throw new HttpError(400, 'INVALID_REQUEST', 'El título no puede estar vacío.')
  return setEpisode(ep.id, { title: t })
}

/**
 * Eliminar:
 *  - YouTube: borra los audios descargados/mejorados/exportados y vuelve a "discovered" (sigue en el catálogo).
 *  - Subida: borra el episodio completo.
 * El Job (si existe) no se toca: tiene sus propias copias por enlace duro.
 */
export async function deleteEpisode(ep) {
  const job = ep.jobId ? getJob(ep.jobId) : null
  if (job && ACTIVE_JOB.includes(job.status)) throw new HttpError(409, 'CONFLICT', 'Cancela la mejora en curso antes de eliminar el episodio.')
  if (hasTask(ep.id)) await cancelTask(ep.id)
  await fsp.rm(epFiles(ep).dir, { recursive: true, force: true })
  if (ep.source === 'upload') {
    deleteEpisodeRow(ep.id)
    broadcast('episodeDeleted', { id: ep.id }, audience(ep))
    // Sus trabajos quedan como trabajos sueltos (siguen en Mejorar, sin "Editar")
    for (const j of jobsByEpisode(ep.id)) {
      const updated = updateJob(j.id, { episodeId: null })
      broadcast('job', jobToApi(updated), updated.owner)
    }
    return null
  }
  return setEpisode(ep.id, {
    status: 'discovered', sourceExt: null, jobId: null, enhance: null, editState: null,
    exportInfo: null, progress: null, retry: null, error: null,
  })
}

// ===========================================================================
// Editor
// ===========================================================================
export async function episodePeaks(ep) {
  if (!hasEnhanced(ep)) throw new HttpError(404, 'NOT_READY', 'El audio mejorado todavía no está listo.')
  const f = epFiles(ep)
  let duration = ep.durationSec
  if (!duration) duration = await probe(f.enhancedMp3)
  return getWaveform(f.enhancedMp3, f.peaks, duration, { pointsPerSec: PEAKS_PER_SEC })
}

const MAX_CUTS = 500

/** Valida y guarda el estado del editor. También recuerda las cortinas como predeterminadas. */
export function saveEdit(ep, body) {
  if (!hasEnhanced(ep)) throw new HttpError(409, 'CONFLICT', 'Primero mejora el audio de este episodio.')
  if (ep.status === 'exporting') throw new HttpError(409, 'CONFLICT', 'Espera a que termine la exportación.')
  const dur = ep.durationSec ?? Infinity
  const rawCuts = Array.isArray(body?.cuts) ? body.cuts : []
  if (rawCuts.length > MAX_CUTS) throw new HttpError(400, 'INVALID_REQUEST', `Máximo ${MAX_CUTS} cortes.`)
  const cuts = rawCuts.map((c, i) => {
    const start = Number(c?.start)
    const end = Number(c?.end)
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start >= dur + 1) {
      throw new HttpError(400, 'INVALID_REQUEST', `El corte ${i + 1} tiene tiempos no válidos.`)
    }
    return { id: typeof c.id === 'string' ? c.id.slice(0, 40) : `c${i + 1}`, start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(end, dur) * 1000) / 1000 }
  })
  const introId = body?.introId ?? null
  const outroId = body?.outroId ?? null
  for (const id of [introId, outroId]) {
    const a = id ? getAsset(id) : null
    if (id && (!a || a.workspaceId !== ep.workspaceId)) throw new HttpError(400, 'INVALID_REQUEST', 'La cortina elegida no existe en este espacio.')
  }
  const editState = { cuts, introId, outroId, preset: normalizePreset(body?.preset), savedAt: nowIso() }
  // Las cortinas elegidas quedan como predeterminadas del espacio
  const ws = getWorkspace(ep.workspaceId)
  if (ws) setCurtainDefaults(ws, { introId, outroId })
  const status = ['enhancing', 'downloading'].includes(ep.status) ? ep.status : 'editing'
  return setEpisode(ep.id, { editState, status, error: ep.status === 'error' ? null : ep.error })
}

// ===========================================================================
// Exportación
// ===========================================================================
export function requestExport(ep) {
  if (!hasEnhanced(ep)) throw new HttpError(409, 'CONFLICT', 'Primero mejora el audio de este episodio.')
  if (hasTask(ep.id)) return ep
  const job = ep.jobId ? getJob(ep.jobId) : null
  if (job && ACTIVE_JOB.includes(job.status)) throw new HttpError(409, 'CONFLICT', 'Espera a que termine la mejora en curso.')
  const updated = setEpisode(ep.id, { status: 'exporting', progress: { stage: 'queued', percent: 0 }, error: null })
  enqueueTask(ep.id, 'export', (ctx) => runExport(ep.id, ctx))
  return updated
}

/** Artista/álbum de las etiquetas ID3: el nombre de podcast del espacio (o su nombre). */
function podcastNameFor(ep) {
  const ws = getWorkspace(ep.workspaceId) ?? defaultWorkspace()
  return ws?.podcastName || ws?.name || 'Podcast'
}

function resolveCurtain(id, which, workspaceId) {
  if (!id) return null
  const a = getAsset(id)
  if (!a || a.workspaceId !== workspaceId || !fs.existsSync(assetPath(a))) throw new ExportError('ASSET_MISSING', `La cortina de ${which} ya no existe. Elige otra en el editor.`)
  return { id: a.id, name: a.name, durationSec: a.durationSec, path: assetPath(a) }
}

async function runExport(id, { signal }) {
  const ep = getEpisode(id)
  if (!ep || ep.status !== 'exporting') return
  const f = epFiles(ep)
  const st = ep.editState ?? {}
  let lastEmit = 0
  try {
    const exportInfo = await exportAudio({
      enhancedPath: f.enhancedWav,
      outPath: f.final,
      cuts: st.cuts ?? [],
      intro: resolveCurtain(st.introId, 'entrada', ep.workspaceId),
      outro: resolveCurtain(st.outroId, 'salida', ep.workspaceId),
      preset: st.preset,
      meta: { title: ep.title, date: ep.publishedAt, podcastName: podcastNameFor(ep) },
      signal,
      onProgress: (percent, stage) => {
        const now = Date.now()
        if (now - lastEmit < 700 && percent < 98) return
        lastEmit = now
        setEpisodeProgress(ep, { stage, percent: Math.round(percent * 10) / 10 })
      },
    })
    setEpisode(id, { status: 'ready', exportInfo, progress: null, error: null })
    log(`♪ ${id} exportado: ${(exportInfo.sizeBytes / 1e6).toFixed(1)} MB, ${exportInfo.lufs} LUFS`)
  } catch (e) {
    if (signal.aborted) {
      if (signal.reason !== 'shutdown') setEpisode(id, { status: restingStatus(getEpisode(id)), progress: null })
      return
    }
    log(`✗ exportación ${id}: ${e.message}`)
    setEpisode(id, { status: 'error', progress: null, error: { code: e.code && /^[A-Z_]+$/.test(e.code) ? e.code : 'EXPORT_FAILED', message: e.message, step: 'export' } })
  }
}

export { listEpisodes, mustGetEpisode, hasFinal, curtainDefaults }
