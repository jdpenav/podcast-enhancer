import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ExternalLink, Search, X, Youtube } from 'lucide-react'
import Modal from '../ui/Modal.jsx'
import Button from '../ui/Button.jsx'
import WorkspaceAvatar from './WorkspaceAvatar.jsx'

const field =
  'focus-ring h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm placeholder:text-neutral-400 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900'

/** Tarjeta "¿Es este canal?". */
function ChannelCard({ channel, onClear, locked }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-neutral-200 p-3 dark:border-neutral-700">
      <WorkspaceAvatar channel={channel} size={44} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{channel.title}</p>
        <p className="truncate text-[13px] text-neutral-500 dark:text-neutral-400">
          {channel.handle ?? channel.id} · se sincroniza la pestaña {channel.streamsUrl?.endsWith('/videos') ? 'Videos' : 'En vivo'}
        </p>
      </div>
      <a href={channel.url} target="_blank" rel="noreferrer" className="focus-ring rounded-lg p-1.5 text-neutral-400 hover:text-neutral-800 dark:hover:text-white" aria-label="Abrir el canal en YouTube" title="Abrir en YouTube">
        <ExternalLink size={16} />
      </a>
      {!locked && onClear && (
        <button type="button" onClick={onClear} className="focus-ring rounded-lg p-1.5 text-neutral-400 hover:text-neutral-800 dark:hover:text-white" aria-label="Quitar canal" title="Quitar">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

/**
 * Crear o editar un espacio.
 *  - workspace: null = crear; si no, editar.
 *  - El canal se busca con el servidor (yt-dlp) y se confirma visualmente antes de guardar.
 *  - El canal no se puede cambiar si el espacio ya tiene episodios de YouTube (el servidor lo impide).
 */
export default function WorkspaceDialog({ open, workspace, workspaces, actions, onClose, onSaved }) {
  const editing = !!workspace
  const [name, setName] = useState('')
  const [podcastName, setPodcastName] = useState('')
  const [input, setInput] = useState('')
  const [channel, setChannel] = useState(null)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const nameTouched = useRef(false)

  useEffect(() => {
    if (!open) return
    setName(workspace?.name ?? '')
    setPodcastName(workspace?.podcastName && workspace.podcastName !== workspace.name ? workspace.podcastName : '')
    setChannel(workspace?.channel ?? null)
    setInput('')
    setError(null)
    setSaving(false)
    nameTouched.current = editing
  }, [open, workspace]) // eslint-disable-line react-hooks/exhaustive-deps

  const locked = editing && !!workspace.channel && workspace.counts?.youtube > 0
  const channelChanged = (channel?.id ?? null) !== (workspace?.channel?.id ?? null)

  const search = async () => {
    if (!input.trim()) return
    setResolving(true)
    setError(null)
    try {
      const r = await actions.resolve(input.trim())
      if (r.workspaceId && r.workspaceId !== workspace?.id) {
        const other = workspaces.find((w) => w.id === r.workspaceId)
        setError(`Ese canal ya está en el espacio «${other?.name ?? 'otro'}».`)
        return
      }
      setChannel(r.channel)
      setInput('')
      if (!nameTouched.current || !name.trim()) setName(r.channel.title)
    } catch (e) {
      setError(e.message)
    } finally {
      setResolving(false)
    }
  }

  const submit = async () => {
    if (input.trim() && !channel) return search() // pegó un enlace pero no lo buscó
    if (!name.trim()) return setError('Ponle un nombre al espacio.')
    setSaving(true)
    setError(null)
    try {
      const data = { name: name.trim(), podcastName: podcastName.trim() }
      if (!editing) {
        if (channel) data.channelUrl = channel.url
        onSaved?.(await actions.create(data))
      } else {
        if (channelChanged) data.channelUrl = channel?.url ?? ''
        onSaved?.(await actions.update(workspace.id, data))
      }
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissable={!saving}
      title={editing ? 'Editar espacio' : 'Nuevo espacio'}
      description={editing ? null : 'Un espacio por canal o congregación: su biblioteca, sus cortinas y su nombre de podcast.'}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={resolving}>
            {saving ? 'Guardando…' : editing ? 'Guardar' : 'Crear espacio'}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div>
          <label className="mb-1.5 flex items-center gap-1.5 text-[13px] font-medium" htmlFor="ws-channel">
            <Youtube size={15} aria-hidden /> Canal de YouTube
          </label>
          {channel ? (
            <>
              <ChannelCard channel={channel} locked={locked} onClear={() => setChannel(null)} />
              <p className="mt-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                {locked
                  ? 'Este espacio ya tiene episodios de este canal: para otro canal, crea un espacio nuevo.'
                  : channelChanged
                    ? '¿Es este? Si no, quítalo y prueba con otro enlace.'
                    : 'Al sincronizar, la Biblioteca trae los directos de este canal.'}
              </p>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <input
                  id="ws-channel"
                  data-autofocus
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      search()
                    }
                  }}
                  placeholder="youtube.com/@tu-canal"
                  disabled={resolving || saving}
                  className={field}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button icon={Search} onClick={search} loading={resolving} disabled={!input.trim()}>
                  Buscar
                </Button>
              </div>
              <p className="mt-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">
                {resolving ? 'Buscando el canal en YouTube…' : 'Pega el enlace del canal o de cualquiera de sus videos. Es opcional: puedes conectarlo después.'}
              </p>
            </>
          )}
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium" htmlFor="ws-name">
            Nombre del espacio
          </label>
          <input
            id="ws-name"
            value={name}
            onChange={(e) => {
              nameTouched.current = true
              setName(e.target.value)
            }}
            placeholder="Por ejemplo: Sede Sur"
            maxLength={80}
            disabled={saving}
            className={field}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-medium" htmlFor="ws-podcast">
            Nombre del podcast <span className="font-normal text-neutral-400">(opcional)</span>
          </label>
          <input
            id="ws-podcast"
            value={podcastName}
            onChange={(e) => setPodcastName(e.target.value)}
            placeholder={name.trim() || 'Igual que el espacio'}
            maxLength={120}
            disabled={saving}
            className={field}
          />
          <p className="mt-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">Aparece como artista y álbum en las etiquetas del MP3 exportado.</p>
        </div>

        {error && (
          <p role="alert" className="flex gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
            <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
