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
export const WEB_DIST = path.join(ROOT, 'web/dist')

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

export const jobDir = (id) => path.join(JOBS_DIR, id)
export const workDir = (id) => path.join(JOBS_DIR, id, 'work')
