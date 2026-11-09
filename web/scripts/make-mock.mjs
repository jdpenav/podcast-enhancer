// Genera los audios y picos de prueba para el modo mock en public/mock/.
//
// Uso:  npm run mock:assets                      # audio sintético (voz simulada + ruido)
//       npm run mock:assets -- ORIGINAL MEJORADO  # un par real "antes / después"
//
// Solo LEE los archivos de origen (ffmpeg los decodifica a una copia); nunca los modifica.
// Requiere ffmpeg en el PATH (usa CPU, no GPU).
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { existsSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(DIR, '../public/mock')
let [srcOriginal, srcResult] = process.argv.slice(2)
let tmpDir = null

const PEAKS = 1000
const PEAK_SR = 8000

function ffmpeg(args, { capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', capture ? 'pipe' : 'ignore', 'pipe'] })
    const chunks = []
    let err = ''
    if (capture) p.stdout.on('data', (c) => chunks.push(c))
    p.stderr.on('data', (c) => (err += c))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(err || `ffmpeg salió con ${code}`))))
  })
}

// Decodifica a float32 mono y toma el pico absoluto de cada uno de los 1000 tramos (0–1).
async function peaks(file) {
  const buf = await ffmpeg(['-i', file, '-ac', '1', '-ar', String(PEAK_SR), '-f', 'f32le', 'pipe:1'], { capture: true })
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
  const size = samples.length / PEAKS
  const out = new Array(PEAKS).fill(0)
  for (let i = 0; i < PEAKS; i++) {
    const end = Math.min(samples.length, Math.floor((i + 1) * size))
    let max = 0
    for (let j = Math.floor(i * size); j < end; j++) max = Math.max(max, Math.abs(samples[j]))
    out[i] = max
  }
  const top = Math.max(...out) || 1
  return { peaks: out.map((v) => Math.round((v / top) * 1000) / 1000), durationSec: samples.length / PEAK_SR }
}

/** Sin archivos de entrada: un tono modulado (simula voz) con y sin ruido rosa, 60 s. */
async function synthesize() {
  const dir = (tmpDir = mkdtempSync(path.join(os.tmpdir(), 'enhancer-mock-')))
  const voice = 'sine=frequency=180:duration=60,tremolo=f=3:d=0.9,volume=0.6'
  srcResult = path.join(dir, 'clean.wav')
  srcOriginal = path.join(dir, 'noisy.wav')
  await ffmpeg(['-f', 'lavfi', '-i', voice, srcResult])
  await ffmpeg(['-f', 'lavfi', '-i', voice, '-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.25:duration=60',
    '-filter_complex', 'amix=inputs=2:normalize=0', srcOriginal])
  console.log('→ audio sintético (sin archivos de entrada)')
}

async function main() {
  if (!srcOriginal || !srcResult) await synthesize()
  for (const f of [srcOriginal, srcResult]) if (!existsSync(f)) throw new Error(`No existe: ${f}`)
  await mkdir(OUT, { recursive: true })

  const jobs = [
    ['original', srcOriginal],
    ['result', srcResult],
  ]
  for (const [name, src] of jobs) {
    console.log(`→ ${name}: ${src}`)
    await ffmpeg(['-i', src, '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '128k', path.join(OUT, `${name}.mp3`)])
    await ffmpeg(['-i', src, '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', path.join(OUT, `${name}.wav`)])
    const wf = await peaks(src)
    await writeFile(path.join(OUT, `peaks-${name}.json`), JSON.stringify(wf))
  }
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true })
  console.log(`Listo: archivos en ${OUT}`)
}

main().catch((e) => {
  console.error('Error:', e.message)
  process.exit(1)
})
