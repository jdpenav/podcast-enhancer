// Integración con yt-dlp (proceso hijo): localizarlo, versión, listar el canal, metadatos,
// descargar el mejor audio SIN convertir y clasificar sus errores en mensajes útiles.
//
// Flags usados (confirmados en la documentación de yt-dlp; revisar con `yt-dlp --help` si cambian):
//   --flat-playlist -J                      listar una pestaña del canal en JSON sin descargar nada
//   --extractor-args youtubetab:approximate_date   fecha aproximada en el listado plano
//   -J --no-playlist URL                    metadatos de un video
//   -f bestaudio                            mejor pista de audio tal cual (m4a/opus), sin recodificar
//   --newline --progress-template           progreso en líneas parseables
//   -U                                      autoactualizar (binario oficial)
import fs from 'node:fs'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import readline from 'node:readline'
import { YTDLP_ENV, YTDLP_LOCAL } from './config.js'

const run = promisify(execFile)

/** Error de yt-dlp ya clasificado. kind: processing | upcoming | unavailable | network | blocked | missing | failed */
export class YtError extends Error {
  constructor(kind, message, detail = '') {
    super(message)
    this.kind = kind
    this.detail = detail
  }
}

// ---------------------------------------------------------------------------
// Localizar el binario
// ---------------------------------------------------------------------------
function which(cmd) {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    const p = path.join(dir, cmd)
    try {
      fs.accessSync(p, fs.constants.X_OK)
      return p
    } catch {
      /* sigue */
    }
  }
  return null
}

/** Ruta a yt-dlp o null. Prioridad: YTDLP (env) → tools/bin/yt-dlp → PATH. */
export function ytdlpPath() {
  if (YTDLP_ENV) return YTDLP_ENV
  try {
    fs.accessSync(YTDLP_LOCAL, fs.constants.X_OK)
    return YTDLP_LOCAL
  } catch {
    return which('yt-dlp')
  }
}

const MISSING_MESSAGE = 'Falta yt-dlp. Instálalo con "npm run setup" (queda en tools/bin/yt-dlp).'

let helpCache = { path: null, text: null }
async function helpText(bin) {
  if (helpCache.path === bin && helpCache.text != null) return helpCache.text
  try {
    const { stdout } = await run(bin, ['--help'], { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 })
    helpCache = { path: bin, text: stdout }
  } catch {
    helpCache = { path: bin, text: '' }
  }
  return helpCache.text
}

/**
 * Argumentos comunes. YouTube exige ahora un runtime de JavaScript: yt-dlp usa deno por defecto;
 * si no está, le damos el Node con el que corre este servidor (si su versión de yt-dlp lo admite).
 * YTDLP_EXTRA_ARGS permite añadir más (p. ej. --cookies archivo.txt).
 */
async function commonArgs(bin) {
  const args = []
  const help = await helpText(bin)
  if (help.includes('--js-runtimes') && !which('deno')) args.push('--js-runtimes', `node:${process.execPath}`)
  const extra = process.env.YTDLP_EXTRA_ARGS?.trim()
  if (extra) args.push(...extra.split(/\s+/))
  return args
}

export async function ytdlpVersion() {
  const bin = ytdlpPath()
  if (!bin) return { installed: false, path: null, version: null, local: false }
  try {
    const { stdout } = await run(bin, ['--version'], { timeout: 20_000 })
    return { installed: true, path: bin, version: stdout.trim(), local: bin === YTDLP_LOCAL }
  } catch (e) {
    // Existe pero no arranca (p. ej. versión de Python no soportada): devolver el motivo real
    const out = `${e.stderr ?? ''}${e.stdout ?? ''}`.trim().split('\n').filter(Boolean)
    const error = (out.findLast?.((l) => /error/i.test(l)) ?? out.at(-1) ?? e.message).slice(0, 300)
    return { installed: false, path: bin, version: null, local: bin === YTDLP_LOCAL, error }
  }
}

/** Actualiza yt-dlp con -U (funciona con el binario oficial; si se instaló con pip, lo dice en la salida). */
export async function updateYtdlp() {
  const before = await ytdlpVersion()
  if (!before.installed) throw new YtError('missing', MISSING_MESSAGE)
  let output = ''
  let ok = true
  try {
    const { stdout, stderr } = await run(before.path, ['-U'], { timeout: 180_000 })
    output = `${stdout}${stderr}`.trim()
  } catch (e) {
    ok = false
    output = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim() || e.message
  }
  helpCache = { path: null, text: null }
  const after = await ytdlpVersion()
  return { ok, before: before.version, after: after.version, output: output.slice(-4000) }
}

// ---------------------------------------------------------------------------
// Ejecutar y clasificar errores
// ---------------------------------------------------------------------------
/** Traduce la salida de error de yt-dlp a un YtError con mensaje para el usuario. */
export function classify(text) {
  const t = text ?? ''
  const last = t.split('\n').map((l) => l.trim()).filter((l) => /^ERROR:/.test(l)).at(-1) ?? t.trim().split('\n').at(-1) ?? ''
  const detail = last.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([\w-]{11}:\s*)?/, '').slice(0, 300)
  if (/live stream recording is not available|post_live|is being processed|still being processed|currently live|is live now/i.test(t)) {
    return new YtError('processing', 'YouTube todavía está procesando este stream.', detail)
  }
  if (/will begin in|Premieres in|is_upcoming|live event will begin|Premiere will begin/i.test(t)) {
    return new YtError('upcoming', 'Este directo todavía no empieza. Descárgalo cuando haya terminado.', detail)
  }
  if (/Private video|Video unavailable|has been removed|not available in your country|members-only|account associated with this video has been terminated|This video is not available|confirm your age/i.test(t)) {
    return new YtError('unavailable', `El video no está disponible (privado, borrado o restringido). Detalle: ${detail}`, detail)
  }
  if (/confirm you.?re not a bot|HTTP Error 429|Too Many Requests/i.test(t)) {
    return new YtError('blocked', `YouTube está limitando las descargas desde esta conexión. Espera un rato o actualiza yt-dlp en Ajustes. Detalle: ${detail}`, detail)
  }
  if (/Unable to download (webpage|API page)|getaddrinfo|Temporary failure in name resolution|Network is unreachable|timed out|Connection (refused|reset)|No route to host|URLError/i.test(t)) {
    return new YtError('network', 'No se pudo conectar con YouTube. Revisa tu conexión a internet.', detail)
  }
  return new YtError('failed', `yt-dlp falló: ${detail || 'error desconocido'}. Si YouTube cambió algo, actualiza yt-dlp en Ajustes.`, detail)
}

/**
 * Corre yt-dlp. onLine recibe cada línea de stdout/stderr (para el progreso).
 * Resuelve { stdout } si sale con 0; si no, rechaza con YtError.
 */
async function runYtdlp(args, { signal, onLine, collectStdout = false } = {}) {
  const bin = ytdlpPath()
  if (!bin) throw new YtError('missing', MISSING_MESSAGE)
  const v = await ytdlpVersion()
  if (!v.installed) throw new YtError('missing', `yt-dlp está instalado pero no arranca: ${v.error}. Ejecuta "npm run setup" para reinstalarlo.`)
  const full = [...(await commonArgs(bin)), ...args]
  return new Promise((resolve, reject) => {
    const child = spawn(bin, full, { stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const out = []
    const errTail = []
    let stderrAll = ''
    if (collectStdout) child.stdout.on('data', (c) => out.push(c))
    else readline.createInterface({ input: child.stdout }).on('line', (l) => onLine?.(l))
    readline.createInterface({ input: child.stderr }).on('line', (l) => {
      onLine?.(l)
      errTail.push(l)
      if (errTail.length > 40) errTail.shift()
      if (stderrAll.length < 20_000) stderrAll += l + '\n'
    })
    // Cancelar: matar el grupo completo (yt-dlp puede lanzar ffmpeg)
    const onAbort = () => {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        /* ya salió */
      }
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort)
      reject(e.code === 'ENOENT' ? new YtError('missing', MISSING_MESSAGE) : new YtError('failed', `No se pudo ejecutar yt-dlp: ${e.message}`))
    })
    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(new YtError('aborted', 'Cancelado.'))
      if (code === 0) return resolve({ stdout: Buffer.concat(out).toString('utf8') })
      reject(classify(errTail.join('\n') || stderrAll))
    })
  })
}

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`

/** Fecha ISO a partir de los campos de yt-dlp (timestamp de inicio > subida > YYYYMMDD). */
function isoDate(info) {
  const ts = info.release_timestamp ?? info.timestamp
  if (Number.isFinite(ts)) return new Date(ts * 1000).toISOString()
  const d = info.upload_date ?? info.release_date
  if (/^\d{8}$/.test(d ?? '')) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T12:00:00.000Z`
  return null
}

// ---------------------------------------------------------------------------
// Operaciones
// ---------------------------------------------------------------------------
/** Lista una pestaña del canal (p. ej. /streams) sin descargar media. Orden: más reciente primero. */
export async function listChannel(url, { signal } = {}) {
  const { stdout } = await runYtdlp(
    ['--flat-playlist', '-J', '--extractor-args', 'youtubetab:approximate_date', '--no-warnings', url],
    { signal, collectStdout: true },
  )
  const data = JSON.parse(stdout)
  return (data.entries ?? [])
    .filter((e) => e && typeof e.id === 'string' && e.id.length === 11)
    .map((e, i) => ({
      youtubeId: e.id,
      title: e.title ?? '(sin título)',
      durationSec: Number.isFinite(e.duration) ? e.duration : null,
      publishedAt: isoDate(e),
      liveStatus: e.live_status ?? null,
      position: i,
    }))
}

/** Metadatos de un video. Lanza YtError si no se puede consultar. */
export async function videoInfo(id, { signal } = {}) {
  const { stdout } = await runYtdlp(['-J', '--no-playlist', '--no-warnings', watchUrl(id)], { signal, collectStdout: true })
  const info = JSON.parse(stdout)
  return {
    title: info.title ?? null,
    durationSec: Number.isFinite(info.duration) ? info.duration : null,
    publishedAt: isoDate(info),
    liveStatus: info.live_status ?? null,
  }
}

const num = (s) => (s && s !== 'NA' && s !== 'None' ? Number(s) : null)

/**
 * Descarga la mejor pista de audio tal cual (sin convertir) en outDir/source.<ext>.
 * onProgress({ percent, downloadedBytes, totalBytes, speedBps, etaSec }).
 * Devuelve la ruta del archivo descargado.
 */
export async function downloadAudio(id, outDir, { signal, onProgress } = {}) {
  const template = 'download:@@%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s'
  let lastEmit = 0
  await runYtdlp(
    ['-f', 'bestaudio', '--no-playlist', '--no-mtime', '--newline', '--progress-template', template, '-o', path.join(outDir, 'source.%(ext)s'), watchUrl(id)],
    {
      signal,
      onLine: (line) => {
        const i = line.indexOf('@@')
        if (i < 0) return
        const [done, total, estimate, speed, eta] = line.slice(i + 2).split('|').map(num)
        const totalBytes = total ?? estimate
        const now = Date.now()
        if (now - lastEmit < 700 && !(totalBytes && done >= totalBytes)) return // máx. ~1,5 eventos/s
        lastEmit = now
        onProgress?.({
          percent: totalBytes ? Math.min(100, Math.round((done / totalBytes) * 1000) / 10) : null,
          downloadedBytes: done,
          totalBytes: totalBytes ? Math.round(totalBytes) : null,
          speedBps: speed ? Math.round(speed) : null,
          etaSec: eta,
        })
      },
    },
  )
  const file = fs.readdirSync(outDir).find((f) => f.startsWith('source.') && !/\.(part|ytdl|temp)$/.test(f) && !f.includes('.part-'))
  if (!file) throw new YtError('failed', 'yt-dlp terminó pero no se encontró el audio descargado.')
  return path.join(outDir, file)
}
