// Cola de tareas que NO usan la GPU: descargas (yt-dlp, red) y exportaciones (ffmpeg, CPU).
// Una a la vez, en paralelo con la cola de la GPU (queue.js): una descarga no espera 40 min
// detrás de una mejora, y nunca hay dos motores en la GPU.
//
// Persistencia: el propio estado del episodio ('downloading' / 'exporting'). Al arrancar,
// library.js vuelve a encolar los que quedaron a medias.
import { log } from './log.js'

const queue = [] // { episodeId, kind, runner }
let current = null // { episodeId, kind, controller, done: Promise }
let stopping = false

/** Encola si el episodio no tiene ya una tarea. `runner({ signal })` gestiona sus propios estados. */
export function enqueueTask(episodeId, kind, runner) {
  if (stopping || hasTask(episodeId)) return false
  queue.push({ episodeId, kind, runner })
  setImmediate(pump)
  return true
}

export const hasTask = (episodeId) => current?.episodeId === episodeId || queue.some((t) => t.episodeId === episodeId)
export const currentTask = () => (current ? { episodeId: current.episodeId, kind: current.kind } : null)

/**
 * Cancela la tarea de un episodio. Devuelve 'dequeued' (no había empezado), 'aborted' (se detuvo)
 * o null (no tenía tarea). Si estaba corriendo, espera a que el runner termine de limpiar.
 */
export async function cancelTask(episodeId) {
  const i = queue.findIndex((t) => t.episodeId === episodeId)
  if (i >= 0) {
    queue.splice(i, 1)
    return 'dequeued'
  }
  if (current?.episodeId === episodeId) {
    current.controller.abort('cancel')
    await current.done
    return 'aborted'
  }
  return null
}

async function pump() {
  if (current || stopping || !queue.length) return
  const t = queue.shift()
  const controller = new AbortController()
  let finish
  current = { ...t, controller, done: new Promise((r) => (finish = r)) }
  try {
    await t.runner({ signal: controller.signal })
  } catch (e) {
    log(`tarea ${t.kind} de ${t.episodeId} falló sin control: ${e.stack ?? e.message}`)
  } finally {
    current = null
    finish()
    setImmediate(pump)
  }
}

/** Apagado: la tarea en curso se interrumpe con motivo 'shutdown' (el episodio queda para reanudar). */
export async function shutdownTasks() {
  stopping = true
  queue.length = 0
  if (current) {
    current.controller.abort('shutdown')
    await Promise.race([current.done, new Promise((r) => setTimeout(r, 10_000))])
  }
}
