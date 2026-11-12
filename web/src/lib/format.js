// Formateo de tiempos, tamaños y etiquetas en español.

/** Reloj: 75 → "1:15", 3395 → "56:35", 3725 → "1:02:05". */
export function formatClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Duración aproximada: "~3 min", "~55 min", "~1 h 05 min", "<1 min". */
export function formatApprox(sec) {
  if (!Number.isFinite(sec)) return '—'
  if (sec < 60) return '<1 min'
  const totalMin = Math.round(sec / 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (!h) return `~${m} min`
  return m ? `~${h} h ${String(m).padStart(2, '0')} min` : `~${h} h`
}

/** "quedan ~33 min" / "menos de un minuto". */
export function formatEta(sec) {
  if (!Number.isFinite(sec)) return 'calculando…'
  if (sec < 60) return 'menos de un minuto'
  return `quedan ${formatApprox(sec)}`
}

/** Duración legible larga: "56 min", "1 h 05 min". */
export function formatDurationShort(sec) {
  return formatApprox(sec).replace('~', '')
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i++
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

/** "hace 5 minutos", "ayer"… */
export function formatRelative(iso, now = Date.now()) {
  if (!iso) return ''
  const diff = (new Date(iso).getTime() - now) / 1000
  const abs = Math.abs(diff)
  if (abs < 45) return 'ahora mismo'
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
  return rtf.format(Math.round(diff / 86400), 'day')
}

/** Hora del día: "22:45". */
export function formatTimeOfDay(date) {
  return new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function modeLabel(mode, quality) {
  if (mode === 'denoise') return 'Limpiar ruido'
  return quality === 'max' ? 'Mejora completa · Máxima' : 'Mejora completa · Estándar'
}

export function modeShortLabel(mode, quality) {
  if (mode === 'denoise') return 'Limpiar ruido'
  return quality === 'max' ? 'Máxima' : 'Estándar'
}

/** Nombre sin extensión. */
export function baseName(filename = '') {
  return filename.replace(/\.[^.]+$/, '')
}

export function extOf(filename = '') {
  const m = filename.toLowerCase().match(/\.[^.]+$/)
  return m ? m[0] : ''
}

const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' })
const dateFmtShort = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })

/** Fecha: "9 nov 2026" (o "9 nov" si es del año en curso y `short`). */
export function formatDate(iso, { short = false } = {}) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return short && d.getFullYear() === new Date().getFullYear() ? dateFmtShort.format(d) : dateFmt.format(d)
}

/** Velocidad: "2,4 MB/s". */
export function formatSpeed(bps) {
  return Number.isFinite(bps) && bps > 0 ? `${formatBytes(bps)}/s` : ''
}

/** Tiempo editable con décimas: 252.4 → "4:12.4", 3725.25 → "1:02:05.3". */
export function formatTimecode(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const tenths = Math.round(sec * 10)
  const whole = Math.floor(tenths / 10)
  return `${formatClock(whole)}.${tenths % 10}`
}

/**
 * Interpreta lo que el usuario escribe: "00:04:12", "4:12.5", "252", "1:02:05".
 * Devuelve segundos o null si no es válido.
 */
export function parseTimecode(text) {
  const t = String(text ?? '').trim().replace(',', '.')
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(t)) return null
  const [main, frac = ''] = t.split('.')
  const parts = main.split(':').map(Number)
  if (parts.slice(1).some((p) => p >= 60)) return null
  const secs = parts.reduce((acc, p) => acc * 60 + p, 0)
  return secs + (frac ? Number(`0.${frac}`) : 0)
}
