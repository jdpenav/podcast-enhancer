// Acceso de invitados al puerto compartido: enlace secreto (?k=LLAVE) → cookie firmada.
// Sin llave ni cookie válidas, todo responde 404 en texto plano (para un bot, ahí no hay nada).
import crypto from 'node:crypto'
import { customAlphabet } from 'nanoid'
import { GUEST_COOKIE_DAYS } from './config.js'

const COOKIE = 'enh'
const MAX_AGE_SEC = GUEST_COOKIE_DAYS * 24 * 3600
const newVisitorId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 6)

/** Comparación en tiempo constante (se comparan hashes para que el largo no importe). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

export function notFound(reply) {
  return reply
    .code(404)
    .header('Content-Type', 'text/plain; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .send('Not Found')
}

/**
 * Hook onRequest del puerto compartido. Con la llave correcta en ?k= deja la cookie y redirige
 * a la URL limpia; con cookie válida marca req.viewer como invitado; si no, 404.
 */
export function guestAuth(shareKey) {
  // El secreto de la firma se deriva de la llave: rotar SHARE_KEY invalida todas las cookies
  const secret = crypto.createHmac('sha256', shareKey).update('enhancer-cookie-v1').digest()
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url')

  const makeCookie = (visitorId) => {
    const payload = `${visitorId}.${Math.floor(Date.now() / 1000)}`
    return `${COOKIE}=${payload}.${sign(payload)}; Max-Age=${MAX_AGE_SEC}; Path=/; HttpOnly; Secure; SameSite=Lax`
  }

  /** visitorId si la cookie es válida y no ha caducado; si no, null. */
  const readCookie = (header) => {
    const value = parseCookies(header)[COOKIE]
    const m = /^([0-9a-z]{6})\.(\d{1,12})\.([\w-]+)$/.exec(value ?? '')
    if (!m) return null
    const [, visitorId, iat, sig] = m
    if (!safeEqual(sig, sign(`${visitorId}.${iat}`))) return null
    if (Date.now() / 1000 - Number(iat) > MAX_AGE_SEC) return null
    return visitorId
  }

  return async function onRequest(req, reply) {
    const url = new URL(req.url, 'http://x')
    const key = url.searchParams.get('k')
    const visitorId = readCookie(req.headers.cookie)

    if (key !== null) {
      if (!safeEqual(key, shareKey)) return notFound(reply)
      // Llave correcta: conservar la identidad si ya tenía cookie (así no pierde sus trabajos)
      url.searchParams.delete('k')
      return reply
        .code(302)
        .header('Set-Cookie', makeCookie(visitorId ?? newVisitorId()))
        .header('Cache-Control', 'no-store')
        .header('Referrer-Policy', 'no-referrer')
        .redirect(url.pathname + url.search)
    }

    if (!visitorId) return notFound(reply)
    req.viewer = { role: 'guest', owner: visitorId }
    // Renovar la cookie al abrir la página: mientras la usen, no caduca
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) reply.header('Set-Cookie', makeCookie(visitorId))
  }
}
