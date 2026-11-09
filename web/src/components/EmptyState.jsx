/** Estado vacío de la lista de trabajos, con una mini ilustración de onda. */
export default function EmptyState() {
  const bars = [0.35, 0.6, 0.9, 0.55, 0.75, 0.4, 0.65, 0.3]
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <div className="flex h-12 items-center gap-1.5" aria-hidden>
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-1.5 rounded-full bg-neutral-300 dark:bg-neutral-700"
            style={{ height: `${h * 100}%` }}
          />
        ))}
      </div>
      <p className="mt-5 text-base font-semibold tracking-tight">Arrastra un audio para empezar</p>
      <p className="mt-1 max-w-xs text-sm text-neutral-500 dark:text-neutral-400">
        Aquí verás el progreso de cada audio y podrás escucharlo y descargarlo al terminar.
      </p>
    </div>
  )
}

/** Tarjetas fantasma mientras carga la lista. */
export function JobSkeleton() {
  return (
    <div className="card animate-pulse p-5 sm:p-6" aria-hidden>
      <div className="flex items-center gap-4">
        <div className="h-11 w-11 rounded-xl bg-neutral-100 dark:bg-neutral-800" />
        <div className="flex-1 space-y-2">
          <div className="h-3.5 w-1/2 rounded-full bg-neutral-100 dark:bg-neutral-800" />
          <div className="h-3 w-1/3 rounded-full bg-neutral-100 dark:bg-neutral-800" />
        </div>
      </div>
      <div className="mt-5 h-2 rounded-full bg-neutral-100 dark:bg-neutral-800" />
    </div>
  )
}
