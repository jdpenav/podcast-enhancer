import { useRef } from 'react'
import { Upload } from 'lucide-react'
import Button from './ui/Button.jsx'

/** Zona para elegir/soltar audios. El soltar funciona en toda la ventana (ver DropOverlay). */
export default function UploadCard({ config, onFiles }) {
  const inputRef = useRef(null)
  const types = config?.acceptedTypes ?? []
  const typesLabel = types.map((t) => t.slice(1).toUpperCase()).join(', ')

  const open = () => inputRef.current?.click()

  return (
    <section
      aria-label="Subir audio"
      className="card group relative cursor-pointer overflow-hidden p-2 transition-shadow hover:shadow-md"
      onClick={open}
    >
      <div className="flex flex-col items-center gap-4 rounded-xl border-2 border-dashed border-neutral-200 px-6 py-10 text-center transition-colors group-hover:border-neutral-300 sm:py-12 dark:border-neutral-800 dark:group-hover:border-neutral-700">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-neutral-100 text-neutral-900 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:scale-105 dark:bg-neutral-800 dark:text-white">
          <Upload size={24} strokeWidth={2} />
        </span>
        <div>
          <p className="text-base font-semibold tracking-tight sm:text-lg">Arrastra un audio aquí</p>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {config ? `${typesLabel} · hasta ${config.maxUploadMB} MB${config.role === 'guest' ? ' (mejor en MP3)' : ''}` : 'Cargando formatos…'}
          </p>
        </div>
        <Button
          variant="primary"
          onClick={(e) => {
            e.stopPropagation()
            open()
          }}
        >
          Elegir archivo
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={types.join(',') || 'audio/*'}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = '' // permitir elegir el mismo archivo otra vez
          if (files.length) onFiles(files)
        }}
      />
    </section>
  )
}
