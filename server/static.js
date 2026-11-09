// Envío de archivos con soporte de Range (para adelantar en el reproductor) y servidor
// estático del frontend compilado. Sin dependencias.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

const MIME = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/** Interpreta "bytes=a-b" (un solo rango). Devuelve {start,end}, null (sin rango) o false (inválido). */
function parseRange(header, size) {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return false
  let start, end
  if (m[1] === '') {
    // sufijo: últimos N bytes
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start > end || start >= size) return false
  return { start, end }
}

/**
 * Envía un archivo con Accept-Ranges, 206/416, Last-Modified y HEAD.
 * Si el cliente corta la conexión (adelantar en el reproductor), el stream se cierra solo.
 */
export async function sendFile(req, reply, file, { cacheControl = 'no-cache' } = {}) {
  let st
  try {
    st = await fsp.stat(file)
    if (!st.isFile()) throw new Error('no es archivo')
  } catch {
    const e = new Error('Archivo no encontrado.')
    e.statusCode = 404
    e.code = 'NOT_FOUND'
    throw e
  }
  const size = st.size
  reply.header('Accept-Ranges', 'bytes')
  reply.header('Content-Type', MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream')
  reply.header('Last-Modified', st.mtime.toUTCString())
  reply.header('Cache-Control', cacheControl)

  const range = parseRange(req.headers.range, size)
  if (range === false) {
    reply.code(416).header('Content-Range', `bytes */${size}`)
    return reply.send()
  }
  const { start, end } = range ?? { start: 0, end: size - 1 }
  if (range) reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`)
  reply.header('Content-Length', size === 0 ? 0 : end - start + 1)
  if (req.method === 'HEAD' || size === 0) return reply.send()
  return reply.send(fs.createReadStream(file, { start, end }))
}

/** Sirve el frontend compilado (web/dist) con protección contra path traversal. */
export function registerWebDist(app, root) {
  const rootAbs = path.resolve(root)
  app.get('/*', async (req, reply) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0])
    if (urlPath.startsWith('/api/')) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } })
    }
    let file = path.resolve(rootAbs, '.' + urlPath)
    if (!file.startsWith(rootAbs + path.sep) && file !== rootAbs) {
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada.' } })
    }
    const exists = await fsp.stat(file).then((s) => s.isFile()).catch(() => false)
    if (!exists) file = path.join(rootAbs, 'index.html') // una sola página
    // Los assets de Vite llevan hash: se pueden cachear para siempre
    const immutable = file.includes(`${path.sep}assets${path.sep}`)
    return sendFile(req, reply, file, { cacheControl: immutable ? 'public, max-age=31536000, immutable' : 'no-cache' })
  })
}
