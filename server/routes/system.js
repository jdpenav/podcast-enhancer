// GET /api/health · GET /api/config · GET /api/events (SSE) · GET /api/system · POST /api/system/yt-dlp/update
import { ACCEPTED_TYPES, DEFAULT_PRESET, PRESET_LIMITS } from '../config.js'
import { HttpError } from '../errors.js'
import { systemStatus } from '../system.js'
import { updateYtdlp, YtError } from '../ytdlp.js'
import { publicConfigModes } from '../jobs.js'
import { addClient } from '../events.js'
import { getHealth } from '../health.js'
import { isBusy } from '../queue.js'

/** Los invitados no ven la temperatura de la GPU. */
const healthFor = (h, viewer) => (viewer?.role === 'guest' && h.gpu ? { ...h, gpu: { ...h.gpu, tempC: null } } : h)

export default async function systemRoutes(app) {
  app.get('/api/health', async (req) => healthFor(await getHealth({ busy: isBusy() }), req.viewer))

  app.get('/api/config', () => ({
    modes: publicConfigModes(),
    maxUploadMB: app.limits.maxUploadMB,
    acceptedTypes: ACCEPTED_TYPES,
    role: app.limits.role,
    exportPreset: DEFAULT_PRESET,
    presetLimits: PRESET_LIMITS,
  }))

  app.get('/api/system', () => systemStatus())

  // Actualizar yt-dlp: solo el dueño (los invitados reciben 404, como cualquier ruta que no existe)
  let updating = null
  app.post('/api/system/yt-dlp/update', async (req) => {
    if (req.viewer?.role === 'guest') throw new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada.')
    try {
      updating ??= updateYtdlp().finally(() => (updating = null))
      return await updating
    } catch (e) {
      if (e instanceof YtError) throw new HttpError(500, 'YTDLP_MISSING', e.message)
      throw e
    }
  })

  app.get('/api/events', async (req, reply) => {
    // Al conectar se envía el health actual; los trabajos los pide el cliente con GET /api/jobs
    const health = await getHealth({ busy: isBusy() })
    addClient(req, reply, [['health', health]])
  })
}
