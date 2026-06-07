import { useEffect, useRef } from 'react'
import { IconCheck } from './Icons'
import { useSettings, type Accent, type Theme, type Layout } from '../contexts/SettingsContext'

const ACCENTS: { value: Accent; name: string }[] = [
  { value: '#7be0c3', name: 'Mint' },
  { value: '#7bc6e0', name: 'Sky' },
  { value: '#e0c47b', name: 'Amber' },
  { value: '#c97be0', name: 'Violet' },
]

const THEMES: { value: Theme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'paper', label: 'Paper' },
]

interface SettingsPopoverProps {
  onClose: () => void
}

export function SettingsPopover({ onClose }: SettingsPopoverProps) {
  const { theme, accent, layout, setTheme, setAccent, setLayout } = useSettings()
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // Delay so the same click that opened doesn't immediately close.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDoc), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(id)
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="settings-pop" ref={ref} role="dialog" aria-label="Display settings">
      <div className="settings-head">
        <span>Display</span>
        <button className="popover-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="settings-group">
        <label className="settings-label">Theme</label>
        <div className="seg-row">
          {THEMES.map((t) => (
            <button
              key={t.value}
              className={`seg-btn ${theme === t.value ? 'on' : ''}`}
              onClick={() => setTheme(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-label">Accent</label>
        <div className="swatch-row">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              className={`swatch ${accent === a.value ? 'on' : ''}`}
              title={a.name}
              style={{ background: a.value }}
              onClick={() => setAccent(a.value)}
              aria-label={`Accent ${a.name}`}
            >
              {accent === a.value && <IconCheck />}
            </button>
          ))}
        </div>
      </div>

      <div className="settings-group">
        <label className="settings-label">Sidebar position</label>
        <div className="seg-row">
          <button
            className={`seg-btn ${layout === 'rail-right' ? 'on' : ''}`}
            onClick={() => setLayout('rail-right' as Layout)}
          >
            <span className="layout-ico">
              <i className="lc" />
              <i className="lc rail" />
            </span>
            Right
          </button>
          <button
            className={`seg-btn ${layout === 'rail-left' ? 'on' : ''}`}
            onClick={() => setLayout('rail-left' as Layout)}
          >
            <span className="layout-ico">
              <i className="lc rail" />
              <i className="lc" />
            </span>
            Left
          </button>
        </div>
      </div>

      <div className="settings-foot">
        <span>Saved to this device.</span>
      </div>
    </div>
  )
}
