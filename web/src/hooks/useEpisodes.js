import { useCallback, useEffect, useReducer, useRef } from 'react'

const dateOf = (e) => e.publishedAt ?? e.createdAt ?? ''
const byDateDesc = (a, b) => dateOf(b).localeCompare(dateOf(a))

function reducer(state, action) {
  switch (action.type) {
    case 'set':
      return { ...state, loaded: true, episodes: action.episodes }
    case 'reset':
      return { episodes: [], loaded: false }
    case 'upsert': {
      const exists = state.episodes.some((e) => e.id === action.episode.id)
      const episodes = exists
        ? state.episodes.map((e) => (e.id === action.episode.id ? action.episode : e))
        : [action.episode, ...state.episodes].sort(byDateDesc)
      return { ...state, episodes }
    }
    case 'progress':
      return { ...state, episodes: state.episodes.map((e) => (e.id === action.id ? { ...e, progress: action.progress } : e)) }
    case 'remove':
      return { ...state, episodes: state.episodes.filter((e) => e.id !== action.id) }
    default:
      return state
  }
}

/**
 * Biblioteca en vivo del espacio actual: carga inicial (GET /api/episodes?workspace=) y luego
 * cambios por SSE (los de otros espacios se ignoran).
 * `onTransition(episode, prevStatus)` se llama cuando un episodio cambia de estado (para avisos).
 */
export function useEpisodes(api, workspaceId, { onTransition } = {}) {
  const [state, dispatch] = useReducer(reducer, { episodes: [], loaded: false })
  const wsRef = useRef(workspaceId)
  wsRef.current = workspaceId
  const ref = useRef(state.episodes)
  ref.current = state.episodes
  const transitionRef = useRef(onTransition)
  transitionRef.current = onTransition

  const upsert = useCallback((episode) => {
    const prev = ref.current.find((e) => e.id === episode.id)
    if (prev && prev.status !== episode.status) transitionRef.current?.(episode, prev.status)
    dispatch({ type: 'upsert', episode })
    return episode
  }, [])

  const refresh = useCallback(async () => {
    if (!api || !workspaceId) return
    const episodes = await api.listEpisodes({ workspace: workspaceId })
    if (wsRef.current === workspaceId) dispatch({ type: 'set', episodes }) // ignorar respuestas de otro espacio
  }, [api, workspaceId])

  useEffect(() => {
    if (!api || !workspaceId) return
    dispatch({ type: 'reset' })
    let alive = true
    let hadError = false
    let retry
    const initial = () =>
      refresh().catch(() => {
        if (alive) retry = setTimeout(initial, 3000)
      })
    initial()
    const close = api.subscribeEvents({
      onEpisode: (ep) => ep.workspaceId === workspaceId && upsert(ep),
      onEpisodeProgress: ({ id, progress }) => dispatch({ type: 'progress', id, progress }),
      onEpisodeDeleted: ({ id }) => dispatch({ type: 'remove', id }),
      onLibrary: (e) => (!e?.workspaceId || e.workspaceId === workspaceId) && refresh().catch(() => {}),
      onOpen: () => {
        if (hadError) refresh().catch(() => {})
        hadError = false
      },
      onError: () => {
        hadError = true
      },
    })
    return () => {
      alive = false
      clearTimeout(retry)
      close()
    }
  }, [api, workspaceId, refresh, upsert])

  // Acciones: devuelven el Episode actualizado (o lanzan ApiError)
  const actions = {
    download: async (id) => upsert(await api.downloadEpisode(id)),
    retry: async (id) => upsert(await api.retryEpisode(id)),
    cancel: async (id) => upsert(await api.cancelEpisode(id)),
    rename: async (id, title) => upsert(await api.renameEpisode(id, title)),
    remove: async (id) => {
      const ep = await api.deleteEpisode(id)
      if (ep) upsert(ep)
      else dispatch({ type: 'remove', id })
    },
    saveEdit: async (id, editState) => upsert(await api.saveEpisodeEdit(id, editState)),
    export: async (id) => upsert(await api.exportEpisode(id)),
    sync: async (opts) => {
      const r = await api.syncEpisodes({ ...opts, workspace: workspaceId })
      await refresh()
      return r
    },
    upsert,
    refresh,
  }

  return { episodes: state.episodes, loaded: state.loaded, actions }
}
