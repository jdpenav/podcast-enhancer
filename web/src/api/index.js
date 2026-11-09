// Elige la implementación de la API:
//  - mock si VITE_MOCK=1
//  - mock si estamos en desarrollo y /api/health no responde (backend aún no existe)
//  - en cualquier otro caso, el cliente real (si el backend se cae, la UI muestra el aviso de conexión)
// Cuando el backend esté listo, basta con no pasar VITE_MOCK.
import * as client from './client.js'

export { ApiError } from './client.js'

async function backendAlive() {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const res = await fetch('/api/health', { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) return false
    const data = await res.json()
    return data?.ok === true
  } catch {
    return false
  }
}

let selected

/** @returns {Promise<{ api: typeof client, mock: boolean }>} */
export function loadApi() {
  selected ??= (async () => {
    const forced = import.meta.env.VITE_MOCK === '1'
    if (forced || (import.meta.env.DEV && !(await backendAlive()))) {
      const mock = await import('./mock.js')
      if (!forced) console.info('[api] Backend no disponible: usando datos simulados (modo mock).')
      return { api: mock, mock: true }
    }
    return { api: client, mock: false }
  })()
  return selected
}
