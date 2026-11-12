// Servidor local de Enhancer (Fastify).
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import {
  GUEST_MAX_UPLOAD_MB, HEALTH_INTERVAL_MS, HOST, JOBS_DIR, MAX_UPLOAD_MB, PORT, PRODUCTION,
  SHARE, SHARE_HOST, SHARE_KEY, SHARE_KEY_MIN_LENGTH, SHARE_PORT, WEB_DIST,
} from './config.js'
import { closeDb, listJobs } from './db.js'
import { broadcast, closeAll } from './events.js'
import { getHealth } from './health.js'
import { files } from './jobs.js'
import { isBusy, kick, log, recover, shutdown, tick } from './queue.js'
import systemRoutes from './routes/system.js'
import jobRoutes from './routes/jobs.js'
import audioRoutes from './routes/audio.js'
import episodeRoutes from './routes/episodes.js'
import assetRoutes from './routes/assets.js'
import workspaceRoutes from './routes/workspaces.js'
import { ensureWorkspaces } from './workspaces.js'
import { initLibrary, stopLibrary } from './library.js'
import { shutdownTasks } from './tasks.js'
import { ytdlpVersion } from './ytdlp.js'
import { hasFfmpeg } from './health.js'
import { registerWebDist } from './static.js'
import { guestAuth } from './share.js'

/**
 * Crea una app Fastify. Hay dos con las mismas rutas, cola y base de datos:
 *  - owner: puerto 3000, el usuario de la laptop. Ve y gestiona todo.
 *  - guest: puerto compartido (solo con --share). Exige enlace/cookie y cada invitado ve solo lo suyo.
 */
async function buildApp(role) {
  const guest = role === 'guest'
  const maxUploadMB = guest ? GUEST_MAX_UPLOAD_MB : MAX_UPLOAD_MB
  const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 1024 * 1024, trustProxy: false })

  app.decorateRequest('viewer', null)
  if (guest) {
    app.addHook('onRequest', guestAuth(SHARE_KEY))
    // Nada de lo que sale por el túnel se guarda en la caché de Cloudflare
    app.addHook('onSend', async (req, reply, payload) => {
      const cc = String(reply.getHeader('Cache-Control') ?? '')
      if (!cc.startsWith('private') && cc !== 'no-store') reply.header('Cache-Control', cc.includes('immutable') ? 'private, max-age=31536000, immutable' : 'private, no-cache')
      return payload
    })
  } else {
    app.addHook('onRequest', async (req) => {
      req.viewer = { role: 'owner', owner: 'local' }
    })
  }
  app.decorate('limits', { maxUploadMB, role })

  await app.register(multipart, {
    limits: { fileSize: maxUploadMB * 1024 * 1024, files: 1, fields: 10 },
  })

  // Errores siempre con la forma { error: { code, message } } y en español
  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode ?? 500
    if (status >= 500 && !err.code?.match(/^[A-Z_]+$/)) req.log.error(err)
    const known = err.code && /^[A-Z_]+$/.test(err.code) && !err.code.startsWith('FST_')
    reply.code(status).send({
      error: {
        code: known ? err.code : status === 404 ? 'NOT_FOUND' : status >= 500 ? 'SERVER_ERROR' : 'INVALID_REQUEST',
        message: known || status < 500 ? err.message : 'Error interno del servidor.',
      },
    })
  })
  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } })
  })

  await app.register(systemRoutes)
  await app.register(jobRoutes)
  await app.register(audioRoutes)
  await app.register(episodeRoutes)
  await app.register(assetRoutes)
  await app.register(workspaceRoutes)
  if (serveWeb) registerWebDist(app, WEB_DIST)
  return app
}

// En producción, el mismo servidor sirve el frontend compilado (web/dist)
const serveWeb = PRODUCTION && fs.existsSync(WEB_DIST)

if (SHARE && SHARE_KEY.length < SHARE_KEY_MIN_LENGTH) {
  console.error(`✗ Modo compartido sin SHARE_KEY válida (mínimo ${SHARE_KEY_MIN_LENGTH} caracteres en .env). Usa: npm run share`)
  process.exit(1)
}

const app = await buildApp('owner')
const guestApp = SHARE ? await buildApp('guest') : null

/** Limpieza al arrancar: carpetas sin trabajo, subidas a medias, temporales de trabajos terminados. */
async function cleanupDisk() {
  const jobs = new Map(listJobs().map((j) => [j.id, j]))
  for (const name of await fsp.readdir(JOBS_DIR).catch(() => [])) {
    const dir = path.join(JOBS_DIR, name)
    const job = jobs.get(name)
    if (!job) {
      log(`🧹 carpeta sin trabajo: ${name}`)
      await fsp.rm(dir, { recursive: true, force: true })
      continue
    }
    for (const f of await fsp.readdir(dir)) if (f.endsWith('.part') || f.includes('.tmp')) await fsp.rm(path.join(dir, f), { force: true })
    if (['done', 'canceled'].includes(job.status)) await fsp.rm(files(job).work, { recursive: true, force: true })
  }
}

await recover()
await cleanupDisk()
await ensureWorkspaces() // antes de la biblioteca: todo debe tener espacio
await initLibrary()

// Herramientas externas: avisar claro al arrancar si falta algo (la app arranca igual)
if (!(await hasFfmpeg())) log('⚠ Falta ffmpeg: sudo apt install ffmpeg')
const yt = await ytdlpVersion()
if (yt.installed) log(`yt-dlp ${yt.version} (${yt.path})`)
else if (yt.path) log(`⚠ yt-dlp no arranca (${yt.path}): ${yt.error}. Reinstálalo con: npm run setup`)
else log('⚠ Falta yt-dlp: la biblioteca no podrá listar ni descargar de YouTube. Instálalo con: npm run setup')

// Health por SSE cada ~10 s (y revisión de motores externos)
const healthTimer = setInterval(async () => {
  tick()
  broadcast('health', await getHealth({ busy: isBusy() }))
}, HEALTH_INTERVAL_MS)

await app.listen({ port: PORT, host: HOST })
log(`Servidor listo en http://localhost:${PORT}${serveWeb ? '' : ' (API; frontend con Vite en :5173)'}`)
if (guestApp) {
  await guestApp.listen({ port: SHARE_PORT, host: SHARE_HOST })
  log(`Puerto compartido (invitados, exige enlace) en http://${SHARE_HOST}:${SHARE_PORT}`)
}
kick()

// Apagado ordenado: pausar el trabajo en curso (el motor guarda su avance) antes de salir
let stopping = false
async function stop(sig) {
  if (stopping) return
  stopping = true
  log(`${sig}: apagando…`)
  clearInterval(healthTimer)
  stopLibrary()
  await Promise.all([shutdown(), shutdownTasks()])
  closeAll()
  await Promise.all([app.close(), guestApp?.close()])
  closeDb()
  process.exit(0)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
