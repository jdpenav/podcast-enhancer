// Rutas de la biblioteca: listar, sincronizar con YouTube, descargar, reintentar, cancelar,
// eliminar, audio (Range), picos del editor, estado de edición y exportación.
import { STATUSES, canSeeEpisode, epFiles, episodeToApi, hasEnhanced, hasFinal, hasSource, visibleEpisode } from '../episodes.js'
import { listEpisodes } from '../db.js'
import { HttpError } from '../errors.js'
import { sendFile } from '../static.js'
import { attachment } from './audio.js'
import { syncCatalog } from '../catalog.js'
import { YtError } from '../ytdlp.js'
import {
  cancelEpisode, deleteEpisode, episodePeaks, renameEpisode, requestDownload, requestExport,
  retryEpisode, saveEdit,
} from '../library.js'

// Grupos de estados para el filtro de la UI (además de cualquier estado individual)
const GROUPS = {
  pending: ['discovered'],
  active: ['youtube_processing', 'downloading', 'enhancing', 'exporting'],
  editable: ['downloaded', 'enhanced', 'editing'],
  ready: ['ready'],
  error: ['error'],
}

const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export default async function episodeRoutes(app) {
  app.get('/api/episodes', (req) => {
    const { status, q, source } = req.query
    let statuses = null
    if (status) {
      statuses = String(status)
        .split(',')
        .flatMap((s) => GROUPS[s] ?? (STATUSES.includes(s) ? [s] : []))
      if (!statuses.length) throw new HttpError(400, 'INVALID_REQUEST', 'Estado no válido.')
    }
    const needle = q ? normalize(String(q).trim()) : ''
    return listEpisodes()
      .filter((ep) => canSeeEpisode(req.viewer, ep))
      .filter((ep) => !statuses || statuses.includes(ep.status))
      .filter((ep) => !source || ep.source === source)
      .filter((ep) => !needle || normalize(ep.title).includes(needle))
      .map(episodeToApi)
  })

  app.get('/api/episodes/:id', (req) => episodeToApi(visibleEpisode(req, req.params.id)))

  app.patch('/api/episodes/:id', (req) => {
    const ep = visibleEpisode(req, req.params.id)
    if (req.body?.title === undefined) throw new HttpError(400, 'INVALID_REQUEST', 'Envía { title }.')
    return episodeToApi(renameEpisode(ep, req.body.title))
  })

  app.post('/api/episodes/sync', async (req) => {
    const full = req.body?.full !== false
    try {
      return await syncCatalog({ full })
    } catch (e) {
      if (e instanceof HttpError) throw e
      if (e instanceof YtError) {
        const status = e.kind === 'missing' ? 500 : 502
        const code = { missing: 'YTDLP_MISSING', network: 'NETWORK', blocked: 'YTDLP_BLOCKED' }[e.kind] ?? 'YTDLP_FAILED'
        throw new HttpError(status, code, e.message)
      }
      throw new HttpError(502, 'SYNC_FAILED', e.message)
    }
  })

  app.post('/api/episodes/:id/download', (req) => episodeToApi(requestDownload(visibleEpisode(req, req.params.id))))
  app.post('/api/episodes/:id/retry', async (req) => episodeToApi(await retryEpisode(visibleEpisode(req, req.params.id))))
  app.post('/api/episodes/:id/cancel', async (req) => episodeToApi(await cancelEpisode(visibleEpisode(req, req.params.id))))

  app.delete('/api/episodes/:id', async (req, reply) => {
    const ep = await deleteEpisode(visibleEpisode(req, req.params.id))
    return ep ? episodeToApi(ep) : reply.code(204).send()
  })

  // Audio con Range: source (descargado/subido) · enhanced (MP3 para escuchar) · enhanced.wav · final (MP3 para Castbox)
  app.route({
    method: ['GET', 'HEAD'],
    url: '/api/episodes/:id/audio/:which',
    handler: (req, reply) => {
      const ep = visibleEpisode(req, req.params.id)
      const f = epFiles(ep)
      const which = req.params.which
      const map = {
        source: [hasSource(ep), f.source, `${ep.title}${ep.sourceExt ?? ''}`],
        enhanced: [hasEnhanced(ep), f.enhancedMp3, `${ep.title}_mejorado.mp3`],
        'enhanced.wav': [hasEnhanced(ep), f.enhancedWav, `${ep.title}_mejorado.wav`],
        final: [hasFinal(ep), f.final, `${ep.title}.mp3`],
      }
      if (!map[which]) throw new HttpError(404, 'NOT_FOUND', 'Archivo no encontrado.')
      const [ok, file, name] = map[which]
      if (!ok) throw new HttpError(404, 'NOT_READY', 'Ese audio todavía no está listo.')
      if (req.query.download) reply.header('Content-Disposition', attachment(name.replace(/[\\/]/g, '-')))
      return sendFile(req, reply, file, { cacheControl: 'no-cache' })
    },
  })

  app.get('/api/episodes/:id/peaks', async (req) => {
    const ep = visibleEpisode(req, req.params.id)
    try {
      return await episodePeaks(ep)
    } catch (e) {
      if (e instanceof HttpError) throw e
      throw new HttpError(500, 'WAVEFORM_FAILED', 'No se pudo calcular la forma de onda.')
    }
  })

  app.put('/api/episodes/:id/edit', (req) => episodeToApi(saveEdit(visibleEpisode(req, req.params.id), req.body)))
  app.post('/api/episodes/:id/export', (req) => episodeToApi(requestExport(visibleEpisode(req, req.params.id))))
}
