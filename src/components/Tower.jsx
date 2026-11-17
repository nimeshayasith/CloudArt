/**
 * Tower — abstract lighthouse / control-tower illustration.
 * viewBox/lamp coordinates live in ../content/lamp.js (shared with Hero).
 */
import { LAMP } from '../content/lamp'

export default function Tower() {
  return (
    <svg viewBox={`0 0 ${LAMP.w} ${LAMP.h}`} fill="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
      {/* blueprint grid */}
      <g opacity="0.07" stroke="#64D8EB" strokeWidth="0.5">
        {[0, 40, 80, 120, 160, 200, 240].map(x => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="340" />)}
        {[0, 40, 80, 120, 160, 200, 240, 280, 320].map(y => <line key={`h${y}`} x1="0" y1={y} x2="260" y2={y} />)}
      </g>

      {/* base + legs */}
      <rect x="80" y="300" width="100" height="12" rx="4" fill="#1A2840" stroke="#FFC857" strokeOpacity="0.4" strokeWidth="0.6" />
      <line x1="110" y1="300" x2="100" y2="250" stroke="#243A5A" strokeWidth="3" />
      <line x1="150" y1="300" x2="160" y2="250" stroke="#243A5A" strokeWidth="3" />

      {/* column */}
      <rect x="108" y="120" width="44" height="130" rx="3" fill="#111D2E" stroke="#2C4468" />
      {[140, 160, 180, 200, 220].map(y => <line key={y} x1="108" y1={y} x2="152" y2={y} stroke="#223555" strokeWidth="0.8" />)}
      <rect x="90" y="245" width="80" height="8" rx="2" fill="#162235" stroke="#FFC857" strokeOpacity="0.35" strokeWidth="0.5" />
      {[150, 175, 200].map(y => (
        <rect key={y} x="122" y={y} width="16" height="8" rx="1" fill="#FFC857" fillOpacity="0.14" stroke="#FFC857" strokeOpacity="0.6" strokeWidth="0.5" />
      ))}

      {/* upper shaft + lamp room */}
      <rect x="114" y="80" width="32" height="42" rx="2" fill="#0E1A2B" stroke="#2C4468" />
      <rect x="104" y="55" width="52" height="28" rx="4" fill="#101E30" stroke="#FFC857" strokeOpacity="0.9" strokeWidth="0.8" />
      <circle cx={LAMP.x} cy={LAMP.y} r="11" fill="#FFC857" fillOpacity="0.25">
        <animate attributeName="r" values="9;14;9" dur="2.4s" repeatCount="indefinite" />
      </circle>
      <circle cx={LAMP.x} cy={LAMP.y} r="5" fill="#FFC857" />

      {/* antenna */}
      <line x1="130" y1="55" x2="130" y2="22" stroke="#2C4468" strokeWidth="1.5" />
      <circle cx="130" cy="19" r="3" fill="#64D8EB">
        <animate attributeName="fill-opacity" values="1;0.3;1" dur="1.8s" repeatCount="indefinite" />
      </circle>

      {/* connected service nodes */}
      <g stroke="#64D8EB" strokeOpacity="0.7" strokeWidth="0.8">
        <line x1="93" y1="190" x2="108" y2="190" />
        <line x1="152" y1="170" x2="167" y2="170" />
        <circle cx="88" cy="190" r="5" fill="#0E1A2B" />
        <circle cx="172" cy="170" r="5" fill="#0E1A2B" />
      </g>
    </svg>
  )
}
