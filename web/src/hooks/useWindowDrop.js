import { useEffect, useRef, useState } from 'react'

const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files')

/** Permite soltar archivos en cualquier parte de la ventana. Devuelve si se está arrastrando. */
export function useWindowDrop(onFiles, enabled = true) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const cb = useRef(onFiles)
  cb.current = onFiles

  useEffect(() => {
    if (!enabled) return
    const enter = (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setDragging(true)
    }
    const over = (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e) => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    }
    const drop = (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const files = [...(e.dataTransfer.files ?? [])]
      if (files.length) cb.current(files)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [enabled])

  return dragging
}
