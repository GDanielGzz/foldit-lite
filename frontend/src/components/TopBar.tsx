import { useState } from 'react'
import {
  IconLogo,
  IconSearch,
  IconHelp,
  IconGear,
} from './Icons'
import { SettingsPopover } from './SettingsPopover'

interface TopBarProps {
  puzzleTitle: string
  puzzleId: string
  difficulty: string
  sequenceLength: number
  puzzleIndex: number  // 1-based
  totalPuzzles: number
  onReplayTour: () => void
}

export function TopBar({
  puzzleTitle,
  puzzleId,
  difficulty,
  sequenceLength,
  puzzleIndex,
  totalPuzzles,
  onReplayTour,
}: TopBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <IconLogo />
        </span>
        <span>FolditLite</span>
      </div>
      <span className="crumb-sep">/</span>
      <span className="crumb-current">{puzzleTitle}</span>
      <span className={`diff ${difficulty}`}>{difficulty}</span>
      <span className="crumb-meta mono">
        {sequenceLength} aa · puzzle {puzzleIndex} of {totalPuzzles}
        {puzzleId ? ` · ${puzzleId}` : ''}
      </span>

      <div className="topbar-spacer" />

      <button className="icon-btn" title="Search puzzles (coming soon)" aria-label="Search">
        <IconSearch />
      </button>
      <button
        className="icon-btn"
        title="Replay the welcome tour"
        onClick={onReplayTour}
        aria-label="Help"
      >
        <IconHelp />
      </button>
      <div className="settings-wrap">
        <button
          className={`icon-btn ${settingsOpen ? 'on' : ''}`}
          title="Display settings"
          onClick={() => setSettingsOpen((o) => !o)}
          aria-label="Settings"
        >
          <IconGear />
        </button>
        {settingsOpen && <SettingsPopover onClose={() => setSettingsOpen(false)} />}
      </div>
      <span className="kbd">⌘ K</span>
      <div className="avatar" title="Student account">AB</div>
    </header>
  )
}
