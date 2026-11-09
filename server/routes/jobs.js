// Rutas de trabajos: crear (subida), listar, consultar, pausar, reanudar, cancelar, eliminar.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ACCEPTED_TYPES, DATA_DIR, GUEST_MAX_ACTIVE, MIN_FREE_BYTES, MIN_FREE_BYTES_PER_SEC, jobDir } from '../config.js'
import { canSee, factorFor, files, findMode, newJobId, toApi, visibleJob } from '../jobs.js'
import { activeCountByOwner, getJob, insertJob, listJobs } from '../db.js'
import { broadcast } from '../events.js'
import { getWaveform } from '../waveform.js'
import { HttpError, cancel, kick, log, pause, remove, resume } from '../queue.js'

const run = promisify(execFile)

/** Duración con ffprobe; null si no es un audio válido. */
async function probe(file) {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file],
      { timeout: 30_000 },
    )
    const info = JSON.parse(stdout)
    const hasAudio = info.streams?.some((s) => s.codec_type === 'audio')
    const duration = Number(info.format?.duration)
    return hasAudio && duration > 0 ? duration : null
  } catch (e) {
    if (e.code === 'ENOENT') throw new HttpError(500, 'FFMPEG_MISSING', 'Falta ffmpeg en el servidor. Instálalo con: sudo apt install ffmpeg')
    return null
  }
}

async function freeBytes() {
  try {
    const s = await fsp.statfs(DATA_DIR)
    return s.bavail * s.bsize
  } catch {
    return Infinity
  }
}

/** Invitados: máximo GUEST_MAX_ACTIVE trabajos pending/processing/paused a la vez. */
function checkGuestLimit(viewer) {
  if (viewer?.role !== 'guest') return
  if (activeCountByOwner(viewer.owner) >= GUEST_MAX_ACTIVE) {
    throw new HttpError(429, 'TOO_MANY_JOBS', `Ya tienes ${GUEST_MAX_ACTIVE} trabajos activos. Espera a que terminen o cancela uno.`)
  }
}

export default async function jobRoutes(app) {
  const { maxUploadMB, role } = app.limits
  const tooLargeMessage =
    role === 'guest'
      ? `El archivo supera ${maxUploadMB} MB, el máximo para subir por internet. Sube el MP3 (1 h de audio pesa 30–80 MB).`
      : `El archivo supera el máximo de ${maxUploadMB} MB.`

  app.get('/api/jobs', (req) => listJobs().filter((j) => canSee(req.viewer, j)).map(toApi))

  app.get('/api/jobs/:id', (req) => toApi(visibleJob(req, req.params.id, getJob)))

  app.post('/api/jobs/:id/pause', async (req) => {
    visibleJob(req, req.params.id, getJob)
    return toApi(await pause(req.params.id))
  })
  app.post('/api/jobs/:id/resume', (req) => {
    const job = visibleJob(req, req.params.id, getJob)
    // Un pausado ya cuenta como activo; reintentar uno con error suma uno más
    if (job.status === 'error') checkGuestLimit(req.viewer)
    return toApi(resume(req.params.id))
  })
  app.post('/api/jobs/:id/cancel', async (req) => {
    visibleJob(req, req.params.id, getJob)
    return toApi(await cancel(req.params.id))
  })
  app.delete('/api/jobs/:id', async (req, reply) => {
    visibleJob(req, req.params.id, getJob)
    await remove(req.params.id)
    return reply.code(204).send()
  })

  // Subida multipart: campos "mode", "quality" (si enhance) y "file". Se escribe a disco en streaming.
  app.post('/api/jobs', async (req, reply) => {
    if (!req.isMultipart()) throw new HttpError(400, 'INVALID_FILE', 'Envía el audio como multipart/form-data.')
    checkGuestLimit(req.viewer) // antes de recibir el archivo

    let mode, quality, saved
    const cleanup = () => saved && fsp.rm(saved.dir, { recursive: true, force: true })

    try {
      for await (const part of req.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'mode') mode = String(part.value)
          if (part.fieldname === 'quality') quality = String(part.value)
          continue
        }
        if (part.fieldname !== 'file' || saved) {
          part.file.resume() // descartar archivos extra
          continue
        }
        const ext = path.extname(part.filename || '').toLowerCase()
        if (!ACCEPTED_TYPES.includes(ext)) {
          part.file.resume()
          throw new HttpError(400, 'INVALID_FILE', `Formato no soportado (${ext || 'sin extensión'}). Usa ${ACCEPTED_TYPES.join(', ')}.`)
        }
        // Validar el modo antes de recibir cientos de MB (el frontend manda los campos primero)
        if (mode && !findMode(mode, quality ?? 'standard')) {
          part.file.resume()
          throw new HttpError(400, 'INVALID_REQUEST', 'Modo o calidad no válidos.')
        }
        const id = newJobId()
        const dir = jobDir(id)
        await fsp.mkdir(dir, { recursive: true })
        saved = { id, dir, ext, filename: path.basename(part.filename), tmp: path.join(dir, `original${ext}.part`) }
        await pipeline(part.file, fs.createWriteStream(saved.tmp))
      }
    } catch (e) {
      await cleanup()
      if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.statusCode === 413) {
        throw new HttpError(413, 'TOO_LARGE', tooLargeMessage)
      }
      if (e instanceof HttpError) throw e
      log(`subida interrumpida: ${e.message}`)
      throw new HttpError(400, 'UPLOAD_FAILED', 'La subida se interrumpió. Vuelve a intentarlo.')
    }

    try {
      if (!saved) throw new HttpError(400, 'INVALID_FILE', 'No se recibió ningún archivo.')
      const m = findMode(mode, mode === 'enhance' ? quality : null)
      if (!m || (mode === 'enhance' && !['standard', 'max'].includes(quality))) {
        throw new HttpError(400, 'INVALID_REQUEST', 'Modo o calidad no válidos.')
      }
      const sizeBytes = (await fsp.stat(saved.tmp)).size
      const durationSec = await probe(saved.tmp)
      if (!durationSec) throw new HttpError(400, 'INVALID_FILE', 'El archivo no es un audio válido o está dañado.')

      const needed = MIN_FREE_BYTES + durationSec * MIN_FREE_BYTES_PER_SEC
      if ((await freeBytes()) < needed) {
        throw new HttpError(507, 'DISK_FULL', `No hay espacio suficiente en disco: se necesitan ~${Math.ceil(needed / 1024 ** 3)} GB libres.`)
      }

      await fsp.rename(saved.tmp, path.join(saved.dir, `original${saved.ext}`))
      const job = insertJob({
        id: saved.id,
        filename: saved.filename,
        ext: saved.ext,
        sizeBytes,
        durationSec: Math.round(durationSec * 100) / 100,
        mode,
        quality: mode === 'enhance' ? quality : null,
        status: 'pending',
        progress: null,
        estimatedSec: Math.round(durationSec * factorFor(mode, quality)),
        createdAt: new Date().toISOString(),
        activeSec: 0,
        owner: req.viewer?.owner ?? 'local',
      })
      log(`+ ${job.id} "${job.filename}" ${(sizeBytes / 1e6).toFixed(1)} MB, ${Math.round(durationSec)} s, ${mode}${quality && mode === 'enhance' ? '/' + quality : ''}`)
      broadcast('job', toApi(job), job.owner)
      kick()
      // Onda del original en segundo plano (CPU, ffmpeg); no bloquea la respuesta
      const f = files(job)
      getWaveform(f.original, f.waveform('original'), job.durationSec).catch((e) => log(`onda original ${job.id}: ${e.message}`))
      return reply.code(201).send(toApi(job))
    } catch (e) {
      await cleanup()
      throw e
    }
  })
}
