import { AudioWaveform, ChevronsUpDown, Library, Monitor, Moon, Plus, Settings, Settings2, Sparkles, Sun, Thermometer } from 'lucide-react'
import WorkspaceAvatar from './workspaces/WorkspaceAvatar.jsx'
import { routeHref } from '../hooks/useRoute.js'
import Menu from './ui/Menu.jsx'
import Tooltip from './ui/Tooltip.jsx'
import { useTheme } from '../hooks/useTheme.js'
import { cn } from '../lib/cn.js'

const HOT_C = 83

function shortGpu(name = '') {
  return name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '')
}

/** Píldora de estado del sistema a partir de /api/health. */
function HealthPill({ health, connected }) {
  let dot = 'bg-neutral-300 dark:bg-neutral-600'
  let text = 'Conectando…'
  let prefix = '' // nombre de la GPU: se oculta en pantallas angostas
  let pulse = false
  let tip = null
  const gpu = health?.gpu

  if (connected === false) {
    dot = 'bg-red-500'
    text = 'Sin conexión'
    tip = 'No hay respuesta del servidor local'
  } else if (health && !gpu) {
    text = 'Sin GPU · CPU'
    tip = 'No se detectó GPU: el proceso será mucho más lento'
  } else if (gpu) {
    const name = shortGpu(gpu.name)
    pulse = gpu.busy
    dot = gpu.busy ? 'bg-neutral-900 dark:bg-white' : 'bg-emerald-500'
    prefix = `${name} · `
    text = gpu.busy ? 'Procesando' : 'Libre'
    tip = `${gpu.name} · ${gpu.vramGB} GB${Number.isFinite(gpu.tempC) ? ` · ${gpu.tempC} °C` : ''}`
  }
  if (health && !health.ffmpeg) tip = 'Falta ffmpeg en el servidor'
  const hot = Number.isFinite(gpu?.tempC) && gpu.tempC >= HOT_C

  return (
    <Tooltip content={hot ? `${tip}. Está caliente: usa una base ventilada.` : tip}>
      <span
        tabIndex={0}
        className="focus-ring inline-flex h-9 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 text-[13px] font-medium text-neutral-700 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200"
      >
        <span className={cn('h-2 w-2 rounded-full transition-colors', dot, pulse && 'animate-pulse-dot')} aria-hidden />
        <span className="whitespace-nowrap">
          {prefix && <span className="hidden sm:inline">{prefix}</span>}
          {text}
        </span>
        {hot && <Thermometer size={14} className="text-red-600" aria-label={`${gpu.tempC} °C`} />}
      </span>
    </Tooltip>
  )
}

const THEMES = [
  { key: 'system', label: 'Sistema', hint: 'Igual que tu computadora', icon: Monitor },
  { key: 'light', label: 'Claro', icon: Sun },
  { key: 'dark', label: 'Oscuro', icon: Moon },
]

function ThemeMenu() {
  const { theme, setTheme } = useTheme()
  const current = THEMES.find((t) => t.key === theme) ?? THEMES[0]
  const Icon = current.icon
  return (
    <Menu
      label="Tema"
      align="end"
      items={THEMES.map((t) => ({ ...t, selected: t.key === theme, onSelect: () => setTheme(t.key) }))}
      trigger={({ props }) => (
        <button
          type="button"
          {...props}
          aria-label={`Tema: ${current.label}`}
          title={`Tema: ${current.label}`}
          className="focus-ring grid h-9 w-9 place-items-center rounded-full border border-neutral-200 bg-white text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-neutral-900 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
        >
          <Icon size={16} aria-hidden />
        </button>
      )}
    />
  )
}

const NAV = [
  { key: 'enhance', label: 'Mejorar', icon: Sparkles, href: routeHref.enhance },
  { key: 'library', label: 'Biblioteca', icon: Library, href: routeHref.library },
  { key: 'settings', label: 'Ajustes', icon: Settings, href: routeHref.settings },
]

/**
 * Selector de espacio (canal / congregación). Cambiarlo solo afecta a este navegador.
 * El dueño ve además "Nuevo espacio" y "Administrar espacios".
 */
function WorkspaceSwitcher({ workspaces, current, onSelect, onNew, canManage }) {
  if (!current) return null
  const items = [
    ...workspaces.map((w) => ({
      key: w.id,
      label: w.name,
      hint: w.channel ? (w.channel.handle ?? w.channel.title) : 'Sin canal de YouTube',
      selected: w.id === current.id,
      onSelect: () => onSelect(w.id),
    })),
    ...(canManage
      ? [
          { key: '__new', label: 'Nuevo espacio', icon: Plus, onSelect: onNew },
          { key: '__manage', label: 'Administrar espacios', icon: Settings2, href: routeHref.settings },
        ]
      : []),
  ]
  return (
    <Menu
      label="Espacio"
      items={items}
      trigger={({ props }) => (
        <button
          type="button"
          {...props}
          aria-label={`Espacio: ${current.name}`}
          title={`Espacio: ${current.name}`}
          className="focus-ring inline-flex h-9 min-w-0 max-w-[13rem] items-center gap-2 rounded-full border border-neutral-200 bg-white pl-1 pr-1 text-[13px] font-medium transition-colors hover:bg-neutral-50 md:pr-2.5 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
        >
          <WorkspaceAvatar workspace={current} size={28} />
          <span className="hidden truncate md:inline">{current.name}</span>
          <ChevronsUpDown size={14} className="hidden shrink-0 text-neutral-400 md:inline" aria-hidden />
        </button>
      )}
    />
  )
}

/** Navegación principal. En pantallas angostas solo iconos (con nombre accesible). */
function Nav({ route, libraryActive }) {
  const current = route?.name === 'editor' ? 'library' : route?.name
  return (
    <nav aria-label="Secciones" className="flex items-center gap-1 rounded-full border border-neutral-200 bg-white p-1 dark:border-neutral-800 dark:bg-neutral-900">
      {NAV.map((n) => {
        const active = current === n.key
        const Icon = n.icon
        return (
          <a
            key={n.key}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            aria-label={n.label}
            title={n.label}
            className={cn(
              'focus-ring relative inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium transition-colors lg:px-3',
              active
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white',
            )}
          >
            <Icon size={15} aria-hidden />
            <span className="hidden lg:inline">{n.label}</span>
            {n.key === 'library' && libraryActive > 0 && (
              <span
                className={cn('h-1.5 w-1.5 animate-pulse-dot rounded-full', active ? 'bg-white dark:bg-neutral-900' : 'bg-neutral-900 dark:bg-white')}
                aria-label={`${libraryActive} en curso`}
              />
            )}
          </a>
        )
      })}
    </nav>
  )
}

export default function Header({ health, connected, mock, queued, route, libraryActive = 0, workspaces = [], workspace, onSelectWorkspace, onNewWorkspace, canManage }) {
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-neutral-100/80 backdrop-blur-md dark:border-neutral-800/70 dark:bg-neutral-950/80">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <a href={routeHref.enhance} className="focus-ring flex shrink-0 items-center gap-2.5 rounded-xl" aria-label="Enhance, inicio">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
            <AudioWaveform size={19} strokeWidth={2.25} />
          </span>
          <span className="hidden text-[17px] font-semibold tracking-tight min-[480px]:inline">Enhance</span>
        </a>
        <WorkspaceSwitcher workspaces={workspaces} current={workspace} onSelect={onSelectWorkspace} onNew={onNewWorkspace} canManage={canManage} />
        <Nav route={route} libraryActive={libraryActive} />
        {mock && (
          <Tooltip content="Sin backend: los datos son simulados">
            <span
              tabIndex={0}
              className="focus-ring hidden rounded-full border border-dashed border-neutral-300 px-2 py-0.5 min-[400px]:inline text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-700"
            >
              Demo
            </span>
          </Tooltip>
        )}
        <div className="ml-auto flex items-center gap-2">
          {queued > 0 && (
            <span className="hidden text-[13px] text-neutral-500 lg:inline dark:text-neutral-400">
              {queued} en cola
            </span>
          )}
          <HealthPill health={health} connected={connected} />
          <ThemeMenu />
        </div>
      </div>
    </header>
  )
}
