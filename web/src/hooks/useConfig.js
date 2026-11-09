import { useEffect, useState } from 'react'

/** Carga GET /api/config; reintenta cada 3 s si falla. */
export function useConfig(api) {
  const [config, setConfig] = useState(null)
  useEffect(() => {
    if (!api) return
    let alive = true
    let timer
    const load = () =>
      api
        .getConfig()
        .then((c) => alive && setConfig(c))
        .catch(() => alive && (timer = setTimeout(load, 3000)))
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [api])
  return config
}
