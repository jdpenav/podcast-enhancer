// Lanza el motor de Python como proceso hijo y traduce su salida "@@{json}" a eventos.
import fs from 'node:fs'
import readline from 'node:readline'
import { spawn } from 'node:child_process'
import { COOLDOWN_SEC, ENGINE, PYTHON, ROOT } from './config.js'
import { files, findMode } from './jobs.js'

// Ruido conocido de librerías al importar (normal, se ignora para los mensajes de error)
const NOISE = /pynvml|ds_accelerator|real_accelerator|FutureWarning|UserWarning|warnings\.warn|DeprecationWarning/i

/**
 * @param {object} job
 * @param {{ onEvent: (ev: object) => void, onExit: (r: { code: number|null, signal: string|null, stderrTail: string[] }) => void }} handlers
 * @returns {{ pid: number, child: import('node:child_process').ChildProcess }}
 */
export function spawnEngine(job, { onEvent, onExit }) {
  const f = files(job)
  const m = findMode(job.mode, job.quality)
  const args = [
    ENGINE,
    f.original,
    f.wav,
    '--also-mp3', f.mp3,
    '--mode', job.mode,
    ...(job.mode === 'enhance' ? ['--nfe', String(m.nfe)] : []),
    '--work-dir', f.work,
    '--cooldown', String(COOLDOWN_SEC),
    // Si este servidor muere (incluso kill -9), el motor se pausa solo en ~2 s
    '--parent-pid', String(process.pid),
  ]

  const log = fs.createWriteStream(f.log, { flags: 'a' })
  log.write(`\n=== ${new Date().toISOString()} ${PYTHON} ${args.join(' ')}\n`)

  // detached: grupo de procesos propio → un Ctrl+C en la terminal no le llega directo
  // (el servidor decide cómo pausarlo) y se puede matar el grupo entero (ffmpeg incluido).
  const child = spawn(PYTHON, args, {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONWARNINGS: 'ignore' },
  })

  const stderrTail = []
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    log.write(line + '\n')
    if (!line.startsWith('@@')) return
    try {
      onEvent(JSON.parse(line.slice(2)))
    } catch (e) {
      log.write(`[servidor] evento ilegible: ${e.message}\n`)
    }
  })
  readline.createInterface({ input: child.stderr }).on('line', (line) => {
    log.write('[stderr] ' + line + '\n')
    if (!NOISE.test(line) && line.trim()) {
      stderrTail.push(line)
      if (stderrTail.length > 30) stderrTail.shift()
    }
  })

  let exited = false
  const finish = (code, signal) => {
    if (exited) return
    exited = true
    log.end(`=== salida code=${code} signal=${signal}\n`)
    onExit({ code, signal, stderrTail })
  }
  child.on('exit', finish)
  child.on('error', (err) => {
    // p. ej. venv/bin/python no existe
    stderrTail.push(err.message)
    finish(null, null)
  })

  return { pid: child.pid, child }
}
