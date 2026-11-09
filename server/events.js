// Hub de Server-Sent Events: un solo stream (/api/events) por navegador.
// Cada cliente tiene un "viewer": el dueño recibe todo; un invitado, solo los eventos de sus trabajos.
const clients = new Map() // res → viewer

export function addClient(req, reply, initial = []) {
  const viewer = req.viewer
  reply.hijack()
  const res = reply.raw
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // que ningún proxy (Cloudflare incluido) acumule el stream
  })
  res.write('retry: 3000\n\n') // el navegador reintenta a los 3 s si se cae
  for (const [event, data] of initial) res.write(format(event, forViewer(event, data, viewer)))
  clients.set(res, viewer)
  req.raw.on('close', () => clients.delete(res))
}

function format(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/** Los invitados no ven la temperatura de la GPU. */
function forViewer(event, data, viewer) {
  if (event === 'health' && viewer?.role === 'guest' && data?.gpu) return { ...data, gpu: { ...data.gpu, tempC: null } }
  return data
}

const canSee = (viewer, owner) => owner === undefined || viewer?.role !== 'guest' || viewer.owner === owner

/**
 * Envía un evento a los clientes que pueden verlo.
 * `owner` = dueño del trabajo ('local' o id de invitado); sin owner (health) va a todos.
 */
export function broadcast(event, data, owner) {
  const cache = new Map()
  for (const [res, viewer] of clients) {
    if (!canSee(viewer, owner)) continue
    const role = viewer?.role ?? 'owner'
    if (!cache.has(role)) cache.set(role, format(event, forViewer(event, data, viewer)))
    try {
      res.write(cache.get(role))
    } catch {
      clients.delete(res)
    }
  }
}

// Comentario periódico para que proxies y navegador no cierren la conexión por inactividad
// (Cloudflare corta a los ~100 s sin tráfico)
setInterval(() => {
  for (const res of clients.keys()) {
    try {
      res.write(': ping\n\n')
    } catch {
      clients.delete(res)
    }
  }
}, 15_000).unref()

export function closeAll() {
  for (const res of clients.keys()) res.end()
  clients.clear()
}

export const clientCount = () => clients.size
