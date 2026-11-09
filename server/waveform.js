// Picos de forma de onda (1000 valores 0–1) calculados con ffmpeg en streaming.
// No usa Python ni torch, ni carga el audio completo en memoria.
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

const PEAKS = 1000
const RATE = 4000 // Hz: suficiente para la envolvente
const inflight = new Map()

function computePeaks(file, durationSec) {
  return new Promise((resolve, reject) => {
    const total = Math.max(PEAKS, Math.ceil(durationSec * RATE))
    const perBucket = total / PEAKS
    const peaks = new Float64Array(PEAKS)
    let index = 0
    let carry = Buffer.alloc(0)

    const ff = spawn('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let err = ''
    ff.stderr.on('data', (d) => (err += d).length > 4000 && (err = err.slice(-4000)))
    ff.stdout.on('data', (chunk) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk
      const n = Math.floor(buf.length / 4)
      for (let i = 0; i < n; i++) {
        const v = Math.abs(buf.readFloatLE(i * 4))
        const b = Math.min(PEAKS - 1, Math.floor(index / perBucket))
        if (v > peaks[b]) peaks[b] = v
        index++
      }
      carry = buf.subarray(n * 4)
    })
    ff.on('error', reject)
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg (${code}): ${err.trim()}`))
      const top = Math.max(...peaks) || 1
      resolve({
        peaks: Array.from(peaks, (v) => Math.round((v / top) * 1000) / 1000),
        durationSec: Math.round((index / RATE) * 100) / 100,
      })
    })
  })
}

/** Devuelve los picos cacheados en `cachePath`, calculándolos una sola vez (deduplicado). */
export async function getWaveform(audioPath, cachePath, durationSec) {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'))
  } catch {
    /* no está en caché */
  }
  if (!inflight.has(cachePath)) {
    const p = computePeaks(audioPath, durationSec)
      .then(async (wf) => {
        await fs.writeFile(cachePath + '.tmp', JSON.stringify(wf))
        await fs.rename(cachePath + '.tmp', cachePath)
        return wf
      })
      .finally(() => inflight.delete(cachePath))
    inflight.set(cachePath, p)
  }
  return inflight.get(cachePath)
}
