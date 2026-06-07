import { IconHelix, IconSparkle } from './Icons'

interface TutorCardProps {
  available: boolean
  canExplain: boolean
  reasonDisabled?: string
  loading: boolean
  explanation: string | null
  onAsk: () => void
  tokensInfo?: { input: number; output: number; cached: number; model: string } | null
  /** Show the input/output token + model debug strip. Pass `?debug=1` to enable. */
  debug?: boolean
}

// Render a Markdown-lite message: **bold** stays bold, `code` becomes pill.
function renderMessage(text: string): { __html: string } {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  html = html
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<span class="pill">$1</span>')
    // Highlight inline AA substitutions like P→A as pills too.
    .replace(/\b([ACDEFGHIKLMNPQRSTVWY])\s*(?:→|-&gt;)\s*([ACDEFGHIKLMNPQRSTVWY])\b/g, '<span class="pill">$1→$2</span>')
  return { __html: html }
}

export function TutorCard({
  available,
  canExplain,
  reasonDisabled,
  loading,
  explanation,
  onAsk,
  tokensInfo,
  debug = false,
}: TutorCardProps) {
  if (!available) {
    return (
      <div className="tutor-card disabled">
        <div className="tutor-head">
          <span className="tutor-avatar"><IconHelix /></span>
          <div className="tutor-name">
            Foldit Tutor
            <small>Offline — set <code>ANTHROPIC_API_KEY</code> to enable</small>
          </div>
        </div>
      </div>
    )
  }

  const status = loading
    ? <span className="typing"><i /><i /><i /></span>
    : canExplain
      ? 'Ready to explain your last move'
      : 'Waiting for a mutation…'

  return (
    <div className="tutor-card">
      <div className="tutor-head">
        <span className="tutor-avatar"><IconHelix /></span>
        <div className="tutor-name">
          Foldit Tutor
          <small>{status}</small>
        </div>
      </div>

      {explanation && (
        <div className="tutor-msg" dangerouslySetInnerHTML={renderMessage(explanation)} />
      )}

      <div className="tutor-actions">
        <button
          className="btn accent flex1"
          disabled={!canExplain || loading}
          onClick={onAsk}
          title={!canExplain ? reasonDisabled : 'Ask the tutor about your last mutation'}
        >
          <IconSparkle />
          {loading ? 'Thinking…' : 'Explain my last mutation'}
        </button>
      </div>

      {debug && tokensInfo && (
        <details className="tutor-meta">
          <summary>{tokensInfo.input} in / {tokensInfo.output} out · {tokensInfo.model}</summary>
          <div style={{ marginTop: 4 }}>
            {tokensInfo.cached > 0 ? `${tokensInfo.cached} cached` : 'no cache hit'}
          </div>
        </details>
      )}
    </div>
  )
}
