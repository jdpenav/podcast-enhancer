// Estado del sistema: ffmpeg + GPU (nvidia-smi). Solo consultas: no usa la GPU.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
let ffmpegOk = null
let ffmpegCheckedAt = 0

export async function hasFfmpeg() {
  if (ffmpegOk !== null && Date.now() - ffmpegCheckedAt < 60_000) return ffmpegOk
  try {
    await run('ffmpeg', ['-version'], { timeout: 5000 })
    await run('ffprobe', ['-version'], { timeout: 5000 })
    ffmpegOk = true
  } catch {
    ffmpegOk = false
  }
  ffmpegCheckedAt = Date.now()
  return ffmpegOk
}

// nvidia-smi tarda ~200 ms: se cachea unos segundos (y se comparte entre peticiones simultáneas)
const GPU_CACHE_MS = 3000
let gpuCache = { at: 0, value: undefined, inflight: null }

/** { name, vramGB, tempC, memUsedMB } o null si no hay GPU NVIDIA. */
export function queryGpu() {
  if (gpuCache.value !== undefined && Date.now() - gpuCache.at < GPU_CACHE_MS) return Promise.resolve(gpuCache.value)
  gpuCache.inflight ??= queryGpuNow()
    .then((value) => {
      gpuCache = { at: Date.now(), value, inflight: null }
      return value
    })
    .finally(() => (gpuCache.inflight = null))
  return gpuCache.inflight
}

async function queryGpuNow() {
  try {
    const { stdout } = await run(
      'nvidia-smi',
      ['--query-gpu=name,memory.total,temperature.gpu,memory.used', '--format=csv,noheader,nounits'],
      { timeout: 5000 },
    )
    const [name, memTotal, temp, memUsed] = stdout.trim().split('\n')[0].split(',').map((s) => s.trim())
    return {
      name,
      vramGB: Math.round(Number(memTotal) / 1024),
      tempC: Number.isFinite(Number(temp)) ? Math.round(Number(temp)) : null,
      memUsedMB: Number(memUsed),
    }
  } catch {
    return null
  }
}

/** Forma exacta de GET /api/health. */
export async function getHealth({ busy }) {
  const [ffmpeg, gpu] = await Promise.all([hasFfmpeg(), queryGpu()])
  return {
    ok: true,
    ffmpeg,
    gpu: gpu ? { name: gpu.name, vramGB: gpu.vramGB, tempC: gpu.tempC, busy } : null,
  }
}
