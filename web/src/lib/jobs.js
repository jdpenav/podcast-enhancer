// Cálculos derivados de la lista de trabajos (cola, tiempos restantes).

export const ACTIVE = ['pending', 'processing']

/** Segundos que le faltan a un trabajo activo (estimación). */
export function remainingSec(job) {
  if (job.status === 'processing') {
    if (job.progress?.stage === 'merging') return 30
    if (Number.isFinite(job.progress?.etaSec)) return job.progress.etaSec
  }
  const done = (job.progress?.percent ?? 0) / 100
  return (job.estimatedSec ?? 0) * (1 - done)
}

/** Segundos hasta que la cola actual quede vacía (lo que esperaría un trabajo nuevo). */
export function queueSec(jobs) {
  return jobs.filter((j) => ACTIVE.includes(j.status)).reduce((s, j) => s + remainingSec(j), 0)
}

/** Trabajos por delante de uno pendiente (incluye el que está procesando). */
export function jobsAhead(jobs, job) {
  const processing = jobs.some((j) => j.status === 'processing') ? 1 : 0
  const pendingBefore = jobs.filter((j) => j.status === 'pending' && j.createdAt < job.createdAt).length
  return processing + pendingBefore
}

/** Segundos estimados hasta que un trabajo pendiente termine (cola delante + él mismo). */
export function finishInSec(jobs, job) {
  if (job.status === 'processing') return remainingSec(job)
  const ahead = jobs.filter(
    (j) => j.status === 'processing' || (j.status === 'pending' && j.createdAt < job.createdAt),
  )
  return ahead.reduce((s, j) => s + remainingSec(j), 0) + remainingSec(job)
}

export function estimateFor(config, durationSec, mode, quality) {
  const m = config?.modes.find((x) => x.mode === mode && (x.quality ?? null) === (quality ?? null))
  return m && Number.isFinite(durationSec) ? durationSec * m.factor : NaN
}

export function counts(jobs) {
  const c = { pending: 0, processing: 0, paused: 0, done: 0, error: 0, canceled: 0 }
  for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1
  return c
}
