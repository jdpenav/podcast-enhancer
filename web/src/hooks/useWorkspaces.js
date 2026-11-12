import { useCallback, useEffect, useState } from 'react'

const KEY = 'enhancer-workspace'

function readSaved() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function save(id) {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    /* sin almacenamiento: funciona igual, solo no se recuerda */
  }
}

/**
 * Espacios (canal / congregación). El espacio elegido se recuerda en ESTE navegador, así dos
 * personas pueden trabajar en espacios distintos a la vez. Siempre hay al menos uno.
 */
export function useWorkspaces(api) {
  const [workspaces, setWorkspaces] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState(readSaved)

  const refresh = useCallback(async () => {
    if (!api) return
    setWorkspaces(await api.listWorkspaces())
    setLoaded(true)
  }, [api])

  useEffect(() => {
    if (!api) return
    let alive = true
    let retry
    const initial = () =>
      refresh().catch(() => {
        if (alive) retry = setTimeout(initial, 3000)
      })
    initial()
    const close = api.subscribeEvents({
      onWorkspace: (w) =>
        setWorkspaces((list) => {
          const exists = list.some((x) => x.id === w.id)
          const next = exists ? list.map((x) => (x.id === w.id ? w : x)) : [...list, w]
          return next.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        }),
      onWorkspaceDeleted: ({ id }) => setWorkspaces((list) => list.filter((x) => x.id !== id)),
    })
    return () => {
      alive = false
      clearTimeout(retry)
      close()
    }
  }, [api, refresh])

  // El elegido, o el predeterminado si el guardado ya no existe (p. ej. se eliminó)
  const current = workspaces.find((w) => w.id === selectedId) ?? workspaces.find((w) => w.isDefault) ?? workspaces[0] ?? null

  const select = useCallback((id) => {
    setSelectedId(id)
    save(id)
  }, [])

  const upsert = (w) => {
    setWorkspaces((list) => (list.some((x) => x.id === w.id) ? list.map((x) => (x.id === w.id ? w : x)) : [...list, w]))
    return w
  }

  const actions = {
    resolve: (url) => api.resolveChannel(url),
    create: async (data) => upsert(await api.createWorkspace(data)),
    update: async (id, data) => upsert(await api.updateWorkspace(id, data)),
    remove: async (id) => {
      await api.deleteWorkspace(id)
      setWorkspaces((list) => list.filter((x) => x.id !== id))
    },
    select,
    refresh,
  }

  return { workspaces, loaded, current, actions }
}
