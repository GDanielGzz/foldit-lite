// Stylized protein cartoon — abstract alpha-helix ribbon as placeholder
// for the real 3Dmol viewer. Renders a coiled ribbon w/ residue dots tinted
// by the active color mode so the user can map sequence to structure.

const { useMemo } = React;

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r=0,g=0,b=0;
  if (hp<1)[r,g,b]=[c,x,0];
  else if (hp<2)[r,g,b]=[x,c,0];
  else if (hp<3)[r,g,b]=[0,c,x];
  else if (hp<4)[r,g,b]=[0,x,c];
  else if (hp<5)[r,g,b]=[x,0,c];
  else [r,g,b]=[c,0,x];
  const m = l - c/2;
  const to = v => Math.round((v+m)*255).toString(16).padStart(2,'0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function spectrumColor(i, total) {
  if (total <= 1) return hslToHex(135, 75, 55);
  const t = i / (total - 1);
  return hslToHex(270 - 270 * t, 75, 55);
}
function plddtColor(v) {
  const t = Math.max(0, Math.min(1, (v - 0.3) / 0.7));
  return hslToHex(240 * t, 75, 55);
}

window.spectrumColor = spectrumColor;
window.plddtColor = plddtColor;

function ProteinView({ length, colorMode, perResiduePlddt, mutated, highlight, brokenFraction, ssAnnotation }) {
  // Lay out residues along a damped sine — gives a "ribbon" silhouette.
  // brokenFraction (0..1): 0 = clean helix, 1 = chaotic kink (matches RMSD).
  const W = 720, H = 360;
  const cx = W/2, cy = H/2;

  const points = useMemo(() => {
    const n = Math.max(length, 4);
    const pts = [];
    const noise = (i) => {
      // deterministic pseudo-noise per residue
      const s = Math.sin(i * 12.9898) * 43758.5453;
      return s - Math.floor(s);
    };
    const breakerKick = brokenFraction; // 0..1
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // base helix-ish path: gentle S-curve with a coil under it
      const baseX = 80 + t * (W - 160);
      const coilY = cy + Math.sin(t * Math.PI * 6 + 0.3) * 22;
      const swayY = Math.sin(t * Math.PI * 1.4) * 50;
      // chaos: lateral & vertical displacement scaled by brokenFraction
      const nx = (noise(i) - 0.5) * 90 * breakerKick;
      const ny = (noise(i + 99) - 0.5) * 90 * breakerKick;
      pts.push({ x: baseX + nx * 0.6, y: coilY + swayY + ny });
    }
    return pts;
  }, [length, brokenFraction]);

  const pathD = useMemo(() => {
    if (points.length < 2) return '';
    // Catmull-Rom-ish smooth path
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i-1] || points[i];
      const p1 = points[i];
      const p2 = points[i+1];
      const p3 = points[i+2] || p2;
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  }, [points]);

  const residueColor = (i) => {
    if (colorMode === 'plddt') {
      const v = perResiduePlddt?.[i];
      if (v === undefined) return '#888';
      return plddtColor(v);
    }
    if (colorMode === 'structure' && ssAnnotation) {
      const ss = ssAnnotation[i];
      if (ss === 'H') return '#e08c5a';
      if (ss === 'L') return '#9b8ad8';
      return '#7a8a9a';
    }
    return spectrumColor(i, points.length);
  };

  return (
    <svg className="protein-svg" viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
        <linearGradient id="ribbonStroke" x1="0" y1="0" x2="1" y2="0">
          {points.map((_, i) => (
            <stop key={i} offset={`${(i/(points.length-1))*100}%`} stopColor={residueColor(i)} />
          ))}
        </linearGradient>
      </defs>

      {/* soft halo */}
      <path d={pathD} stroke="url(#ribbonStroke)" strokeWidth="22" fill="none"
            strokeLinecap="round" opacity="0.18" filter="url(#glow)" />

      {/* main ribbon */}
      <path d={pathD} stroke="url(#ribbonStroke)" strokeWidth="8" fill="none"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />

      {/* coil shadow */}
      <path d={pathD} stroke="oklch(0 0 0 / 0.35)" strokeWidth="1" fill="none"
            strokeLinecap="round" />

      {/* residue dots */}
      {points.map((p, i) => {
        const isMut = mutated && mutated[i];
        const isHl = highlight === i;
        return (
          <g key={i} transform={`translate(${p.x} ${p.y})`}>
            <circle r={isHl ? 6 : (isMut ? 4 : 2.6)}
                    fill={residueColor(i)}
                    stroke={isMut ? '#c084fc' : (isHl ? '#fff' : 'rgba(0,0,0,0.4)')}
                    strokeWidth={isMut || isHl ? 1.5 : 0.6} />
            {isHl && (
              <g>
                <circle r="11" fill="none" stroke="oklch(0.82 0.14 168)" strokeWidth="1.2" opacity="0.7" />
                <text y="-16" textAnchor="middle"
                      fill="oklch(0.95 0 0)"
                      fontFamily="IBM Plex Mono, monospace"
                      fontSize="10"
                      fontWeight="500">
                  {i + 1}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

window.ProteinView = ProteinView;
