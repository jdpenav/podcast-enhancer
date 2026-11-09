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
 * @param {{onProgress?: (fraction:number, loaded:number, total:number) => void, signal?: AbortSignal}} [extra]
 * @returns {Promise<object>} Job creado (status "pending")
 */
export function createJob(file, { mode, quality }, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    // Campos antes del archivo: así el backend los lee antes de recibir el stream.
    form.append('mode', mode)
    if (mode === 'enhance' && quality) form.append('quality', quality)
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

/**
 * Suscripción al SSE /api/events. EventSource reconecta solo.
 * @returns {() => void} función para cerrar
 */
export function subscribeEvents({ onJob, onProgress, onDeleted, onHealth, onOpen, onError }) {
  const es = new EventSource(`${BASE}/events`)
  const parse = (fn) => (e) => {
    try {
      fn?.(JSON.parse(e.data))
    } catch (err) {
      console.warn('Evento SSE inválido', err)
    }
  }
  es.addEventListener('job', parse(onJob))
  es.addEventListener('progress', parse(onProgress))
  es.addEventListener('deleted', parse(onDeleted))
  es.addEventListener('health', parse(onHealth))
  es.onopen = () => onOpen?.()
  es.onerror = () => onError?.()
  return () => es.close()
}
