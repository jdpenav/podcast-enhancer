// Estado del sistema para Ajustes: yt-dlp, ffmpeg, modelo, disco y configuración de la biblioteca.
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { ROOT, RSS_SYNC_HOURS, VOD_RETRY_MAX_HOURS, VOD_RETRY_MIN, YT_STREAMS_URL } from './config.js'
import { diskInfo } from './media.js'
import { ytdlpVersion } from './ytdlp.js'

const run = promisify(execFile)
export const MODEL_FILE = path.join(ROOT, 'modelos/resemble-enhance/enhancer_stage2/ds/G/default/mp_rank_00_model_states.pt')

async function ffmpegVersion() {
  try {
    const { stdout } = await run('ffmpeg', ['-version'], { timeout: 5000 })
    return { installed: true, version: stdout.split('\n')[0].match(/ffmpeg version (\S+)/)?.[1] ?? null }
  } catch {
    return { installed: false, version: null }
  }
}

export async function systemStatus() {
  const [ytDlp, ffmpeg, disk] = await Promise.all([ytdlpVersion(), ffmpegVersion(), diskInfo()])
  return {
    ytDlp: { installed: ytDlp.installed, version: ytDlp.version, path: ytDlp.path ? path.relative(ROOT, ytDlp.path).startsWith('..') ? ytDlp.path : path.relative(ROOT, ytDlp.path) : null, canUpdate: ytDlp.installed, error: ytDlp.error ?? null },
    ffmpeg,
    model: { present: fs.existsSync(MODEL_FILE) },
    disk,
    library: { channelUrl: YT_STREAMS_URL, vodRetryMin: VOD_RETRY_MIN, vodRetryMaxHours: VOD_RETRY_MAX_HOURS, rssSyncHours: RSS_SYNC_HOURS },
  }
}
