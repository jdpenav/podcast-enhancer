// Cola de trabajos (concurrencia 1) y máquina de estados del ciclo de vida.
//
//   pending ──► processing ──► done
//      ▲            │  ├──────► paused   (pausa, apagado del servidor, motor interrumpido)
//      │            │  └──────► error    (@@error o salida inesperada)
//      └─ resume ◄──┴─ paused / error
//   pending / processing / paused ──► canceled  (borra temporales)
//
// Garantías:
//  - Nunca hay dos motores a la vez: ni nuestros ni externos (un enhance_long lanzado a mano bloquea la cola).
//  - "done" solo cuando result.wav y result.mp3 existen (y se intentó calcular la onda).
//  - Al detener: SIGINT → SIGTERM → SIGKILL al grupo (ver procs.js). Sin huérfanos.
import fs from 'node:fs/promises'
import { spawnEngine } from './engine.js'
import { files, resultsExist, toApi } from './jobs.js'
import { deleteJobRow, getJob, jobsWithPid, jobsByStatus, nextPending, updateJob } from './db.js'
import { isAlive, listEngines, readArgv, isEngineArgv, stopEngine } from './procs.js'
import { broadcast } from './events.js'
import { getWaveform } from './waveform.js'

const now = () => new Date().toISOString()
export const log = (...a) => console.log(new Date().toLocaleTimeString('es'), ...a)

/** Trabajo en curso: { id, pid, child, intent, runStartMs, activeBefore, lastError, sawDone, exited: Promise } */
let current = null
let externalEngines = 0
let shuttingDown = false

export const isBusy = () => !!current || externalEngines > 0
export const currentJobId = () => current?.id ?? null

function emitJob(job) {
  broadcast('job', toApi(job), job.owner)
  return job
}

function setStatus(id, patch) {
  return emitJob(updateJob(id, patch))
}

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.statusCode = status
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// Arranque del siguiente trabajo
// ---------------------------------------------------------------------------
export function kick() {
  setImmediate(() => {
    if (current || shuttingDown) return
    refreshExternal()
    if (externalEngines > 0) return // otro enhance_long (no nuestro) está usando la GPU
    const job = nextPending()
    if (job) start(job)
  })
}

function refreshExternal() {
  const ours = current?.pid
  externalEngines = listEngines().filter((e) => e.pid !== ours && !e.ours).length
  return externalEngines
}

function start(job) {
  const prev = job.progress
  const progress = {
    percent: prev?.percent ?? 0,
    done: prev?.done ?? 0,
    total: prev?.total ?? 0,
    elapsedSec: job.activeSec ?? 0,
    etaSec: Math.round((job.estimatedSec ?? 0) * (1 - (prev?.percent ?? 0) / 100)),
    stage: 'decoding',
  }
  let resolveExit
  const run = {
    id: job.id,
    owner: job.owner,
    intent: null, // 'pause' | 'cancel' | 'shutdown'
    runStartMs: Date.now(),
    activeBefore: job.activeSec ?? 0,
    lastError: null,
    sawDone: false,
    exited: new Promise((r) => (resolveExit = r)),
  }
  current = run

  const { pid, child } = spawnEngine(job, {
    onEvent: (ev) => onEngineEvent(run, ev),
    onExit: (r) => onEngineExit(run, r).finally(resolveExit),
  })
  run.pid = pid
  run.child = child
  log(`▶ ${job.id} "${job.filename}" (${job.mode}${job.quality ? '/' + job.quality : ''}) pid=${pid}`)
  setStatus(job.id, { status: 'processing', startedAt: job.startedAt ?? now(), error: null, pid, progress })
}

function onEngineEvent(run, ev) {
  const job = getJob(run.id)
  if (!job) return
  const p = { ...(job.progress ?? {}) }
  const elapsed = () => Math.round((run.activeBefore + (Date.now() - run.runStartMs) / 1000) * 10) / 10

  switch (ev.event) {
    case 'start':
      p.total = ev.total
      p.done = ev.done
      p.percent = ev.total ? Math.round((ev.done / ev.total) * 1000) / 10 : 0
      break
    case 'stage':
      p.stage = ev.stage
      if (ev.stage === 'merging') p.etaSec = 0
      break
    case 'progress':
      p.done = ev.done
      p.total = ev.total
      p.percent = ev.percent
      p.etaSec = Math.round(ev.eta)
      p.stage = 'processing'
      break
    case 'error':
      run.lastError = { code: ev.code, message: ev.message }
      return
    case 'done':
      run.sawDone = true
      return
    default:
      return
  }
  p.elapsedSec = elapsed()
  updateJob(run.id, { progress: p })
  broadcast('progress', { id: run.id, progress: p }, run.owner)
}

async function onEngineExit(run, { code, signal, stderrTail }) {
  const job = getJob(run.id)
  const activeSec = Math.round((run.activeBefore + (Date.now() - run.runStartMs) / 1000) * 10) / 10
  current = null
  if (!job) return kick()
  const f = files(job)
  const base = { pid: null, activeSec }
  log(`■ ${job.id} salió code=${code} signal=${signal} intent=${run.intent ?? '-'}`)

  if (run.intent === 'cancel') {
    await rmWork(job)
    await Promise.all([fs.rm(f.wav, { force: true }), fs.rm(f.mp3, { force: true })])
    setStatus(job.id, { ...base, status: 'canceled', finishedAt: now() })
  } else if (code === 0 && run.sawDone && resultsExist(job)) {
    // Onda del resultado ANTES de anunciar "done" (el reproductor la pide de inmediato)
    try {
      await getWaveform(f.mp3, f.waveform('result'), job.durationSec)
    } catch (e) {
      log(`  (onda del resultado falló, se calculará al pedirla: ${e.message})`)
    }
    await rmWork(job)
    const p = job.progress ?? {}
    setStatus(job.id, {
      ...base,
      status: 'done',
      finishedAt: now(),
      progress: { ...p, percent: 100, done: p.total ?? p.done, etaSec: 0, elapsedSec: activeSec, stage: 'processing' },
    })
  } else if (run.intent === 'pause' || run.intent === 'shutdown' || code === 130) {
    // Pausa ordenada (SIGINT) o el motor se pausó solo (vigilante). El avance queda en work/.
    const p = job.progress ? { ...job.progress, stage: 'processing' } : null
    setStatus(job.id, { ...base, status: 'paused', progress: p })
  } else {
    setStatus(job.id, { ...base, status: 'error', error: run.lastError ?? inferError(stderrTail, code, signal) })
  }
  if (!shuttingDown) kick()
}

function inferError(stderrTail, code, signal) {
  const text = stderrTail.join('\n')
  if (/out of memory/i.test(text)) {
    return { code: 'GPU_OOM', message: 'La GPU se quedó sin memoria. Cierra otros programas que usen la GPU y pulsa Reintentar: seguirá donde quedó.' }
  }
  if (/ENOENT/.test(text)) {
    return { code: 'ENGINE_FAILED', message: 'No se encontró el entorno de Python (venv). Ejecuta "npm run setup".' }
  }
  const last = stderrTail.at(-1)?.slice(0, 200)
  return {
    code: 'ENGINE_FAILED',
    message: `El motor se detuvo inesperadamente${signal ? ` (${signal})` : code != null ? ` (código ${code})` : ''}. Pulsa Reintentar para seguir donde quedó.${last ? ` Detalle: ${last}` : ''}`,
  }
}

async function rmWork(job) {
  await fs.rm(files(job).work, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Acciones (rutas)
// ---------------------------------------------------------------------------
async function stopCurrent(intent) {
  const run = current
  if (!run) return
  run.intent ??= intent
  const how = await stopEngine(run.pid, { log })
  if (how === 'stuck') log(`⚠ el motor ${run.pid} no se pudo detener`)
  // Esperar a que onEngineExit actualice la base (máx. 15 s por seguridad)
  await Promise.race([run.exited, new Promise((r) => setTimeout(r, 15_000))])
}

export async function pause(id) {
  const job = mustGet(id)
  if (job.status !== 'processing' || current?.id !== id) throw new HttpError(409, 'CONFLICT', 'Solo se puede pausar un trabajo en proceso.')
  await stopCurrent('pause')
  return getJob(id)
}

export function resume(id) {
  const job = mustGet(id)
  if (!['paused', 'error'].includes(job.status)) throw new HttpError(409, 'CONFLICT', 'Solo se puede reanudar un trabajo pausado o con error.')
  const updated = setStatus(id, { status: 'pending', error: null, finishedAt: null })
  kick()
  return updated
}

export async function cancel(id) {
  const job = mustGet(id)
  if (!['pending', 'processing', 'paused'].includes(job.status)) throw new HttpError(409, 'CONFLICT', 'Este trabajo ya no se puede cancelar.')
  if (current?.id === id) {
    await stopCurrent('cancel')
    return getJob(id)
  }
  await rmWork(job)
  return setStatus(id, { status: 'canceled', finishedAt: now(), pid: null })
}

export async function remove(id) {
  const job = mustGet(id)
  if (job.status === 'processing' || current?.id === id) throw new HttpError(409, 'CONFLICT', 'Pausa o cancela el trabajo antes de eliminarlo.')
  await fs.rm(files(job).dir, { recursive: true, force: true })
  deleteJobRow(id)
  broadcast('deleted', { id }, job.owner)
}

function mustGet(id) {
  const job = getJob(id)
  if (!job) throw new HttpError(404, 'NOT_FOUND', 'El trabajo no existe.')
  return job
}

// ---------------------------------------------------------------------------
// Recuperación al arrancar y apagado ordenado
// ---------------------------------------------------------------------------
/**
 * Al arrancar el servidor:
 * 1. Trabajos con PID guardado: si ese motor sigue vivo (huérfano de una caída), detenerlo
 *    con pausa ordenada y marcar el trabajo como "paused".
 * 2. Cualquier otro motor que trabaje dentro de data/jobs/ (nuestro pero sin registro): detenerlo.
 * 3. "processing" sin proceso vivo → "paused".
 */
export async function recover() {
  for (const job of jobsWithPid()) {
    const argv = readArgv(job.pid)
    if (isAlive(job.pid) && isEngineArgv(argv) && argv.some((a) => a.includes(`/${job.id}/`))) {
      log(`↺ motor huérfano de ${job.id} (pid ${job.pid}): pausando…`)
      log(`  → ${await stopEngine(job.pid, { log })}`)
    }
    updateJob(job.id, { pid: null })
  }
  for (const e of listEngines().filter((x) => x.ours)) {
    log(`↺ motor sin registro en data/jobs (pid ${e.pid}, trabajo ${e.jobId}): deteniendo…`)
    log(`  → ${await stopEngine(e.pid, { log })}`)
  }
  for (const job of jobsByStatus('processing')) {
    log(`↺ ${job.id} estaba en proceso: queda en pausa`)
    updateJob(job.id, { status: 'paused', pid: null, progress: job.progress ? { ...job.progress, stage: 'processing' } : null })
  }
  refreshExternal()
  if (externalEngines) log(`⚠ hay ${externalEngines} motor(es) externo(s) usando la GPU: la cola espera a que terminen`)
}

/** Se llama periódicamente (con el health): si un motor externo terminó, reanudar la cola. */
export function tick() {
  const before = externalEngines
  refreshExternal()
  if (before > 0 && externalEngines === 0) {
    log('✓ la GPU quedó libre de motores externos')
    kick()
  } else if (!current) kick()
}

export async function shutdown() {
  shuttingDown = true
  if (current) {
    log(`⏸ apagando: pausando ${current.id}…`)
    await stopCurrent('shutdown')
  }
}

