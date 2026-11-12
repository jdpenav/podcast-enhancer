import { useState } from 'react'
import { cn } from '../../lib/cn.js'

/** Iniciales para el avatar sin foto: "Sede Central" → "SC". */
export function initials(name = '') {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean)
  return ((words[0]?.[0] ?? '?') + (words.length > 1 ? words[words.length - 1][0] : words[0]?.[1] ?? '')).toUpperCase()
}

/** Foto del canal, o iniciales del espacio si no tiene canal (o la foto no carga). */
export default function WorkspaceAvatar({ workspace, channel, size = 28, className }) {
  const [broken, setBroken] = useState(false)
  const src = (channel ?? workspace?.channel)?.avatarUrl
  const name = workspace?.name ?? channel?.title ?? ''
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }
  if (src && !broken) {
    return <img src={src} alt="" onError={() => setBroken(true)} referrerPolicy="no-referrer" className={cn('shrink-0 rounded-full bg-neutral-200 object-cover dark:bg-neutral-800', className)} style={style} />
  }
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full bg-neutral-900 font-semibold text-white dark:bg-white dark:text-neutral-900', className)}
      style={style}
    >
      {initials(name)}
    </span>
  )
}
