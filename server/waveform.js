// Picos de forma de onda (valores 0–1) calculados con ffmpeg en streaming.
// No usa Python ni torch, ni carga el audio completo en memoria.
//  - Reproductor de resultados: 1000 picos fijos.
//  - Editor: picos por segundo (PEAKS_PER_SEC) para poder hacer zoom sin decodificar en el navegador.
// Se eligió ffmpeg en lugar de audiowaveform (BBC) porque este necesita sudo + PPA para instalarse.
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

const PEAKS = 1000
const RATE = 4000 // Hz: suficiente para la envolvente
const inflight = new Map()

function computePeaks(file, durationSec, points = PEAKS) {
  return new Promise((resolve, reject) => {
    const total = Math.max(points, Math.ceil(durationSec * RATE))
    const perBucket = total / points
    const peaks = new Float64Array(points)
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
        const b = Math.min(points - 1, Math.floor(index / perBucket))
        if (v > peaks[b]) peaks[b] = v
        index++
      }
      carry = buf.subarray(n * 4)
    })
    ff.on('error', reject)
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg (${code}): ${err.trim()}`))
      let top = 0
      for (const v of peaks) if (v > top) top = v
      top ||= 1
      // Con muchos puntos, 2 decimales bastan y el JSON pesa ~40 % menos
      const scale = points > PEAKS ? 100 : 1000
      resolve({
        peaks: Array.from(peaks, (v) => Math.round((v / top) * scale) / scale),
        durationSec: Math.round((index / RATE) * 100) / 100,
      })
    })
  })
}

/**
 * Devuelve los picos cacheados en `cachePath`, calculándolos una sola vez (deduplicado).
 * `pointsPerSec`: si se indica, la cantidad de picos es proporcional a la duración (editor).
 */
export async function getWaveform(audioPath, cachePath, durationSec, { pointsPerSec } = {}) {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'))
  } catch {
    /* no está en caché */
  }
  if (!inflight.has(cachePath)) {
    const points = pointsPerSec ? Math.max(PEAKS, Math.ceil(durationSec * pointsPerSec)) : PEAKS
    const p = computePeaks(audioPath, durationSec, points)
      .then(async (wf) => {
        if (pointsPerSec) wf.pointsPerSec = pointsPerSec
        await fs.writeFile(cachePath + '.tmp', JSON.stringify(wf))
        await fs.rename(cachePath + '.tmp', cachePath)
        return wf
      })
      .finally(() => inflight.delete(cachePath))
    inflight.set(cachePath, p)
  }
  return inflight.get(cachePath)
}
