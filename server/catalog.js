// Sincronización del catálogo del canal de un espacio con su biblioteca.
//  - RSS (feeds/videos.xml): rápido, sin API key, fechas exactas, pero solo los 15 más recientes.
//  - yt-dlp sobre /streams (o /videos): el histórico completo, sin descargar media.
// Upsert por youtubeVideoId: nunca duplica y nunca toca el estado ni los archivos de un episodio.
import { HttpError } from './errors.js'
import { emitWorkspace } from './workspaces.js'
import { episodeByYoutubeId, insertEpisode, transaction, updateEpisodeRow } from './db.js'
import { youtubeEpisodeId } from './episodes.js'
import { broadcast } from './events.js'
import { listChannel } from './ytdlp.js'
import { log } from './log.js'

const thumb = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`

const decodeXml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&')

/** Videos del RSS de un canal: [{ youtubeId, title, publishedAt }] (más reciente primero). */
export async function fetchRss(channelId) {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new Error('No se pudo conectar con YouTube (RSS). Revisa tu conexión a internet.')
  }
  if (!res.ok) throw new Error(`YouTube respondió ${res.status} al pedir el RSS del canal.`)
  const xml = await res.text()
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    youtubeId: e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1],
    title: decodeXml(e.match(/<title>([^<]*)<\/title>/)?.[1] ?? ''),
    publishedAt: e.match(/<published>([^<]+)<\/published>/)?.[1] ?? null,
  })).filter((v) => v.youtubeId)
}

/**
 * Inserta o actualiza un video. `exactDate`: la fecha viene de una fuente exacta (RSS / metadatos)
 * y puede reemplazar una aproximada. Devuelve 'added' | 'updated' | null (sin cambios).
 */
function upsert(v, { exactDate, workspaceId }) {
  const now = new Date().toISOString()
  const ep = episodeByYoutubeId(v.youtubeId)
  // Un video pertenece a un solo canal (y un canal a un solo espacio): nunca se mueve de espacio
  if (ep && ep.workspaceId !== workspaceId) return 'skipped'
  if (!ep) {
    insertEpisode({
      id: youtubeEpisodeId(v.youtubeId),
      workspaceId,
      source: 'youtube',
      youtubeId: v.youtubeId,
      owner: null,
      title: v.title || '(sin título)',
      publishedAt: v.publishedAt ? new Date(v.publishedAt).toISOString() : null,
      durationSec: v.durationSec ?? null,
      thumbnailUrl: thumb(v.youtubeId),
      position: v.position ?? null,
      status: 'discovered',
      createdAt: now,
      updatedAt: now,
    })
    return 'added'
  }
  const patch = {}
  if (v.title && v.title !== ep.title) patch.title = v.title
  if (Number.isFinite(v.durationSec) && !ep.durationSec) patch.durationSec = v.durationSec
  if (v.publishedAt && (exactDate || !ep.publishedAt)) {
    const iso = new Date(v.publishedAt).toISOString()
    if (iso !== ep.publishedAt) patch.publishedAt = iso
  }
  if (Number.isFinite(v.position) && v.position !== ep.position) patch.position = v.position
  if (!Object.keys(patch).length) return null
  updateEpisodeRow(ep.id, patch)
  return 'updated'
}

function upsertMany(videos, opts) {
  const r = { added: 0, updated: 0, skipped: 0 }
  transaction(() => {
    for (const v of videos) {
      const res = upsert(v, opts)
      if (res) r[res]++
    }
  })()
  return r
}

const inflight = new Map() // espacio → Promise

/**
 * Sincroniza el canal de un espacio. Con full=false solo el RSS (segundos); con full=true también el
 * listado completo (puede tardar ~30 s). Las llamadas simultáneas del mismo espacio comparten la
 * ejecución. Al terminar emite un único evento `library` para que la UI recargue la lista.
 */
export function syncCatalog(ws, { full = true } = {}) {
  if (!ws?.channelId) {
    return Promise.reject(
      new HttpError(409, 'CHANNEL_NOT_CONFIGURED', `El espacio "${ws?.name ?? ''}" todavía no tiene un canal de YouTube. Conéctalo en Ajustes → Espacios.`),
    )
  }
  if (inflight.has(ws.id)) return inflight.get(ws.id)
  const opts = { workspaceId: ws.id }
  const p = (async () => {
    const result = { added: 0, updated: 0, total: 0, full, warnings: [] }
    // 1) Histórico completo (si se pide): primero, para que el RSS luego afine las fechas recientes
    if (full) {
      const tab = ws.streamsUrl ?? `https://www.youtube.com/channel/${ws.channelId}/streams`
      // Los directos programados (aún no empiezan) no se pueden descargar: no se listan
      const videos = (await listChannel(tab)).filter((v) => v.liveStatus !== 'is_upcoming')
      const r = upsertMany(videos, { ...opts, exactDate: false })
      result.added += r.added
      result.updated += r.updated
      result.total = videos.length
      if (r.skipped) result.warnings.push(`${r.skipped} videos ya estaban en otro espacio y no se movieron.`)
    }
    // 2) RSS: fechas exactas de lo más reciente. Si falla tras un listado completo, no es grave.
    try {
      const rss = await fetchRss(ws.channelId)
      // El RSS incluye videos normales además de directos: solo se actualizan los que ya existen,
      // salvo que no se haya hecho listado completo (entonces el RSS es la única fuente).
      const videos = full ? rss.filter((v) => episodeByYoutubeId(v.youtubeId)) : rss
      const r = upsertMany(videos, { ...opts, exactDate: true })
      result.added += r.added
      result.updated += r.updated
      if (!full) result.total = rss.length
    } catch (e) {
      if (!full) throw e
      result.warnings.push(e.message)
    }
    log(`⟳ catálogo de "${ws.name}"${full ? ' completo' : ' (RSS)'}: ${result.added} nuevos, ${result.updated} actualizados`)
    broadcast('library', { reason: 'sync', workspaceId: ws.id, added: result.added, updated: result.updated })
    emitWorkspace(ws.id) // conteos
    return result
  })().finally(() => inflight.delete(ws.id))
  inflight.set(ws.id, p)
  return p
}

export const syncInProgress = (wsId) => inflight.has(wsId)
