// Utilidades de audio en el navegador.

/**
 * Lee la duración de un archivo SIN decodificarlo (solo metadatos).
 * Devuelve null si el navegador no puede leerlo (el backend igual lo validará).
 */
export function getAudioDuration(file, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const el = document.createElement(file.type.startsWith('video') ? 'video' : 'audio')
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      el.removeAttribute('src')
      el.load()
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), timeoutMs)
    el.preload = 'metadata'
    el.onloadedmetadata = () => finish(Number.isFinite(el.duration) ? el.duration : null)
    el.onerror = () => finish(null)
    el.src = url
  })
}
