import { useCallback } from 'react'

const supported = () => typeof window !== 'undefined' && 'Notification' in window

/** Notificaciones del sistema operativo para avisar cuando un trabajo termina. */
export function useNotify() {
  // Pedir permiso solo tras una acción del usuario (al procesar el primer audio)
  const requestPermission = useCallback(() => {
    if (supported() && Notification.permission === 'default') Notification.requestPermission().catch(() => {})
  }, [])

  /** Muestra la notificación solo si la pestaña no está visible (si lo está, basta el toast). */
  const notify = useCallback((title, { body, tag, onClick } = {}) => {
    if (!supported() || Notification.permission !== 'granted' || !document.hidden) return
    try {
      const n = new Notification(title, { body, tag, icon: '/favicon.svg' })
      n.onclick = () => {
        window.focus()
        onClick?.()
        n.close()
      }
    } catch {
      /* algunos navegadores no permiten new Notification fuera de un service worker */
    }
  }, [])

  return { requestPermission, notify }
}
