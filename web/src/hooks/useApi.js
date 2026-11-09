import { useEffect, useState } from 'react'
import { loadApi } from '../api/index.js'

/** Resuelve qué API usar (real o mock). Devuelve null mientras decide. */
export function useApi() {
  const [state, setState] = useState(null)
  useEffect(() => {
    let alive = true
    loadApi().then((s) => alive && setState(s))
    return () => {
      alive = false
    }
  }, [])
  return state
}
