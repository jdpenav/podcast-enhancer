import { Loader2, WifiOff } from 'lucide-react'

/** Aviso discreto cuando se pierde la conexión con el backend (EventSource reintenta solo). */
export default function OfflineBanner({ visible }) {
  if (!visible) return null
  return (
    <div className="mx-auto mt-4 flex max-w-6xl justify-center px-4 sm:px-6" role="status">
      <div className="flex animate-slide-up items-center gap-2.5 rounded-full bg-neutral-900 px-4 py-2 text-[13px] text-white shadow-lg dark:bg-white dark:text-neutral-900">
        <WifiOff size={15} className="text-red-400 dark:text-red-600" aria-hidden />
        <span>No se pudo conectar con el servidor.</span>
        <span className="flex items-center gap-1.5 text-neutral-400 dark:text-neutral-500">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          Reintentando…
        </span>
      </div>
    </div>
  )
}
