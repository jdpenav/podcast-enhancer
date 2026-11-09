import { useState } from 'react'
import Modal from './ui/Modal.jsx'
import Button from './ui/Button.jsx'

/** Confirmación propia (en lugar de window.confirm). `onConfirm` puede ser async. */
export default function ConfirmModal({ open, title, description, confirmLabel = 'Confirmar', cancelLabel = 'Volver', danger = false, onConfirm, onClose }) {
  const [loading, setLoading] = useState(false)

  const confirm = async () => {
    setLoading(true)
    try {
      await onConfirm?.()
      onClose()
    } catch {
      /* el que llama muestra el error (toast) */
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      dismissable={!loading}
      footer={
        <>
          <Button onClick={onClose} disabled={loading} data-autofocus>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={confirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-6 text-neutral-600 dark:text-neutral-400">{description}</p>
    </Modal>
  )
}
