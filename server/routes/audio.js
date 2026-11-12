// Audio con soporte de Range (server/static.js) + descarga + forma de onda.
import path from 'node:path'
import { HttpError } from '../queue.js'
import { files, visibleJob } from '../jobs.js'
import { getJob } from '../db.js'
import { getWaveform } from '../waveform.js'
import { sendFile } from '../static.js'

const AUDIO = new Set(['original', 'result.mp3', 'result.wav'])

/** Content-Disposition con nombre UTF-8 (RFC 6266/5987) y respaldo ASCII. */
export function attachment(name) {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}


export default async function audioRoutes(app) {
  app.route({ method: ['GET', 'HEAD'], url: '/api/jobs/:id/audio/:file', handler: (req, reply) => {
    const { id, file } = req.params
    if (!AUDIO.has(file)) throw new HttpError(404, 'NOT_FOUND', 'Archivo no encontrado.')
    const job = visibleJob(req, id, getJob)
    if (file !== 'original' && job.status !== 'done') throw new HttpError(404, 'NOT_READY', 'El resultado todavía no está listo.')

    const f = files(job)
    const full = file === 'original' ? f.original : file === 'result.mp3' ? f.mp3 : f.wav
    if (req.query.download) {
      const base = job.filename.replace(/\.[^.]+$/, '')
      const name = file === 'original' ? job.filename : `${base}_mejorado${path.extname(full)}`
      reply.header('Content-Disposition', attachment(name))
    }
    return sendFile(req, reply, full)
  } })

  app.get('/api/jobs/:id/waveform', async (req) => {
    const job = visibleJob(req, req.params.id, getJob)
    const which = req.query.which === 'result' ? 'result' : req.query.which === 'original' ? 'original' : null
    if (!which) throw new HttpError(400, 'INVALID_REQUEST', 'Usa ?which=original o ?which=result.')
    if (which === 'result' && job.status !== 'done') throw new HttpError(404, 'NOT_READY', 'El resultado todavía no está listo.')
    const f = files(job)
    try {
      return await getWaveform(which === 'original' ? f.original : f.mp3, f.waveform(which), job.durationSec)
    } catch {
      throw new HttpError(500, 'WAVEFORM_FAILED', 'No se pudo calcular la forma de onda.')
    }
  })
}
