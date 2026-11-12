import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Cpu, Download, ExternalLink, HardDrive, Loader2, Music, Pause, Pencil, Play, Plus, RefreshCw, Trash2, Upload, Wrench, XCircle, Youtube } from 'lucide-react'
import Badge from '../components/ui/Badge.jsx'
import WorkspaceAvatar from '../components/workspaces/WorkspaceAvatar.jsx'
import Button from '../components/ui/Button.jsx'
import ConfirmModal from '../components/ConfirmModal.jsx'
import Tooltip from '../components/ui/Tooltip.jsx'
import { useToast } from '../components/ui/Toast.jsx'
import { cn } from '../lib/cn.js'
import { formatBytes, formatClock } from '../lib/format.js'

function Row({ icon: Icon, label, ok, value, hint, children }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        <Icon size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {ok === true && <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" aria-label="correcto" />}
          {ok === false && <XCircle size={14} className="text-red-600 dark:text-red-400" aria-label="falta" />}
        </p>
        <p className="text-[13px] tabular-nums text-neutral-500 dark:text-neutral-400">{value}</p>
        {hint && <p className="mt-1 text-[12px] text-neutral-500 dark:text-neutral-400">{hint}</p>}
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </li>
  )
}

/** Estado del sistema: yt-dlp (con botón para actualizar), ffmpeg, modelo, disco. */
function SystemCard({ api, config }) {
  const toast = useToast()
  const [sys, setSys] = useState(null)
  const [error, setError] = useState(null)
  const [updating, setUpdating] = useState(false)
  const [output, setOutput] = useState(null)

  const load = useCallback(() => {
    api
      ?.getSystem()
      .then((s) => {
        setSys(s)
        setError(null)
      })
      .catch((e) => setError(e.message))
  }, [api])
  useEffect(load, [load])

  const update = async () => {
    setUpdating(true)
    setOutput(null)
    try {
      const r = await api.updateYtdlp()
      setOutput(r.output)
      if (!r.ok) toast({ tone: 'error', title: 'No se pudo actualizar yt-dlp', description: 'Revisa el detalle debajo.' })
      else if (r.before !== r.after) toast({ tone: 'success', title: 'yt-dlp actualizado', description: `${r.before} → ${r.after}` })
      else toast({ title: 'yt-dlp ya estaba al día', description: r.after })
      load()
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo actualizar yt-dlp', description: e.message })
    } finally {
      setUpdating(false)
    }
  }

  const disk = sys?.disk
  const lowDisk = disk && disk.freeBytes < 5 * 1024 ** 3
  return (
    <section className="card p-5" aria-label="Estado del sistema">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Estado del sistema</h2>
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={load}>
          Revisar
        </Button>
      </div>
      {error ? (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : !sys ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 size={14} className="animate-spin" /> Revisando…
        </p>
      ) : (
        <>
          <ul className="mt-1 divide-y divide-neutral-100 dark:divide-neutral-800">
            <Row
              icon={Download}
              label="yt-dlp"
              ok={sys.ytDlp.installed}
              value={sys.ytDlp.installed ? `Versión ${sys.ytDlp.version} · ${sys.ytDlp.path}` : sys.ytDlp.error ? `No arranca: ${sys.ytDlp.error}` : 'No está instalado'}
              hint={
                sys.ytDlp.installed
                  ? 'Si YouTube cambia algo y las descargas fallan, actualízalo: los arreglos suelen salir en uno o dos días.'
                  : sys.ytDlp.error
                    ? 'Reinstálalo con "npm run setup".'
                    : 'Instálalo con "npm run setup" (queda en tools/bin/yt-dlp, sin sudo).'
              }
            >
              {sys.ytDlp.canUpdate && config?.role !== 'guest' && (
                <Button size="sm" icon={RefreshCw} onClick={update} loading={updating}>
                  {updating ? 'Actualizando…' : 'Actualizar'}
                </Button>
              )}
            </Row>
            <Row icon={Wrench} label="ffmpeg" ok={sys.ffmpeg.installed} value={sys.ffmpeg.installed ? `Versión ${sys.ffmpeg.version}` : 'Falta: sudo apt install ffmpeg'} />
            <Row icon={Cpu} label="Modelo de Resemble Enhance" ok={sys.model.present} value={sys.model.present ? 'Instalado' : 'Falta: ejecuta npm run setup'} />
            {disk && (
              <Row
                icon={HardDrive}
                label="Espacio en disco"
                ok={!lowDisk}
                value={`${formatBytes(disk.freeBytes)} libres de ${formatBytes(disk.totalBytes)}`}
                hint={lowDisk ? 'Queda poco espacio: borra audios de episodios que ya subiste a Castbox.' : 'Cada hora de audio ocupa ~1,5 GB mientras se mejora y ~500 MB después.'}
              />
            )}
          </ul>
          {output && (
            <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-xl bg-neutral-100 p-3 font-mono text-[11px] text-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-300">{output}</pre>
          )}
          <p className="mt-3 border-t border-neutral-100 pt-3 text-[12px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
            Si un stream recién terminado aún no se puede descargar, se reintenta cada {sys.library.vodRetryMin} min durante {sys.library.vodRetryMaxHours} h.
          </p>
        </>
      )}
    </section>
  )
}

/** Espacios: uno por canal o congregación. El dueño los crea, edita y elimina. */
function WorkspacesCard({ spaces, workspace, canManage, onSelect, onNew, onEdit }) {
  const toast = useToast()
  const [confirm, setConfirm] = useState(null)
  const lastConfirm = useRef(null)
  if (confirm) lastConfirm.current = confirm
  const cf = confirm ?? lastConfirm.current

  const doDelete = async () => {
    try {
      await spaces.actions.remove(confirm.id)
      toast({ title: 'Espacio eliminado', description: confirm.name })
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo eliminar', description: e.message, duration: 9000 })
      throw e
    }
  }

  return (
    <section className="card p-5" aria-label="Espacios">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Espacios</h2>
          <p className="mt-0.5 text-[13px] text-neutral-500 dark:text-neutral-400">
            Uno por canal o congregación, cada uno con su biblioteca y sus cortinas. Cambias de espacio desde el menú de arriba.
          </p>
        </div>
        {canManage && (
          <Button variant="primary" size="sm" icon={Plus} onClick={onNew}>
            Nuevo
          </Button>
        )}
      </div>
      <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
        {spaces.workspaces.map((w) => {
          const active = w.id === workspace?.id
          return (
            <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
              <WorkspaceAvatar workspace={w} size={36} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-sm font-medium">
                  <span className="truncate">{w.name}</span>
                  {active && <Badge tone="dark">Actual</Badge>}
                </p>
                <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
                  {w.channel ? (
                    <a href={w.channel.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
                      <Youtube size={12} aria-hidden /> {w.channel.handle ?? w.channel.title}
                      <ExternalLink size={11} aria-hidden />
                    </a>
                  ) : (
                    <span>Sin canal de YouTube</span>
                  )}
                  <span aria-hidden>·</span>
                  <span>
                    {w.counts.episodes} {w.counts.episodes === 1 ? 'episodio' : 'episodios'}
                    {w.counts.withAudio > 0 && ` · ${w.counts.withAudio} con audio`}
                    {w.counts.ready > 0 && ` · ${w.counts.ready} listos`}
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-1">
                {!active && (
                  <Button size="sm" onClick={() => onSelect(w.id)}>
                    Usar
                  </Button>
                )}
                {canManage && (
                  <>
                    <Tooltip content="Editar">
                      <Button variant="ghost" size="icon-sm" icon={Pencil} onClick={() => onEdit(w)} aria-label={`Editar ${w.name}`} />
                    </Tooltip>
                    {spaces.workspaces.length > 1 && (
                      <Tooltip content="Eliminar">
                        <Button variant="ghost" size="icon-sm" icon={Trash2} onClick={() => setConfirm(w)} aria-label={`Eliminar ${w.name}`} />
                      </Tooltip>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <ConfirmModal
        open={!!confirm}
        danger
        title="¿Eliminar este espacio?"
        description={`Se borran «${cf?.name}», sus cortinas y su lista de episodios. Solo se puede si ningún episodio tiene audio descargado, mejorado o exportado: bórralos antes desde la Biblioteca.`}
        confirmLabel="Eliminar espacio"
        onConfirm={doDelete}
        onClose={() => setConfirm(null)}
      />
    </section>
  )
}

/** Cortinas: subir, escuchar, renombrar, borrar y elegir las predeterminadas. */
function AssetsCard({ api, config, workspace }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [playing, setPlaying] = useState(null)
  const [editing, setEditing] = useState(null) // { id, name }
  const [confirm, setConfirm] = useState(null)
  const lastConfirm = useRef(null)
  if (confirm) lastConfirm.current = confirm
  const inputRef = useRef(null)
  const audio = useRef(null)

  const wsId = workspace?.id
  const load = useCallback(() => {
    if (!api || !wsId) return
    api.listAssets(wsId).then(setData).catch((e) => toast({ tone: 'error', title: 'No se pudieron cargar las cortinas', description: e.message }))
  }, [api, wsId, toast])
  useEffect(load, [load])
  useEffect(() => () => audio.current?.pause(), [])

  const toggle = (a) => {
    if (!audio.current) {
      audio.current = new Audio()
      audio.current.addEventListener('ended', () => setPlaying(null))
      audio.current.addEventListener('pause', () => setPlaying(null))
    }
    if (playing === a.id) return audio.current.pause()
    audio.current.src = api.assetAudioUrl(a)
    audio.current.play().then(() => setPlaying(a.id)).catch(() => setPlaying(null))
  }

  const upload = async (file) => {
    if (!file) return
    const ext = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
    if (config && !config.acceptedTypes.includes(ext)) {
      return toast({ tone: 'error', title: 'Formato no soportado', description: `Usa ${config.acceptedTypes.map((t) => t.slice(1).toUpperCase()).join(', ')}.` })
    }
    setUploading(true)
    try {
      const a = await api.uploadAsset(file, undefined, wsId)
      toast({ tone: 'success', title: 'Cortina añadida', description: a.name })
      load()
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo subir la cortina', description: e.message })
    } finally {
      setUploading(false)
    }
  }

  const saveName = async () => {
    const { id, name } = editing
    setEditing(null)
    if (!name.trim()) return
    try {
      await api.renameAsset(id, name.trim())
      load()
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo renombrar', description: e.message })
    }
  }

  const setDefault = async (kind, id) => {
    const d = { ...data.defaults, [kind]: data.defaults[kind] === id ? null : id }
    try {
      const defaults = await api.setAssetDefaults({ ...d, workspace: wsId })
      setData((x) => ({ ...x, defaults }))
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo guardar', description: e.message })
    }
  }

  const doDelete = async () => {
    try {
      await api.deleteAsset(confirm.id)
      toast({ title: 'Cortina eliminada', description: confirm.name })
      load()
    } catch (e) {
      toast({ tone: 'error', title: 'No se pudo eliminar', description: e.message })
      throw e
    }
  }

  const DefaultChip = ({ kind, a, label }) => {
    const on = data.defaults[kind] === a.id
    return (
      <button
        type="button"
        onClick={() => setDefault(kind, a.id)}
        aria-pressed={on}
        className={cn(
          'focus-ring h-6 rounded-full border px-2 text-[11px] font-medium transition-colors',
          on
            ? 'border-neutral-900 bg-neutral-900 text-white dark:border-white dark:bg-white dark:text-neutral-900'
            : 'border-neutral-200 text-neutral-500 hover:border-neutral-300 hover:text-neutral-800 dark:border-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200',
        )}
      >
        {label}
      </button>
    )
  }

  const cf = confirm ?? lastConfirm.current
  return (
    <section className="card p-5" aria-label="Cortinas">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">
            Cortinas {workspace && <span className="font-normal text-neutral-400">· {workspace.name}</span>}
          </h2>
          <p className="mt-0.5 text-[13px] text-neutral-500 dark:text-neutral-400">La música de entrada y salida que se pega al exportar. Cada espacio tiene las suyas.</p>
        </div>
        <Button variant="primary" size="sm" icon={Upload} onClick={() => inputRef.current?.click()} loading={uploading}>
          Subir
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={config?.acceptedTypes?.join(',') || 'audio/*'}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            upload(f)
          }}
        />
      </div>

      {!data ? (
        <p className="mt-4 flex items-center gap-2 text-sm text-neutral-500">
          <Loader2 size={14} className="animate-spin" /> Cargando…
        </p>
      ) : data.items.length === 0 ? (
        <div className="mt-4 flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-neutral-200 px-4 py-8 text-center dark:border-neutral-800">
          <Music size={20} className="text-neutral-400" aria-hidden />
          <p className="text-sm text-neutral-500 dark:text-neutral-400">Sube la intro y el outro del podcast (MP3, WAV…).</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-100 dark:divide-neutral-800">
          {data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <Button size="icon-sm" icon={playing === a.id ? Pause : Play} onClick={() => toggle(a)} aria-label={`Escuchar ${a.name}`} />
              <div className="min-w-0 flex-1">
                {editing?.id === a.id ? (
                  <input
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    aria-label="Nombre de la cortina"
                    className="focus-ring h-8 w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
                  />
                ) : (
                  <p className="truncate text-sm font-medium" title={a.filename}>
                    {a.name}
                  </p>
                )}
                <p className="text-[12px] tabular-nums text-neutral-500 dark:text-neutral-400">
                  {formatClock(a.durationSec)} · {formatBytes(a.sizeBytes)}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <DefaultChip kind="introId" a={a} label="Intro" />
                <DefaultChip kind="outroId" a={a} label="Outro" />
                <Tooltip content="Renombrar">
                  <Button variant="ghost" size="icon-sm" icon={Pencil} onClick={() => setEditing({ id: a.id, name: a.name })} aria-label={`Renombrar ${a.name}`} />
                </Tooltip>
                <Tooltip content="Eliminar">
                  <Button variant="ghost" size="icon-sm" icon={Trash2} onClick={() => setConfirm(a)} aria-label={`Eliminar ${a.name}`} />
                </Tooltip>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data?.items.length > 0 && (
        <p className="mt-2 flex gap-1.5 text-[12px] text-neutral-500 dark:text-neutral-400">
          <AlertCircle size={13} className="mt-px shrink-0" aria-hidden />
          «Intro» y «Outro» marcan las que se eligen solas en un episodio nuevo. Se pueden tener distintas frecuencias o estéreo: al exportar todo se iguala.
        </p>
      )}

      <ConfirmModal
        open={!!confirm}
        danger
        title="¿Eliminar esta cortina?"
        description={`«${cf?.name}» deja de estar disponible. Los MP3 ya exportados no cambian; los episodios que la usaban tendrán que elegir otra.`}
        confirmLabel="Eliminar"
        onConfirm={doDelete}
        onClose={() => setConfirm(null)}
      />
    </section>
  )
}

export default function SettingsView({ api, config, spaces, workspace, canManage, onSelectWorkspace, onNewWorkspace, onEditWorkspace }) {
  // Conteos de episodios al día al abrir Ajustes
  useEffect(() => {
    spaces.actions.refresh().catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ajustes</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">Espacios, cortinas del podcast y estado de las herramientas.</p>
      </div>
      <WorkspacesCard spaces={spaces} workspace={workspace} canManage={canManage} onSelect={onSelectWorkspace} onNew={onNewWorkspace} onEdit={onEditWorkspace} />
      <AssetsCard key={workspace?.id} api={api} config={config} workspace={workspace} />
      <SystemCard api={api} config={config} />
    </main>
  )
}
