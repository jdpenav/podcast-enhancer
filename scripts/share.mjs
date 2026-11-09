// npm run share — Arranca Enhancer con el puerto compartido y abre el túnel de Cloudflare.
//
//   npm run share                 # servidor (3000 dueño + 3001 invitados) + cloudflared
//   npm run share -- --rotate     # genera una llave nueva: los enlaces y cookies anteriores dejan de valer
//   npm run share -- --local      # sin túnel (para probar el puerto compartido en local)
//
// Guía de configuración: docs/sharing.md
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, '.env')
const GUIDE = 'docs/sharing.md'
const OWNER_PORT = Number(process.env.PORT ?? 3000)
const SHARE_PORT = Number(process.env.SHARE_PORT ?? 3001)
const CF_CONFIG = process.env.CLOUDFLARED_CONFIG ?? path.join(os.homedir(), '.cloudflared', 'config.yml')
const args = new Set(process.argv.slice(2))
const LOCAL = args.has('--local')

const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, y: (s) => `\x1b[33m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` }
const say = (s) => console.log(`${c.b('[share]')} ${s}`)
const die = (s) => {
  console.error(`${c.b('[share]')} ${c.r('✗')} ${s}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// 1. Llave secreta en .env
// ---------------------------------------------------------------------------
function newKey() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' // sin caracteres confundibles
  return Array.from(crypto.randomBytes(24), (b) => abc[b % abc.length]).join('')
}

function ensureKey() {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''
  const current = /^SHARE_KEY=(.*)$/m.exec(text)?.[1]?.trim()
  if (current && current.length >= 20 && !args.has('--rotate')) return current
  const key = newKey()
  text = current !== undefined ? text.replace(/^SHARE_KEY=.*$/m, `SHARE_KEY=${key}`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}SHARE_KEY=${key}\n`
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 })
  say(current ? c.y('Llave nueva generada: los enlaces anteriores ya no funcionan.') : 'Llave secreta creada en .env')
  return key
}

// ---------------------------------------------------------------------------
// 2. Configuración de cloudflared
// ---------------------------------------------------------------------------
function readTunnelConfig() {
  if (spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).error) {
    die(`Falta cloudflared. Instálalo siguiendo ${GUIDE} (sección "Configuración única"), o usa --local.`)
  }
  if (!fs.existsSync(CF_CONFIG)) die(`No existe ${CF_CONFIG}. Crea el túnel siguiendo ${GUIDE}, o usa --local.`)
  const yml = fs.readFileSync(CF_CONFIG, 'utf8')
  const hostname = /hostname:\s*["']?([^\s"'#]+)/.exec(yml)?.[1]
  if (!hostname) die(`${CF_CONFIG} no tiene "hostname:". Revisa ${GUIDE}.`)
  // Seguridad: el túnel solo puede apuntar al puerto compartido (el 3000 no exige llave)
  const services = [...yml.matchAll(/service:\s*["']?(https?:\/\/[^\s"'#]+)/g)].map((m) => m[1])
  const bad = services.filter((s) => {
    const u = new URL(s)
    return !['127.0.0.1', 'localhost'].includes(u.hostname) || Number(u.port) !== SHARE_PORT
  })
  if (!services.length || bad.length) {
    die(`${CF_CONFIG} debe apuntar solo a http://127.0.0.1:${SHARE_PORT} (encontrado: ${(bad.length ? bad : ['ninguno']).join(', ')}). Apuntar al ${OWNER_PORT} expondría la app sin llave.`)
  }
  return { hostname }
}

// ---------------------------------------------------------------------------
// 3. Utilidades de red
// ---------------------------------------------------------------------------
async function probe(url) {
  try {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1500) })
    return { status: r.status, text: await r.text() }
  } catch {
    return null
  }
}

async function waitFor(fn, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 300))
  }
  return null
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
const key = ensureKey()
const tunnel = LOCAL ? null : readTunnelConfig()

if (await probe(`http://localhost:${OWNER_PORT}/api/health`)) {
  die(`Ya hay un servidor en el puerto ${OWNER_PORT} (¿npm start abierto en otra terminal?). Ciérralo con Ctrl+C y vuelve a intentar.`)
}

say('Compilando el frontend…')
if (spawnSync('npm', ['run', 'build', '--silent'], { cwd: ROOT, stdio: 'inherit' }).status !== 0) die('Falló el build del frontend.')

const server = spawn(process.execPath, ['server/index.js', '--share'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', SHARE_KEY: key },
})
let cloudflared = null
let stopping = false

server.on('exit', (code) => {
  if (!stopping) console.error(`${c.b('[share]')} ${c.r('✗')} El servidor se cerró (código ${code}).`)
  stopping = true
  if (!cloudflared || cloudflared.exitCode !== null) process.exit(code ?? 0)
  // Cerrar el túnel (un segundo SIGINT lo cierra sin esperar conexiones abiertas) y salir
  cloudflared.on('exit', () => process.exit(code ?? 0))
  cloudflared.kill('SIGINT')
  setTimeout(() => cloudflared.kill('SIGKILL'), 5000).unref()
})

// Antes de abrir el túnel: comprobar que el puerto compartido rechaza a quien no tiene llave
const guarded = await waitFor(async () => {
  const r = await probe(`http://127.0.0.1:${SHARE_PORT}/api/health`)
  return r && r.status === 404 && r.text === 'Not Found' ? r : null
}, 20_000)
if (!guarded) {
  stopping = true
  server.kill('SIGTERM')
  die(`El puerto ${SHARE_PORT} no respondió con la protección activa. No se abre el túnel.`)
}

const link = tunnel ? `https://${tunnel.hostname}/?k=${key}` : `http://127.0.0.1:${SHARE_PORT}/?k=${key}`

if (!tunnel) {
  say(`Modo local (sin túnel). Invitado de prueba: ${link}`)
  say('Ctrl+C para cerrar.')
} else {
  say('Abriendo el túnel de Cloudflare…')
  const logFile = path.join(ROOT, 'data', 'cloudflared.log')
  const log = fs.createWriteStream(logFile, { flags: 'a' })
  cloudflared = spawn('cloudflared', ['tunnel', '--config', CF_CONFIG, 'run'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
  let connected = false
  const onLine = (chunk) => {
    log.write(chunk)
    const text = chunk.toString()
    if (!connected && /Registered tunnel connection/i.test(text)) {
      connected = true
      console.log(`
${c.g('✓')} ${c.b('Compartiendo.')} Manda este enlace a quien quieras dar acceso:

    ${c.b(link)}

  Tú: ${c.b(`http://localhost:${OWNER_PORT}`)}   ${c.d(`(log del túnel: data/cloudflared.log)`)}
  ${c.d('Ctrl+C para dejar de compartir. Los trabajos en curso quedan en pausa.')}
`)
    }
    if (/\bERR\b/.test(text) && !stopping) {
      // "canceled by remote … code 0" = el navegador cerró la conexión (p. ej. cerró la pestaña): normal
      const line = text.split('\n').find((l) => /\bERR\b/.test(l) && !/canceled by remote with error code 0/.test(l))
      if (line) console.error(`${c.b('[túnel]')} ${c.y(line.replace(/^\S+\s+ERR\s*/, '').slice(0, 200))}`)
    }
  }
  cloudflared.stdout.on('data', onLine)
  cloudflared.stderr.on('data', onLine)
  cloudflared.on('error', (e) => console.error(`${c.b('[share]')} ${c.r('✗')} cloudflared: ${e.message}`))
  cloudflared.on('exit', (code) => {
    log.end()
    if (stopping) return
    console.error(`${c.b('[share]')} ${c.r('✗')} El túnel se cerró (código ${code}); los invitados ya no tienen acceso. Detalle en data/cloudflared.log.`)
    console.error(`${c.b('[share]')} La app sigue disponible para ti en http://localhost:${OWNER_PORT}. Ctrl+C para cerrar.`)
  })
  setTimeout(() => {
    if (!connected && !stopping) console.error(`${c.b('[share]')} ${c.y('El túnel tarda en conectar. Revisa tu internet o data/cloudflared.log.')}`)
  }, 20_000).unref()
}

// Ctrl+C: la terminal ya envía SIGINT a todo el grupo (servidor y cloudflared). El servidor pausa
// el trabajo en curso y sale; al salir él, se cierra el túnel. SIGTERM (p. ej. kill) se reenvía.
process.on('SIGINT', () => {
  if (!stopping) say('Cerrando…')
  stopping = true
})
process.on('SIGTERM', () => {
  stopping = true
  server.kill('SIGTERM')
  cloudflared?.kill('SIGINT')
})
