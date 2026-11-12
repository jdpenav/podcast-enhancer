// Espacios: listar (todos), resolver un canal, crear, editar y eliminar (solo el dueño).
import { listWorkspaces, workspaceCounts } from '../db.js'
import {
  createWorkspace, defaultWorkspace, deleteWorkspace, mustGetWorkspace, ownerOnly, resolveForUi, updateWorkspace, workspaceToApi,
} from '../workspaces.js'

export default async function workspaceRoutes(app) {
  app.get('/api/workspaces', () => {
    const counts = workspaceCounts()
    const defId = defaultWorkspace()?.id
    return listWorkspaces().map((w) => workspaceToApi(w, counts, defId))
  })

  app.post('/api/workspaces/resolve', async (req) => resolveForUi(req.body?.url))

  app.post('/api/workspaces', async (req, reply) => {
    ownerOnly(req)
    return reply.code(201).send(workspaceToApi(await createWorkspace(req.body)))
  })

  app.patch('/api/workspaces/:id', async (req) => {
    ownerOnly(req)
    return workspaceToApi(await updateWorkspace(mustGetWorkspace(req.params.id), req.body))
  })

  app.delete('/api/workspaces/:id', async (req, reply) => {
    ownerOnly(req)
    await deleteWorkspace(mustGetWorkspace(req.params.id))
    return reply.code(204).send()
  })
}
