// Cliente real contra el backend Fastify. Sigue EXACTAMENTE docs/API.md.
// mock.js expone la misma interfaz.

const BASE = '/api'

export class ApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status = 0 } = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

async function request(path, { method = 'GET', body } = {}) {
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('No se pudo conectar con el servidor.', { code: 'NETWORK' })
  }
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    throw new ApiError(data?.error?.message || `Error del servidor (${res.status}).`, {
      code: data?.error?.code,
      status: res.status,
    })
  }
  return data
}

export const getHealth = () => request('/health')
export const getConfig = () => request('/config')
export const listJobs = () => request('/jobs')
export const getJob = (id) => request(`/jobs/${id}`)
export const pauseJob = (id) => request(`/jobs/${id}/pause`, { method: 'POST' })
export const resumeJob = (id) => request(`/jobs/${id}/resume`, { method: 'POST' })
export const cancelJob = (id) => request(`/jobs/${id}/cancel`, { method: 'POST' })
export const deleteJob = (id) => request(`/jobs/${id}`, { method: 'DELETE' })
export const getWaveform = (id, which) => request(`/jobs/${id}/waveform?which=${which}`)

/**
 * Sube el audio con XMLHttpRequest para tener progreso de subida (30–300 MB).
 * @param {File} file
 * @param {{mode: 'denoise'|'enhance', quality?: 'standard'|'max'}} opts
 * @param {{onProgress?: (fraction:number, loaded:number, total:number) => void, signal?: AbortSignal, workspace?: string}} [extra]
 * @returns {Promise<object>} Job creado (status "pending")
 */
export function createJob(file, { mode, quality }, { onProgress, signal, workspace } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    // Campos antes del archivo: así el backend los lee antes de recibir el stream.
    form.append('mode', mode)
    if (mode === 'enhance' && quality) form.append('quality', quality)
    if (workspace) form.append('workspace', workspace)
    form.append('file', file, file.name)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/jobs`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total, e.loaded, e.total)
    }
    xhr.onload = () => {
      if (xhr.status === 201 || xhr.status === 200) return resolve(xhr.response)
      const err = xhr.response?.error
      if (xhr.status === 413) {
        // El mensaje del servidor dice el límite (y sugiere el MP3 por internet); un proxy puede no mandarlo
        return reject(new ApiError(err?.message || 'El archivo supera el tamaño máximo permitido.', { code: 'TOO_LARGE', status: 413 }))
      }
      reject(new ApiError(err?.message || `No se pudo subir (${xhr.status}).`, { code: err?.code, status: xhr.status }))
    }
    xhr.onerror = () => reject(new ApiError('Se perdió la conexión durante la subida.', { code: 'NETWORK' }))
    xhr.onabort = () => reject(new DOMException('Subida cancelada', 'AbortError'))
    if (signal) {
      if (signal.aborted) return xhr.abort()
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(form)
  })
}

/** URL para reproducir: which = 'original' | 'result'. */
export function audioUrl(job, which) {
  if (which === 'original') return `${BASE}/jobs/${job.id}/audio/original`
  return job.outputs?.mp3 ?? `${BASE}/jobs/${job.id}/audio/result.mp3`
}

/** Enlace de descarga: el backend pone Content-Disposition con el nombre final. */
export function downloadUrl(job, format) {
  const base = job.outputs?.[format] ?? `${BASE}/jobs/${job.id}/audio/result.${format}`
  return `${base}?download=1`
}

// ---------------------------------------------------------------------------
// Eventos en vivo
// ---------------------------------------------------------------------------
const SSE_EVENTS = {
  job: 'onJob',
  progress: 'onProgress',
  deleted: 'onDeleted',
  health: 'onHealth',
  episode: 'onEpisode',
  episodeProgress: 'onEpisodeProgress',
  episodeDeleted: 'onEpisodeDeleted',
  library: 'onLibrary',
  workspace: 'onWorkspace',
  workspaceDeleted: 'onWorkspaceDeleted',
}
let shared = null // { es, subs: Set<handlers> }

/**
 * Suscripción al SSE /api/events. Todas las suscripciones comparten UNA conexión
 * (se abre con la primera y se cierra con la última). EventSource reconecta solo.
 * handlers: { onJob, onProgress, onDeleted, onHealth, onEpisode, onEpisodeProgress, onEpisodeDeleted, onLibrary, onOpen, onError }
 * @returns {() => void} función para cancelar la suscripción
 */
export function subscribeEvents(handlers) {
  if (!shared) {
    const es = new EventSource(`${BASE}/events`)
    const subs = new Set()
    for (const [event, key] of Object.entries(SSE_EVENTS)) {
      es.addEventListener(event, (e) => {
        let data
        try {
          data = JSON.parse(e.data)
        } catch (err) {
          return console.warn('Evento SSE inválido', err)
        }
        for (const s of subs) s[key]?.(data)
      })
    }
    es.onopen = () => subs.forEach((s) => s.onOpen?.())
    es.onerror = () => subs.forEach((s) => s.onError?.())
    shared = { es, subs }
  }
  const mine = shared
  mine.subs.add(handlers)
  if (mine.es.readyState === EventSource.OPEN) queueMicrotask(() => handlers.onOpen?.())
  return () => {
    mine.subs.delete(handlers)
    if (!mine.subs.size) {
      mine.es.close()
      if (shared === mine) shared = null
    }
  }
}

// ---------------------------------------------------------------------------
// Biblioteca (episodios)
// ---------------------------------------------------------------------------
export function listEpisodes({ workspace, status, q, source } = {}) {
  const qs = new URLSearchParams()
  if (workspace) qs.set('workspace', workspace)
  if (status) qs.set('status', status)
  if (q) qs.set('q', q)
  if (source) qs.set('source', source)
  const s = qs.toString()
  return request(`/episodes${s ? `?${s}` : ''}`)
}
export const getEpisode = (id) => request(`/episodes/${id}`)
export const renameEpisode = (id, title) => request(`/episodes/${id}`, { method: 'PATCH', body: { title } })
export const syncEpisodes = ({ workspace, full = true } = {}) => request('/episodes/sync', { method: 'POST', body: { workspace, full } })
export const downloadEpisode = (id) => request(`/episodes/${id}/download`, { method: 'POST' })
export const retryEpisode = (id) => request(`/episodes/${id}/retry`, { method: 'POST' })
export const cancelEpisode = (id) => request(`/episodes/${id}/cancel`, { method: 'POST' })
export const deleteEpisode = (id) => request(`/episodes/${id}`, { method: 'DELETE' })
export const getEpisodePeaks = (id) => request(`/episodes/${id}/peaks`)
export const saveEpisodeEdit = (id, state) => request(`/episodes/${id}/edit`, { method: 'PUT', body: state })
export const exportEpisode = (id) => request(`/episodes/${id}/export`, { method: 'POST' })

/** Mejorar un audio de la biblioteca (crea un Job normal). */
export const createJobFromEpisode = (episodeId, { mode, quality }) =>
  request('/jobs', { method: 'POST', body: { episodeId, mode, ...(mode === 'enhance' && quality ? { quality } : {}) } })

/** which: 'source' | 'enhanced' | 'enhanced.wav' | 'final' */
export function episodeAudioUrl(ep, which) {
  return `${BASE}/episodes/${ep.id}/audio/${which}`
}
export const episodeDownloadUrl = (ep, which) => `${episodeAudioUrl(ep, which)}?download=1`

// ---------------------------------------------------------------------------
// Cortinas
// ---------------------------------------------------------------------------
export const listAssets = (workspace) => request(`/assets${workspace ? `?workspace=${encodeURIComponent(workspace)}` : ''}`)
export const renameAsset = (id, name) => request(`/assets/${id}`, { method: 'PATCH', body: { name } })
export const deleteAsset = (id) => request(`/assets/${id}`, { method: 'DELETE' })
/** defaults: { workspace, introId, outroId } */
export const setAssetDefaults = (defaults) => request('/assets/defaults', { method: 'PUT', body: defaults })
export const assetAudioUrl = (asset) => asset.url

export function uploadAsset(file, name, workspace) {
  const form = new FormData()
  if (workspace) form.append('workspace', workspace)
  if (name) form.append('name', name)
  form.append('file', file, file.name)
  return fetch(`${BASE}/assets`, { method: 'POST', body: form })
    .catch(() => {
      throw new ApiError('No se pudo conectar con el servidor.', { code: 'NETWORK' })
    })
    .then(async (res) => {
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new ApiError(data?.error?.message || `No se pudo subir (${res.status}).`, { code: data?.error?.code, status: res.status })
      return data
    })
}

// ---------------------------------------------------------------------------
// Espacios
// ---------------------------------------------------------------------------
export const listWorkspaces = () => request('/workspaces')
/** Resuelve un enlace de YouTube: { channel, workspaceId } (workspaceId = espacio que ya lo usa). */
export const resolveChannel = (url) => request('/workspaces/resolve', { method: 'POST', body: { url } })
export const createWorkspace = (data) => request('/workspaces', { method: 'POST', body: data })
export const updateWorkspace = (id, data) => request(`/workspaces/${id}`, { method: 'PATCH', body: data })
export const deleteWorkspace = (id) => request(`/workspaces/${id}`, { method: 'DELETE' })

// ---------------------------------------------------------------------------
// Sistema
// ---------------------------------------------------------------------------
export const getSystem = () => request('/system')
export const updateYtdlp = () => request('/system/yt-dlp/update', { method: 'POST' })
