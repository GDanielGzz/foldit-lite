import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export type Theme = 'dark' | 'paper'
export type Accent = '#7be0c3' | '#7bc6e0' | '#e0c47b' | '#c97be0'
export type Layout = 'rail-right' | 'rail-left'

export interface Settings {
  theme: Theme
  accent: Accent
  layout: Layout
}

const DEFAULTS: Settings = {
  theme: 'dark',
  accent: '#7be0c3',
  layout: 'rail-right',
}

const STORAGE_KEY = 'foldit-settings'

interface SettingsContextValue extends Settings {
  setTheme: (theme: Theme) => void
  setAccent: (accent: Accent) => void
  setLayout: (layout: Layout) => void
}

const Ctx = createContext<SettingsContextValue | null>(null)

function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (stored && typeof stored === 'object') return { ...DEFAULTS, ...stored }
  } catch { /* fall through */ }
  return DEFAULTS
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings)

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
  }, [settings])

  useEffect(() => {
    const root = document.documentElement
    if (settings.theme === 'paper') root.classList.add('paper')
    else root.classList.remove('paper')

    root.style.setProperty('--accent', settings.accent)
    root.style.setProperty('--accent-2', `color-mix(in oklch, ${settings.accent} 80%, black)`)
    root.style.setProperty('--accent-bg', `color-mix(in oklch, ${settings.accent} 18%, transparent)`)
  }, [settings.theme, settings.accent])

  const value: SettingsContextValue = {
    ...settings,
    setTheme: (theme) => setSettings((s) => ({ ...s, theme })),
    setAccent: (accent) => setSettings((s) => ({ ...s, accent })),
    setLayout: (layout) => setSettings((s) => ({ ...s, layout })),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useSettings(): SettingsContextValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSettings must be used inside <SettingsProvider>')
  return v
}
