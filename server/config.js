// Configuración central del servidor. Todo se puede sobrescribir con variables de entorno.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ENV_FILE = path.join(ROOT, '.env')
// .env opcional (SHARE_KEY, etc.). Las variables ya definidas en el entorno tienen prioridad.
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data'))
export const JOBS_DIR = path.join(DATA_DIR, 'jobs')
export const DB_PATH = path.join(DATA_DIR, 'jobs.db')
export const EPISODES_DIR = path.join(DATA_DIR, 'episodes')
export const ASSETS_DIR = path.join(DATA_DIR, 'assets')
export const WEB_DIST = path.resolve(process.env.WEB_DIST ?? path.join(ROOT, 'web/dist'))

export const PYTHON = process.env.PYTHON ?? path.join(ROOT, 'venv/bin/python')
export const ENGINE = process.env.ENGINE_PATH ?? path.join(ROOT, 'engine/enhance_long.py')

export const PORT = Number(process.env.PORT ?? 3000)
// Solo local: nadie más en la red puede subir audios ni usar la GPU
export const HOST = process.env.HOST ?? 'localhost' // 127.0.0.1 + ::1 (WSL reenvía ::1 a Windows)
export const PRODUCTION = process.env.NODE_ENV === 'production'

// Modo compartido (npm run share): segundo puerto para invitados detrás de Cloudflare Tunnel.
// Solo escucha en 127.0.0.1: el único que llega a él es cloudflared.
export const SHARE = process.argv.includes('--share') || process.env.SHARE === '1'
export const SHARE_PORT = Number(process.env.SHARE_PORT ?? 3001)
export const SHARE_HOST = '127.0.0.1'
export const SHARE_KEY = process.env.SHARE_KEY ?? ''
export const SHARE_KEY_MIN_LENGTH = 20
export const GUEST_MAX_UPLOAD_MB = 95 // el plan gratis de Cloudflare corta peticiones > 100 MB
export const GUEST_MAX_ACTIVE = 2 // trabajos pending/processing/paused por invitado
export const GUEST_COOKIE_DAYS = 90

// Pausa (s) entre grupos para bajar la temperatura de la GPU (0 = sin pausa)
export const COOLDOWN_SEC = Number(process.env.COOLDOWN_SEC ?? 0)

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB ?? 500)
export const ACCEPTED_TYPES = ['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.flac', '.mp4']
// Espacio libre mínimo: ~1,5 GB por hora de audio (WAV decodificado, partes, resultados) + margen
export const MIN_FREE_BYTES_PER_SEC = 450_000
export const MIN_FREE_BYTES = 1024 ** 3

// Tiempos para detener el motor: SIGINT (pausa ordenada) → SIGTERM → SIGKILL al grupo
export const STOP_GRACE_MS = Number(process.env.STOP_GRACE_MS ?? 30_000)
export const STOP_TERM_MS = Number(process.env.STOP_TERM_MS ?? 10_000)
export const HEALTH_INTERVAL_MS = Number(process.env.HEALTH_INTERVAL_MS ?? 10_000)

/** Modos ofrecidos. `factor` = segundos de proceso por segundo de audio (medidos en una GPU de 4 GB de gama de entrada). */
export const MODES = [
  { mode: 'denoise', quality: null, nfe: null, label: 'Limpiar ruido', description: 'Quita el ruido de fondo. Rápido.', factor: 0.06 },
  { mode: 'enhance', quality: 'standard', nfe: 32, label: 'Mejora completa · Estándar', description: 'Voz tipo estudio. Buen balance.', factor: 0.68 },
  { mode: 'enhance', quality: 'max', nfe: 64, label: 'Mejora completa · Máxima', description: 'La mejor calidad. Más lento.', factor: 1.02 },
]

// Para recalibrar los factores solo se usan trabajos de al menos 5 min (en clips cortos domina la carga del modelo)
export const CALIBRATION_MIN_DURATION_SEC = 300
export const CALIBRATION_SAMPLES = 5

// ---------------------------------------------------------------------------
// Biblioteca (Feature 1): canal de YouTube y descargas con yt-dlp
// ---------------------------------------------------------------------------
// yt-dlp: YTDLP=ruta, o tools/bin/yt-dlp (lo instala npm run setup), o el del PATH
export const YTDLP_LOCAL = path.join(ROOT, 'tools/bin/yt-dlp')
export const YTDLP_ENV = process.env.YTDLP ?? null
// Canal de YouTube de la biblioteca: se configura en .env (ver .env.example). Sin canal, la biblioteca
// funciona igual con los audios subidos; solo "Sincronizar con YouTube" pide configurarlo.
export const YT_CHANNEL_ID = process.env.YT_CHANNEL_ID?.trim() || null
export const YT_STREAMS_URL =
  process.env.YT_STREAMS_URL?.trim() || (YT_CHANNEL_ID ? `https://www.youtube.com/channel/${YT_CHANNEL_ID}/streams` : null)
// Revisión automática del RSS (solo detecta streams nuevos; nunca descarga ni procesa sola). 0 = desactivada
export const RSS_SYNC_HOURS = Number(process.env.RSS_SYNC_HOURS ?? 3)
// Stream recién terminado que YouTube todavía procesa: reintentar cada N min, hasta M horas
export const VOD_RETRY_MIN = Number(process.env.VOD_RETRY_MIN ?? 30)
export const VOD_RETRY_MAX_HOURS = Number(process.env.VOD_RETRY_MAX_HOURS ?? 12)

// ---------------------------------------------------------------------------
// Editor y exportación (Feature 2)
// ---------------------------------------------------------------------------
export const PODCAST_NAME = process.env.PODCAST_NAME?.trim() || 'Podcast' // artista y álbum en las etiquetas ID3
export const PEAKS_PER_SEC = 20 // resolución de la onda del editor (1200 picos por minuto)
export const CASTBOX_MAX_BYTES = 400 * 1024 * 1024
export const MAX_ASSET_MB = 50
/** Preajuste "Castbox (voz)": MP3 CBR mono 44,1 kHz, -16 LUFS / -1 dBTP. */
export const DEFAULT_PRESET = {
  name: 'castbox',
  bitrateKbps: 128,
  channels: 1,
  sampleRate: 44100,
  lufs: -16,
  truePeak: -1,
  cutCrossfadeMs: 20, // unión entre segmentos al quitar cortes (evita chasquidos)
  curtainFadeSec: 0, // 0 = corte seco entre cortina y contenido
}
export const PRESET_LIMITS = {
  bitrateKbps: [64, 96, 128, 160, 192, 256, 320],
  channels: [1, 2],
  lufs: [-24, -12],
  cutCrossfadeMs: [0, 200],
  curtainFadeSec: [0, 5],
}

export const episodeDir = (id) => path.join(EPISODES_DIR, id)
export const jobDir = (id) => path.join(JOBS_DIR, id)
export const workDir = (id) => path.join(JOBS_DIR, id, 'work')
