// Utilidades de archivos de audio compartidas: ffprobe, espacio libre, enlaces duros.
import fsp from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { DATA_DIR } from './config.js'
import { HttpError } from './errors.js'

const run = promisify(execFile)

/** Información básica con ffprobe: { durationSec, sampleRate, channels, bitRate } o null si no es audio. */
export async function probeAudio(file) {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=codec_type,sample_rate,channels', '-of', 'json', file],
      { timeout: 30_000 },
    )
    const info = JSON.parse(stdout)
    const audio = info.streams?.find((s) => s.codec_type === 'audio')
    const durationSec = Number(info.format?.duration)
    if (!audio || !(durationSec > 0)) return null
    return {
      durationSec,
      sampleRate: Number(audio.sample_rate) || null,
      channels: Number(audio.channels) || null,
      bitRate: Number(info.format?.bit_rate) || null,
    }
  } catch (e) {
    if (e.code === 'ENOENT') throw new HttpError(500, 'FFMPEG_MISSING', 'Falta ffmpeg en el servidor. Instálalo con: sudo apt install ffmpeg')
    return null
  }
}

/** Duración con ffprobe; null si no es un audio válido. */
export async function probe(file) {
  return (await probeAudio(file))?.durationSec ?? null
}

export async function freeBytes() {
  try {
    const s = await fsp.statfs(DATA_DIR)
    return s.bavail * s.bsize
  } catch {
    return Infinity
  }
}

export async function diskInfo() {
  try {
    const s = await fsp.statfs(DATA_DIR)
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }
  } catch {
    return null
  }
}

/**
 * Enlace duro de `src` en `dst` (mismo disco: instantáneo y sin ocupar espacio extra);
 * si no se puede (otro disco), copia. Ninguno de los dos archivos se modifica después,
 * así que compartir los datos es seguro. Reemplaza `dst` si existe.
 */
export async function linkOrCopy(src, dst) {
  await fsp.rm(dst, { force: true })
  try {
    await fsp.link(src, dst)
  } catch {
    await fsp.copyFile(src, dst)
  }
}

export const exists = (p) => fsp.stat(p).then((s) => s.isFile(), () => false)
