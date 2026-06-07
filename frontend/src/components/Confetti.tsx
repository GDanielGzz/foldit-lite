import { useMemo, type CSSProperties } from 'react'

/** Pure-CSS confetti burst. ~1.6s animation, ~28 particles. */
export function Confetti() {
  const dots = useMemo(
    () =>
      Array.from({ length: 28 }).map((_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 240,
        y: -(Math.random() * 80 + 40),
        r: Math.random() * 360,
        c: ['var(--accent)', 'var(--violet)', 'var(--warn)', 'var(--info)'][i % 4],
        d: Math.random() * 0.4,
      })),
    [],
  )
  return (
    <div className="confetti" aria-hidden="true">
      {dots.map((d) => (
        <span
          key={d.id}
          style={
            {
              ['--x' as string]: `${d.x}px`,
              ['--y' as string]: `${d.y}px`,
              ['--r' as string]: `${d.r}deg`,
              ['--d' as string]: `${d.d}s`,
              background: d.c,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}
