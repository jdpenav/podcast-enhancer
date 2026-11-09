// Inspección y parada segura de procesos del motor (Linux /proc).
// Identifica el motor por su argv EXACTO (argv[0] = python…, argv[1] = …/enhance_long.py),
// nunca buscando texto en la línea de comando (eso también encuentra shells que lo mencionan).
import fs from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { JOBS_DIR, STOP_GRACE_MS, STOP_TERM_MS } from './config.js'

export function readArgv(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/cmdline`)
    return raw.toString('utf8').split('\0').filter(Boolean)
  } catch {
    return null
  }
}

/** Vivo y no zombi. */
export function isAlive(pid) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
  } catch (e) {
    if (e.code === 'ESRCH') return false
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3)
    return state !== 'Z'
  } catch {
    return false
  }
}

export function isEngineArgv(argv) {
  return !!argv && /python[\d.]*$/.test(argv[0]) && /enhance_long\.py$/.test(argv[1] ?? '')
}

/** Todos los motores vivos en el sistema: [{ pid, argv, ours, jobId }] */
export function listEngines() {
  const out = []
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue
    const pid = Number(name)
    const argv = readArgv(pid)
    if (!isEngineArgv(argv) || !isAlive(pid)) continue
    // Es "nuestro" si trabaja dentro de data/jobs/<id>/
    const inside = argv.find((a) => a.startsWith(JOBS_DIR + '/'))
    const jobId = inside ? inside.slice(JOBS_DIR.length + 1).split('/')[0] : null
    out.push({ pid, argv, ours: !!jobId, jobId })
  }
  return out
}

async function waitExit(pid, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!isAlive(pid)) return true
    await sleep(200)
  }
  return !isAlive(pid)
}

function signal(pid, sig, group = false) {
  try {
    process.kill(group ? -pid : pid, sig)
    return true
  } catch {
    return false
  }
}

/**
 * Detiene un proceso del motor de forma escalonada:
 * 1. SIGINT al motor → se pausa guardando avance (sale con 130).
 * 2. Si no sale en `graceMs`: SIGTERM a todo su grupo (incluye ffmpeg hijo).
 * 3. Si sigue: SIGKILL al grupo.
 * El motor se lanza con detached:true, así que su PID es también el ID de su grupo.
 * @returns {'exited'|'sigint'|'sigterm'|'sigkill'|'stuck'}
 */
export async function stopEngine(pid, { graceMs = STOP_GRACE_MS, termMs = STOP_TERM_MS, log = console.log } = {}) {
  if (!isAlive(pid)) return 'exited'
  signal(pid, 'SIGINT')
  if (await waitExit(pid, graceMs)) return 'sigint'
  log(`[motor ${pid}] no respondió a SIGINT en ${graceMs / 1000} s: SIGTERM al grupo`)
  signal(pid, 'SIGTERM', true) || signal(pid, 'SIGTERM')
  if (await waitExit(pid, termMs)) return 'sigterm'
  log(`[motor ${pid}] no respondió a SIGTERM: SIGKILL al grupo`)
  signal(pid, 'SIGKILL', true) || signal(pid, 'SIGKILL')
  return (await waitExit(pid, 5000)) ? 'sigkill' : 'stuck'
}
