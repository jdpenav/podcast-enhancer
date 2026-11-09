import { Upload } from 'lucide-react'

/** Capa a pantalla completa mientras se arrastra un archivo sobre la ventana. */
export default function DropOverlay({ visible }) {
  if (!visible) return null
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] grid animate-fade-in place-items-center bg-neutral-100/80 p-6 backdrop-blur-sm dark:bg-neutral-950/80">
      <div className="flex w-full max-w-xl animate-pop-in flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-neutral-900 bg-white px-8 py-16 text-center shadow-2xl dark:border-white dark:bg-neutral-900">
        <span className="grid h-16 w-16 animate-bounce place-items-center rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
          <Upload size={28} />
        </span>
        <p className="text-xl font-semibold tracking-tight">Suelta el audio para procesarlo</p>
        <p className="text-sm text-neutral-500 dark:text-neutral-400">Tu archivo original no se modifica.</p>
      </div>
    </div>
  )
}
