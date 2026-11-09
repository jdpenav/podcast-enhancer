import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

const byCreatedDesc = (a, b) => b.createdAt.localeCompare(a.createdAt)

function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return { ...state, loaded: true, jobs: [...action.jobs].sort(byCreatedDesc) }
    case 'upsert': {
      const exists = state.jobs.some((j) => j.id === action.job.id)
      const jobs = exists
        ? state.jobs.map((j) => (j.id === action.job.id ? action.job : j))
        : [action.job, ...state.jobs].sort(byCreatedDesc)
      return { ...state, jobs }
    }
    case 'progress':
      return {
        ...state,
        jobs: state.jobs.map((j) => (j.id === action.id ? { ...j, progress: action.progress } : j)),
      }
    case 'remove':
      return { ...state, jobs: state.jobs.filter((j) => j.id !== action.id) }
    default:
      return state
  }
}

/**
 * Estado en vivo del dashboard: trabajos + salud del sistema + conexión.
 * Carga inicial (listJobs, getHealth) y luego todo llega por SSE (/api/events).
 * `onTransition(job, prevStatus)` se llama cuando un trabajo cambia de estado (para avisos).
 */
export function useJobs(api, { onTransition } = {}) {
  const [state, dispatch] = useReducer(reducer, { jobs: [], loaded: false })
  const [health, setHealth] = useState(null)
  const [connected, setConnected] = useState(null) // null = aún no se sabe
  const jobsRef = useRef(state.jobs)
  jobsRef.current = state.jobs
  const transitionRef = useRef(onTransition)
  transitionRef.current = onTransition

  const upsert = useCallback((job) => {
    const prev = jobsRef.current.find((j) => j.id === job.id)
    if (prev && prev.status !== job.status) transitionRef.current?.(job, prev.status)
    dispatch({ type: 'upsert', job })
  }, [])

  const refresh = useCallback(async () => {
    if (!api) return
    // La lista no espera al health (nvidia-smi puede tardar): cada uno se pinta al llegar
    const health = api.getHealth().then(setHealth)
    dispatch({ type: 'set', jobs: await api.listJobs() })
    await health
  }, [api])

  useEffect(() => {
    if (!api) return
    let alive = true
    let hadError = false
    let retry

    const initial = () =>
      refresh()
        .then(() => alive && setConnected(true))
        .catch(() => {
          if (!alive) return
          setConnected(false)
          retry = setTimeout(initial, 3000)
        })
    initial()

    const close = api.subscribeEvents({
      onJob: (job) => upsert(job),
      onProgress: ({ id, progress }) => dispatch({ type: 'progress', id, progress }),
      onDeleted: ({ id }) => dispatch({ type: 'remove', id }),
      onHealth: (h) => setHealth(h),
      onOpen: () => {
        setConnected(true)
        // Tras una reconexión, resincronizar por si se perdieron eventos
        if (hadError) refresh().catch(() => {})
        hadError = false
      },
      onError: () => {
        hadError = true
        setConnected(false)
      },
    })

    return () => {
      alive = false
      clearTimeout(retry)
      close()
    }
  }, [api, refresh, upsert])

  // Acciones: devuelven el Job actualizado (o lanzan ApiError)
  const actions = {
    pause: async (id) => upsert(await api.pauseJob(id)),
    resume: async (id) => upsert(await api.resumeJob(id)),
    cancel: async (id) => upsert(await api.cancelJob(id)),
    remove: async (id) => {
      await api.deleteJob(id)
      dispatch({ type: 'remove', id })
    },
    added: (job) => upsert(job),
  }

  return { jobs: state.jobs, loaded: state.loaded, health, connected, actions }
}
