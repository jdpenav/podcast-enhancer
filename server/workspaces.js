// Espacios (workspaces): cada uno agrupa un canal de YouTube (o congregación) con su biblioteca,
// sus cortinas y su nombre de podcast. La GPU, la cola, yt-dlp y el disco son compartidos.
//
// Siempre existe al menos uno. Al arrancar, ensureWorkspaces():
//  - Si no hay ninguno: crea el primero. Si .env trae YT_CHANNEL_ID (instalaciones anteriores), con
//    ese canal; si no, "Mi espacio" sin canal.
//  - Asigna al espacio predeterminado todo lo que no tenga espacio (episodios, cortinas, trabajos).
//    No mueve archivos: el espacio es solo una columna.
import fsp from 'node:fs/promises'
import path from 'node:path'
import { customAlphabet } from 'nanoid'
import { ASSETS_DIR, PODCAST_NAME_ENV, YT_CHANNEL_ID, YT_STREAMS_URL } from './config.js'
import {
  assignOrphansTo, deleteAssetRow, deleteBareEpisodes, deleteWorkspaceRow, episodesByWorkspace, getAsset,
  getJob, getSetting, getWorkspace, insertWorkspace, listAssets, listWorkspaces, moveJobsToWorkspace,
  updateWorkspaceRow, workspaceByChannel, workspaceCounts,
} from './db.js'
import { broadcast } from './events.js'
import { HttpError } from './errors.js'
import { resolveChannel, YtError } from './ytdlp.js'
import { log } from './log.js'

const DEFAULT_NAME = 'Mi espacio'
const nowIso = () => new Date().toISOString()

export const newWorkspaceId = (() => {
  const gen = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)
  return () => `w_${gen()}`
})()

const cleanText = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

// ---------------------------------------------------------------------------
// Forma del contrato
// ---------------------------------------------------------------------------
export function workspaceToApi(w, counts = workspaceCounts(), defaultId = defaultWorkspace()?.id) {
  if (!w) return null
  const c = counts.get(w.id) ?? { episodes: 0, youtube: 0, withAudio: 0, ready: 0 }
  const url = w.channelHandle ? `https://www.youtube.com/${w.channelHandle}` : w.channelId ? `https://www.youtube.com/channel/${w.channelId}` : null
  return {
    id: w.id,
    name: w.name,
    podcastName: w.podcastName || w.name,
    channel: w.channelId
      ? {
          id: w.channelId,
          title: w.channelTitle ?? null,
          handle: w.channelHandle ?? null,
          url,
          streamsUrl: w.streamsUrl ?? `${url}/streams`,
          avatarUrl: w.channelAvatar ?? null,
        }
      : null,
    counts: { episodes: c.episodes, youtube: c.youtube, withAudio: c.withAudio, ready: c.ready },
    isDefault: w.id === defaultId,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }
}

export function emitWorkspace(id) {
  const w = getWorkspace(id)
  if (w) broadcast('workspace', workspaceToApi(w))
  return w
}

export const defaultWorkspace = () => listWorkspaces()[0] ?? null

export function mustGetWorkspace(id) {
  const w = getWorkspace(id)
  if (!w) throw new HttpError(404, 'NOT_FOUND', 'El espacio no existe.')
  return w
}

/** Espacio pedido por el cliente (query, campo o JSON) o el predeterminado si no dice ninguno. */
export function workspaceFrom(value) {
  const id = typeof value === 'string' ? value.trim() : ''
  return id ? mustGetWorkspace(id) : defaultWorkspace()
}

/** Solo el dueño gestiona espacios (los invitados reciben 404, como cualquier ruta que no existe). */
export function ownerOnly(req) {
  if (req.viewer?.role === 'guest') throw new HttpError(404, 'NOT_FOUND', 'Ruta no encontrada.')
}

const channelFields = (ch) => ({
  channelId: ch?.id ?? null,
  channelTitle: ch?.title ?? null,
  channelHandle: ch?.handle ?? null,
  channelAvatar: ch?.avatarUrl ?? null,
  streamsUrl: ch?.streamsUrl ?? null,
})

/** yt-dlp → HttpError con el código del contrato. */
export function ytToHttp(e) {
  if (!(e instanceof YtError)) return e
  if (e.kind === 'invalid') return new HttpError(400, 'INVALID_REQUEST', e.message)
  if (e.kind === 'notfound') return new HttpError(404, 'CHANNEL_NOT_FOUND', e.message)
  if (e.kind === 'missing') return new HttpError(500, 'YTDLP_MISSING', e.message)
  const code = { network: 'NETWORK', blocked: 'YTDLP_BLOCKED' }[e.kind] ?? 'YTDLP_FAILED'
  return new HttpError(502, code, e.message)
}

async function resolveOrThrow(url) {
  try {
    return await resolveChannel(url)
  } catch (e) {
    throw ytToHttp(e)
  }
}

// ---------------------------------------------------------------------------
// Arranque / migración
// ---------------------------------------------------------------------------
export async function ensureWorkspaces() {
  if (!listWorkspaces().length) {
    const now = nowIso()
    // Instalaciones anteriores: el canal venía de .env y las cortinas predeterminadas, de settings
    const legacyDefaults = getSetting('curtainDefaults', null)
    const w = insertWorkspace({
      id: newWorkspaceId(),
      name: DEFAULT_NAME,
      podcastName: PODCAST_NAME_ENV,
      ...channelFields(YT_CHANNEL_ID ? { id: YT_CHANNEL_ID, streamsUrl: YT_STREAMS_URL } : null),
      // autoName: el nombre se reemplaza por el del canal en cuanto se resuelva
      settings: { autoName: true, curtainDefaults: legacyDefaults ?? { introId: null, outroId: null } },
      createdAt: now,
      updatedAt: now,
    })
    log(`+ espacio ${w.id}${YT_CHANNEL_ID ? ` con el canal ${YT_CHANNEL_ID} (de .env)` : ' (sin canal)'}`)
  }
  const def = defaultWorkspace()
  const moved = assignOrphansTo(def.id)
  const total = Object.values(moved).reduce((a, b) => a + b, 0)
  if (total) log(`↪ al espacio "${def.name}": ${moved.episodes} episodios, ${moved.assets} cortinas, ${moved.jobs} trabajos`)

  // Completar en segundo plano los datos del canal que falten (nombre, foto, handle)
  for (const w of listWorkspaces()) {
    if (w.channelId && !w.channelTitle) refreshChannel(w.id).catch((e) => log(`canal de ${w.id}: ${e.message}`))
  }
}

/** Vuelve a consultar el canal (nombre, handle, foto). Mantiene la pestaña elegida. */
export async function refreshChannel(id) {
  const w = getWorkspace(id)
  if (!w?.channelId) return w
  const ch = await resolveChannel(`https://www.youtube.com/channel/${w.channelId}`)
  const patch = { channelTitle: ch.title, channelHandle: ch.handle, channelAvatar: ch.avatarUrl, streamsUrl: w.streamsUrl ?? ch.streamsUrl }
  if (w.settings?.autoName && w.name === DEFAULT_NAME && ch.title) {
    patch.name = ch.title
    patch.settings = { ...w.settings, autoName: false }
  }
  updateWorkspaceRow(id, patch)
  log(`✓ canal de "${patch.name ?? w.name}": ${ch.title} (${ch.handle ?? ch.id})`)
  return emitWorkspace(id)
}

// ---------------------------------------------------------------------------
// Gestión
// ---------------------------------------------------------------------------
export async function resolveForUi(url) {
  const channel = await resolveOrThrow(url)
  return { channel, workspaceId: workspaceByChannel(channel.id)?.id ?? null }
}

export async function createWorkspace(body) {
  const name = cleanText(body?.name, 80)
  if (!name) throw new HttpError(400, 'INVALID_REQUEST', 'Ponle un nombre al espacio.')
  let channel = null
  if (cleanText(body?.channelUrl, 500)) {
    channel = await resolveOrThrow(body.channelUrl)
    const other = workspaceByChannel(channel.id)
    if (other) throw new HttpError(409, 'CONFLICT', `Ese canal ya está en el espacio "${other.name}".`)
  }
  const now = nowIso()
  const w = insertWorkspace({
    id: newWorkspaceId(),
    name,
    podcastName: cleanText(body?.podcastName, 120) || null,
    ...channelFields(channel),
    settings: { curtainDefaults: { introId: null, outroId: null } },
    createdAt: now,
    updatedAt: now,
  })
  log(`+ espacio ${w.id} "${w.name}"${channel ? ` · ${channel.title}` : ''}`)
  return emitWorkspace(w.id)
}

export async function updateWorkspace(w, body) {
  const patch = {}
  if (body?.name !== undefined) {
    const name = cleanText(body.name, 80)
    if (!name) throw new HttpError(400, 'INVALID_REQUEST', 'El nombre no puede estar vacío.')
    patch.name = name
    patch.settings = { ...(w.settings ?? {}), autoName: false }
  }
  if (body?.podcastName !== undefined) patch.podcastName = cleanText(body.podcastName, 120) || null
  if (body?.channelUrl !== undefined) {
    const hasYoutube = episodesByWorkspace(w.id).some((e) => e.source === 'youtube')
    const url = cleanText(body.channelUrl, 500)
    let channel = null
    if (url) {
      channel = await resolveOrThrow(url)
      const other = workspaceByChannel(channel.id)
      if (other && other.id !== w.id) throw new HttpError(409, 'CONFLICT', `Ese canal ya está en el espacio "${other.name}".`)
    }
    if ((channel?.id ?? null) !== (w.channelId ?? null)) {
      if (hasYoutube) {
        throw new HttpError(409, 'CONFLICT', 'Este espacio ya tiene episodios de su canal. Para otro canal, crea un espacio nuevo.')
      }
      Object.assign(patch, channelFields(channel))
    }
  }
  updateWorkspaceRow(w.id, patch)
  return emitWorkspace(w.id)
}

const ACTIVE_JOB = ['pending', 'processing', 'paused']

export async function deleteWorkspace(w) {
  if (listWorkspaces().length <= 1) throw new HttpError(409, 'CONFLICT', 'Es el único espacio: crea otro antes de eliminar este.')
  const eps = episodesByWorkspace(w.id)
  const busy = eps.filter((e) => e.sourceExt || ['downloading', 'enhancing', 'exporting'].includes(e.status) || (e.jobId && ACTIVE_JOB.includes(getJob(e.jobId)?.status)))
  if (busy.length) {
    throw new HttpError(409, 'CONFLICT', `Este espacio tiene ${busy.length} ${busy.length === 1 ? 'episodio con audio' : 'episodios con audio'}. Bórralos primero desde la Biblioteca.`)
  }
  deleteBareEpisodes(w.id)
  for (const a of listAssets(w.id)) {
    await fsp.rm(path.join(ASSETS_DIR, `${a.id}${a.ext}`), { force: true })
    deleteAssetRow(a.id)
  }
  // Trabajos sueltos (sin episodio) que quedaran: al espacio predeterminado, para no perderlos de vista
  const fallback = listWorkspaces().find((x) => x.id !== w.id)
  moveJobsToWorkspace(w.id, fallback.id)
  deleteWorkspaceRow(w.id)
  log(`− espacio ${w.id} "${w.name}"`)
  broadcast('workspaceDeleted', { id: w.id })
  for (const x of listWorkspaces()) emitWorkspace(x.id) // isDefault puede cambiar
}

// ---------------------------------------------------------------------------
// Cortinas predeterminadas (por espacio)
// ---------------------------------------------------------------------------
export function curtainDefaults(w) {
  const d = w.settings?.curtainDefaults ?? {}
  const valid = (id) => {
    const a = id ? getAsset(id) : null
    return a && a.workspaceId === w.id ? id : null
  }
  return { introId: valid(d.introId), outroId: valid(d.outroId) }
}

export function setCurtainDefaults(w, { introId = null, outroId = null }) {
  for (const id of [introId, outroId]) {
    const a = id ? getAsset(id) : null
    if (id && (!a || a.workspaceId !== w.id)) throw new HttpError(400, 'INVALID_REQUEST', 'La cortina elegida no es de este espacio.')
  }
  const fresh = getWorkspace(w.id)
  updateWorkspaceRow(w.id, { settings: { ...(fresh.settings ?? {}), curtainDefaults: { introId, outroId } } })
  return curtainDefaults(getWorkspace(w.id))
}
