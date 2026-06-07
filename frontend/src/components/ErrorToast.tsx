import { useEffect } from 'react'

interface ErrorToastProps {
  message: string
  onDismiss: () => void
  onRetry?: () => void
  /** Auto-dismiss timeout in ms; 0 disables. Default 6000. */
  timeoutMs?: number
}

export function ErrorToast({ message, onDismiss, onRetry, timeoutMs = 6000 }: ErrorToastProps) {
  useEffect(() => {
    if (!timeoutMs) return
    const id = window.setTimeout(onDismiss, timeoutMs)
    return () => window.clearTimeout(id)
  }, [message, timeoutMs, onDismiss])

  return (
    <div className="error-toast" role="alert">
      <span>{message}</span>
      {onRetry && <button onClick={onRetry}>Retry</button>}
      <button onClick={onDismiss} aria-label="Dismiss">×</button>
    </div>
  )
}
