// Sincronización del catálogo del canal con la biblioteca.
//  - RSS (feeds/videos.xml): rápido, sin API key, fechas exactas, pero solo los 15 más recientes.
//  - yt-dlp sobre /streams: el histórico completo, sin descargar media.
// Upsert por youtubeVideoId: nunca duplica y nunca toca el estado ni los archivos de un episodio.
import { YT_CHANNEL_ID, YT_STREAMS_URL } from './config.js'
import { HttpError } from './errors.js'
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

/** Videos del RSS: [{ youtubeId, title, publishedAt }] (más reciente primero). */
export async function fetchRss() {
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${YT_CHANNEL_ID}`
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
function upsert(v, { exactDate }) {
  const now = new Date().toISOString()
  const ep = episodeByYoutubeId(v.youtubeId)
  if (!ep) {
    insertEpisode({
      id: youtubeEpisodeId(v.youtubeId),
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
  const r = { added: 0, updated: 0 }
  transaction(() => {
    for (const v of videos) {
      const res = upsert(v, opts)
      if (res) r[res]++
    }
  })()
  return r
}

let inflight = null

/**
 * Sincroniza. Con full=false solo el RSS (segundos); con full=true también el listado completo
 * (puede tardar ~30 s). Las llamadas simultáneas comparten la misma ejecución.
 * Al terminar emite un único evento `library` para que la UI recargue la lista.
 */
export const channelConfigured = () => !!YT_CHANNEL_ID

export function syncCatalog({ full = true } = {}) {
  if (!YT_CHANNEL_ID) {
    return Promise.reject(
      new HttpError(409, 'CHANNEL_NOT_CONFIGURED', 'Todavía no hay un canal de YouTube configurado. Agrega YT_CHANNEL_ID en el archivo .env (mira .env.example) y reinicia la app.'),
    )
  }
  inflight ??= (async () => {
    const result = { added: 0, updated: 0, total: 0, full, warnings: [] }
    // 1) Histórico completo (si se pide): primero, para que el RSS luego afine las fechas recientes
    if (full) {
      // Los directos programados (aún no empiezan) no se pueden descargar: no se listan
      const videos = (await listChannel(YT_STREAMS_URL)).filter((v) => v.liveStatus !== 'is_upcoming')
      const r = upsertMany(videos, { exactDate: false })
      result.added += r.added
      result.updated += r.updated
      result.total = videos.length
    }
    // 2) RSS: fechas exactas de lo más reciente. Si falla tras un listado completo, no es grave.
    try {
      const rss = await fetchRss()
      // El RSS incluye videos normales además de directos: solo se actualizan los que ya existen,
      // salvo que no se haya hecho listado completo (entonces el RSS es la única fuente).
      const videos = full ? rss.filter((v) => episodeByYoutubeId(v.youtubeId)) : rss
      const r = upsertMany(videos, { exactDate: true })
      result.added += r.added
      result.updated += r.updated
      if (!full) result.total = rss.length
    } catch (e) {
      if (!full) throw e
      result.warnings.push(e.message)
    }
    log(`⟳ catálogo${full ? ' completo' : ' (RSS)'}: ${result.added} nuevos, ${result.updated} actualizados`)
    broadcast('library', { reason: 'sync', added: result.added, updated: result.updated })
    return result
  })().finally(() => (inflight = null))
  return inflight
}

export const syncInProgress = () => !!inflight
