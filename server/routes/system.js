// GET /api/health · GET /api/config · GET /api/events (SSE)
import { ACCEPTED_TYPES } from '../config.js'
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
  }))

  app.get('/api/events', async (req, reply) => {
    // Al conectar se envía el health actual; los trabajos los pide el cliente con GET /api/jobs
    const health = await getHealth({ busy: isBusy() })
    addClient(req, reply, [['health', health]])
  })
}
