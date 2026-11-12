import { useEffect, useState } from 'react'

/**
 * Router mínimo por hash (sin dependencias):
 *   #/                    → { name: 'enhance' }   (pantalla de inicio: subir y mejorar)
 *   #/biblioteca          → { name: 'library' }
 *   #/editor/<episodeId>  → { name: 'editor', id }
 *   #/ajustes             → { name: 'settings' }
 * El enlace antiguo #escuchar=<id> sigue funcionando (se trata como inicio).
 */
export function parseRoute(hash = window.location.hash) {
  const h = hash.replace(/^#/, '')
  if (h.startsWith('/biblioteca')) return { name: 'library' }
  if (h.startsWith('/ajustes')) return { name: 'settings' }
  const m = h.match(/^\/editor\/([\w-]+)/)
  if (m) return { name: 'editor', id: m[1] }
  return { name: 'enhance' }
}

export const routeHref = {
  enhance: '#/',
  library: '#/biblioteca',
  settings: '#/ajustes',
  editor: (id) => `#/editor/${id}`,
}

export function navigate(href) {
  if (window.location.hash !== href) window.location.hash = href
}

export function useRoute() {
  const [route, setRoute] = useState(() => parseRoute())
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
