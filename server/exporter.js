// Exportación final con ffmpeg: [intro] + audio mejorado (sin los cortes) + [outro] → MP3 listo para Castbox.
//
//   - El navegador solo marca tiempos; aquí se ejecutan los cortes (atrim + acrossfade corto en cada unión).
//   - Todo se normaliza a la MISMA especificación (frecuencia, canales, formato) antes de concatenar:
//     si las cortinas tienen otro sample rate, concatenar sin esto da audio corrupto o a otra velocidad.
//   - Sonoridad con loudnorm en DOS pasadas (medir → aplicar en modo lineal) para que sea precisa.
//   - Una sola codificación con pérdida al final: MP3 CBR (no VBR: duración y búsqueda fiables).
import fsp from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { CASTBOX_MAX_BYTES, DEFAULT_PRESET, PRESET_LIMITS } from './config.js'
import { probeAudio } from './media.js'

export class ExportError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v))

/** Preajuste completo y válido a partir de uno parcial (lo que guarda el editor). */
export function normalizePreset(p = {}) {
  const d = DEFAULT_PRESET
  const n = (v, fb) => (Number.isFinite(Number(v)) ? Number(v) : fb)
  const bitrate = n(p.bitrateKbps, d.bitrateKbps)
  return {
    name: typeof p.name === 'string' && p.name ? p.name.slice(0, 40) : d.name,
    bitrateKbps: PRESET_LIMITS.bitrateKbps.includes(bitrate) ? bitrate : d.bitrateKbps,
    channels: PRESET_LIMITS.channels.includes(n(p.channels, d.channels)) ? n(p.channels, d.channels) : d.channels,
    sampleRate: d.sampleRate,
    lufs: clamp(n(p.lufs, d.lufs), PRESET_LIMITS.lufs),
    truePeak: d.truePeak,
    cutCrossfadeMs: clamp(Math.round(n(p.cutCrossfadeMs, d.cutCrossfadeMs)), PRESET_LIMITS.cutCrossfadeMs),
    curtainFadeSec: clamp(n(p.curtainFadeSec, d.curtainFadeSec), PRESET_LIMITS.curtainFadeSec),
  }
}

/** Segmentos a CONSERVAR (fuera de los cortes), ordenados y sin solapes. */
export function keepSegments(cuts, durationSec, minLen = 0.05) {
  const sorted = (cuts ?? [])
    .map((c) => ({ start: Math.max(0, Number(c.start)), end: Math.min(durationSec, Number(c.end)) }))
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
    .sort((a, b) => a.start - b.start)
  const merged = []
  for (const c of sorted) {
    const last = merged.at(-1)
    if (last && c.start <= last.end) last.end = Math.max(last.end, c.end)
    else merged.push({ ...c })
  }
  const keep = []
  let t = 0
  for (const c of merged) {
    if (c.start - t >= minLen) keep.push({ start: t, end: c.start })
    t = c.end
  }
  if (durationSec - t >= minLen) keep.push({ start: t, end: durationSec })
  return keep
}

const f3 = (x) => Number(x).toFixed(3)

/**
 * Grafo de filtros: devuelve { graph, expectedSec } con la salida en la etiqueta [mix].
 * Entradas: 0 = audio mejorado (enhanced.wav), 1 = intro (opcional), 2 = outro (opcional).
 */
export function buildGraph({ segments, preset, intro, outro, inputIndex }) {
  const fmt = `aresample=${preset.sampleRate},aformat=sample_fmts=fltp:sample_rates=${preset.sampleRate}:channel_layouts=${preset.channels === 1 ? 'mono' : 'stereo'}`
  const parts = []
  const n = segments.length
  parts.push(n > 1 ? `[0:a]${fmt},asplit=${n}${segments.map((_, i) => `[b${i}]`).join('')}` : `[0:a]${fmt}[b0]`)
  segments.forEach((s, i) => parts.push(`[b${i}]atrim=start=${f3(s.start)}:end=${f3(s.end)},asetpts=PTS-STARTPTS[s${i}]`))

  // Unir segmentos: crossfade corto (evita chasquidos) o concatenación simple
  const xf = preset.cutCrossfadeMs / 1000
  let expected = segments.reduce((sum, s) => sum + (s.end - s.start), 0)
  if (n === 1) parts.push('[s0]anull[body]')
  else if (xf > 0) {
    let prev = 's0'
    let prevLen = segments[0].end - segments[0].start
    for (let i = 1; i < n; i++) {
      const len = segments[i].end - segments[i].start
      const d = Math.min(xf, prevLen / 2, len / 2)
      const out = i === n - 1 ? 'body' : `j${i}`
      parts.push(`[${prev}][s${i}]acrossfade=d=${f3(d)}:c1=tri:c2=tri[${out}]`)
      expected -= d
      prevLen = prevLen + len - d
      prev = out
    }
  } else parts.push(`${segments.map((_, i) => `[s${i}]`).join('')}concat=n=${n}:v=0:a=1[body]`)

  // Cortinas
  const seq = []
  if (intro) {
    parts.push(`[${inputIndex.intro}:a]${fmt}[intro]`)
    seq.push({ label: 'intro', len: intro.durationSec })
  }
  seq.push({ label: 'body', len: expected })
  if (outro) {
    parts.push(`[${inputIndex.outro}:a]${fmt}[outro]`)
    seq.push({ label: 'outro', len: outro.durationSec })
  }
  expected = seq.reduce((sum, x) => sum + x.len, 0)
  if (seq.length === 1) parts.push('[body]anull[mix]')
  else if (preset.curtainFadeSec > 0) {
    let prev = seq[0]
    let prevLen = prev.len
    for (let i = 1; i < seq.length; i++) {
      const d = Math.min(preset.curtainFadeSec, prevLen / 2, seq[i].len / 2)
      const out = i === seq.length - 1 ? 'mix' : `c${i}`
      parts.push(`[${prev.label}][${seq[i].label}]acrossfade=d=${f3(d)}:c1=tri:c2=tri[${out}]`)
      expected -= d
      prevLen = prevLen + seq[i].len - d
      prev = { label: out }
    }
  } else parts.push(`${seq.map((x) => `[${x.label}]`).join('')}concat=n=${seq.length}:v=0:a=1[mix]`)

  return { graph: parts.join(';'), expectedSec: expected }
}

/** Corre ffmpeg con -progress; onTime(segundos de salida). Devuelve el stderr. */
function ffmpeg(args, { signal, onTime }) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-nostats', '-y', '-progress', 'pipe:1', ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    let buf = ''
    p.stdout.on('data', (d) => {
      buf += d
      const lines = buf.split('\n')
      buf = lines.pop()
      for (const l of lines) {
        const m = /^out_time_(?:us|ms)=(\d+)/.exec(l)
        if (m) onTime?.(Number(m[1]) / 1e6)
      }
    })
    p.stderr.on('data', (d) => {
      err += d
      if (err.length > 200_000) err = err.slice(-100_000)
    })
    const onAbort = () => p.kill('SIGTERM')
    signal?.addEventListener('abort', onAbort, { once: true })
    p.on('error', (e) => {
      signal?.removeEventListener('abort', onAbort)
      reject(e.code === 'ENOENT' ? new ExportError('FFMPEG_MISSING', 'Falta ffmpeg en el servidor. Instálalo con: sudo apt install ffmpeg') : e)
    })
    p.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (signal?.aborted) return reject(new ExportError('ABORTED', 'Cancelado.'))
      if (code !== 0) {
        const tail = err.trim().split('\n').filter((l) => !/^\s*$/.test(l)).slice(-3).join(' · ')
        return reject(new ExportError('EXPORT_FAILED', `ffmpeg no pudo exportar: ${tail.slice(0, 400)}`))
      }
      resolve(err)
    })
  })
}

/** Último bloque JSON que imprime loudnorm. */
function parseLoudnorm(stderr) {
  const blocks = stderr.match(/\{\s*"input_i"[\s\S]*?\}/g)
  if (!blocks) throw new ExportError('EXPORT_FAILED', 'No se pudo medir la sonoridad del audio (loudnorm).')
  const j = JSON.parse(blocks.at(-1))
  const out = {}
  for (const [k, v] of Object.entries(j)) out[k] = Number(v)
  return out
}

const finite = (x) => (Number.isFinite(x) ? x : null)

/** Sonoridad integrada y pico real del archivo FINAL (ya codificado), con el filtro ebur128. */
async function measureFile(file, { signal, onTime }) {
  const err = await ffmpeg(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '/dev/null'], { signal, onTime })
  const summary = err.slice(err.lastIndexOf('Summary:'))
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1])
  const truePeak = Number(summary.match(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/)?.[1])
  return { lufs: finite(lufs), truePeak: finite(truePeak) }
}

/**
 * Exporta. Parámetros:
 *   enhancedPath, outPath, cuts, intro/outro ({ path, durationSec, name } o null),
 *   preset (parcial), meta ({ title, date, podcastName }), signal, onProgress(percent, stage)
 * Devuelve el resumen que se guarda en el episodio (export).
 */
export async function exportAudio({ enhancedPath, outPath, cuts, intro, outro, preset: rawPreset, meta, signal, onProgress }) {
  const preset = normalizePreset(rawPreset)
  const info = await probeAudio(enhancedPath)
  if (!info) throw new ExportError('INVALID_FILE', 'El audio mejorado no se puede leer. Vuelve a mejorarlo.')
  const segments = keepSegments(cuts, info.durationSec)
  const keptSec = segments.reduce((s, x) => s + x.end - x.start, 0)
  if (keptSec < 1) throw new ExportError('INVALID_REQUEST', 'Los cortes eliminan todo el audio. Quita alguno y vuelve a exportar.')

  const inputs = ['-i', enhancedPath]
  const inputIndex = {}
  if (intro) {
    inputIndex.intro = inputs.length / 2
    inputs.push('-i', intro.path)
  }
  if (outro) {
    inputIndex.outro = inputs.length / 2
    inputs.push('-i', outro.path)
  }
  const { graph, expectedSec } = buildGraph({ segments, preset, intro, outro, inputIndex })
  const progress = (from, to, stage) => (t) => onProgress?.(Math.min(to, from + (to - from) * Math.min(1, t / expectedSec)), stage)

  // Pasada 1: medir
  onProgress?.(0, 'measuring')
  const lraTarget = 11
  const measureErr = await ffmpeg(
    [...inputs, '-filter_complex', `${graph};[mix]loudnorm=I=${preset.lufs}:TP=${preset.truePeak}:LRA=${lraTarget}:print_format=json[out]`, '-map', '[out]', '-f', 'null', '/dev/null'],
    { signal, onTime: progress(0, 45, 'measuring') },
  )
  const m = parseLoudnorm(measureErr)
  // Con LRA objetivo >= LRA medido, loudnorm puede aplicar una ganancia lineal (no comprime la dinámica)
  const lra = Math.min(20, Math.max(lraTarget, Math.ceil(m.input_lra || 0)))

  // Pasada 2: aplicar y codificar (loudnorm trabaja a 192 kHz internamente: volver a 44,1 kHz)
  const tmp = outPath.replace(/\.mp3$/, '.tmp.mp3')
  const year = meta.date ? String(new Date(meta.date).getFullYear()) : null
  const loud =
    `loudnorm=I=${preset.lufs}:TP=${preset.truePeak}:LRA=${lra}` +
    `:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
    `:offset=${m.target_offset}:linear=true:print_format=json,aresample=${preset.sampleRate}`
  try {
    const applyErr = await ffmpeg(
      [
        ...inputs,
        '-filter_complex', `${graph};[mix]${loud}[out]`,
        '-map', '[out]',
        '-c:a', 'libmp3lame', '-b:a', `${preset.bitrateKbps}k`, // -b:a en libmp3lame = CBR
        '-ar', String(preset.sampleRate), '-ac', String(preset.channels),
        '-map_metadata', '-1',
        '-id3v2_version', '3', '-write_id3v1', '0',
        '-metadata', `title=${meta.title}`,
        '-metadata', `artist=${meta.podcastName ?? 'Podcast'}`,
        '-metadata', `album=${meta.podcastName ?? 'Podcast'}`,
        '-metadata', 'genre=Podcast',
        ...(year ? ['-metadata', `date=${year}`] : []),
        '-f', 'mp3', tmp,
      ],
      { signal, onTime: progress(45, 92, 'encoding') },
    )
    const applied = parseLoudnorm(applyErr)

    // Validar antes de darlo por bueno: medir el MP3 real (no la señal antes de codificar)
    const measured = await measureFile(tmp, { signal, onTime: progress(92, 99, 'validating') })

    const out = await probeAudio(tmp)
    if (!out) throw new ExportError('EXPORT_FAILED', 'El MP3 exportado no se puede leer.')
    const sizeBytes = (await fsp.stat(tmp)).size
    await fsp.rename(tmp, outPath)
    const lufs = measured.lufs ?? finite(applied.output_i)
    const checks = {
      sizeOk: sizeBytes < CASTBOX_MAX_BYTES,
      durationOk: Math.abs(out.durationSec - expectedSec) <= Math.max(2, expectedSec * 0.005),
      loudnessOk: lufs != null && Math.abs(lufs - preset.lufs) <= 1,
    }
    return {
      exportedAt: new Date().toISOString(),
      durationSec: Math.round(out.durationSec * 100) / 100,
      expectedDurationSec: Math.round(expectedSec * 100) / 100,
      sizeBytes,
      bitrateKbps: out.bitRate ? Math.round(out.bitRate / 1000) : preset.bitrateKbps,
      sampleRate: out.sampleRate,
      channels: out.channels,
      lufs,
      truePeak: measured.truePeak ?? finite(applied.output_tp),
      inputLufs: finite(m.input_i),
      removedSec: Math.round((info.durationSec - keptSec) * 100) / 100,
      cuts: (cuts ?? []).length,
      intro: intro ? { id: intro.id, name: intro.name, durationSec: intro.durationSec } : null,
      outro: outro ? { id: outro.id, name: outro.name, durationSec: outro.durationSec } : null,
      preset,
      checks,
      castboxOk: checks.sizeOk && checks.durationOk,
    }
  } catch (e) {
    await fsp.rm(tmp, { force: true })
    throw e
  }
}
