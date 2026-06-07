import { IconLogo } from './Icons'

interface AppLoadingProps {
  caption?: string
}

export function AppLoading({ caption = 'Loading puzzle…' }: AppLoadingProps) {
  return (
    <div className="app-loading">
      <div className="app-loading-inner">
        <span className="brand-mark" style={{ width: 36, height: 36 }}><IconLogo /></span>
        <div className="app-loading-spinner" />
        <div className="app-loading-caption">{caption}</div>
      </div>
    </div>
  )
}
