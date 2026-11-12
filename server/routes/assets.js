// Cortinas (intro / outro) de cada espacio: subir, listar, renombrar, borrar, escuchar y predeterminadas.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { customAlphabet } from 'nanoid'
import { ACCEPTED_TYPES, ASSETS_DIR, MAX_ASSET_MB } from '../config.js'
import { deleteAssetRow, getAsset, insertAsset, listAssets, updateAsset } from '../db.js'
import { HttpError } from '../errors.js'
import { probe } from '../media.js'
import { sendFile } from '../static.js'
import { assetPath } from '../library.js'
import { curtainDefaults, setCurtainDefaults, workspaceFrom } from '../workspaces.js'
import { log } from '../log.js'

const newAssetId = (() => {
  const gen = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)
  return () => `a_${gen()}`
})()

export const assetToApi = (a) => ({
  id: a.id,
  workspaceId: a.workspaceId ?? null,
  name: a.name,
  filename: a.filename,
  durationSec: a.durationSec,
  sizeBytes: a.sizeBytes,
  createdAt: a.createdAt,
  url: `/api/assets/${a.id}/audio`,
})

const cleanName = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)

function mustGetAsset(id) {
  const a = getAsset(id)
  if (!a) throw new HttpError(404, 'NOT_FOUND', 'La cortina no existe.')
  return a
}

export default async function assetRoutes(app) {
  app.get('/api/assets', (req) => {
    const ws = workspaceFrom(req.query.workspace)
    return { items: listAssets(ws.id).map(assetToApi), defaults: curtainDefaults(ws) }
  })

  app.put('/api/assets/defaults', (req) =>
    setCurtainDefaults(workspaceFrom(req.body?.workspace), { introId: req.body?.introId ?? null, outroId: req.body?.outroId ?? null }),
  )

  // multipart: "workspace" y "name" (opcionales, antes del archivo) y "file". Máximo MAX_ASSET_MB.
  app.post('/api/assets', async (req, reply) => {
    if (!req.isMultipart()) throw new HttpError(400, 'INVALID_FILE', 'Envía la cortina como multipart/form-data.')
    let name = ''
    let wsField = ''
    let saved = null
    const cleanup = () => saved && fsp.rm(saved.tmp, { force: true })
    try {
      for await (const part of req.parts({ limits: { fileSize: MAX_ASSET_MB * 1024 * 1024 } })) {
        if (part.type === 'field') {
          if (part.fieldname === 'name') name = cleanName(part.value)
          if (part.fieldname === 'workspace') wsField = String(part.value)
          continue
        }
        if (part.fieldname !== 'file' || saved) {
          part.file.resume()
          continue
        }
        const ext = path.extname(part.filename || '').toLowerCase()
        if (!ACCEPTED_TYPES.includes(ext)) {
          part.file.resume()
          throw new HttpError(400, 'INVALID_FILE', `Formato no soportado (${ext || 'sin extensión'}). Usa ${ACCEPTED_TYPES.join(', ')}.`)
        }
        const id = newAssetId()
        saved = { id, ext, filename: path.basename(part.filename), tmp: path.join(ASSETS_DIR, `${id}${ext}.part`) }
        await pipeline(part.file, fs.createWriteStream(saved.tmp))
        if (part.file.truncated) throw new HttpError(413, 'TOO_LARGE', `La cortina supera ${MAX_ASSET_MB} MB.`)
      }
      if (!saved) throw new HttpError(400, 'INVALID_FILE', 'No se recibió ningún archivo.')
      const ws = workspaceFrom(wsField) // antes de mover el archivo: si el espacio no existe, no queda nada
      const durationSec = await probe(saved.tmp)
      if (!durationSec) throw new HttpError(400, 'INVALID_FILE', 'El archivo no es un audio válido o está dañado.')
      if (durationSec > 600) throw new HttpError(400, 'INVALID_FILE', 'Una cortina debe durar menos de 10 minutos.')
      const sizeBytes = (await fsp.stat(saved.tmp)).size
      const asset = { id: saved.id, ext: saved.ext }
      await fsp.rename(saved.tmp, assetPath(asset))
      const a = insertAsset({
        id: saved.id,
        workspaceId: ws.id,
        name: name || saved.filename.replace(/\.[^.]+$/, ''),
        filename: saved.filename,
        ext: saved.ext,
        sizeBytes,
        durationSec: Math.round(durationSec * 100) / 100,
        createdAt: new Date().toISOString(),
      })
      log(`+ cortina ${a.id} "${a.name}" (${Math.round(durationSec)} s)`)
      return reply.code(201).send(assetToApi(a))
    } catch (e) {
      await cleanup()
      if (e.code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'TOO_LARGE', `La cortina supera ${MAX_ASSET_MB} MB.`)
      if (e instanceof HttpError) throw e
      throw new HttpError(400, 'UPLOAD_FAILED', 'La subida se interrumpió. Vuelve a intentarlo.')
    }
  })

  app.patch('/api/assets/:id', (req) => {
    mustGetAsset(req.params.id)
    const name = cleanName(req.body?.name)
    if (!name) throw new HttpError(400, 'INVALID_REQUEST', 'El nombre no puede estar vacío.')
    return assetToApi(updateAsset(req.params.id, { name }))
  })

  app.delete('/api/assets/:id', async (req, reply) => {
    const a = mustGetAsset(req.params.id)
    await fsp.rm(assetPath(a), { force: true })
    deleteAssetRow(a.id)
    return reply.code(204).send()
  })

  app.route({
    method: ['GET', 'HEAD'],
    url: '/api/assets/:id/audio',
    handler: (req, reply) => sendFile(req, reply, assetPath(mustGetAsset(req.params.id))),
  })
}
