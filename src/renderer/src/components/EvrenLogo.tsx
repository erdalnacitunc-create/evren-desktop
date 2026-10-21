interface Props {
  size?: number
  className?: string
}

/**
 * EVREN logosu: yörünge halkası + gezegen çekirdeği.
 * Özgün çizim; herhangi bir uygulamanın simgesinden türetilmemiştir.
 */
export function EvrenLogo({ size = 40, className }: Props): React.JSX.Element {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="EVREN"
    >
      <defs>
        <linearGradient id="evren-bg" x1="6" y1="4" x2="58" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="0.55" stopColor="#0ea5e9" />
          <stop offset="1" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="evren-ring" x1="12" y1="20" x2="54" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#dbeafe" stopOpacity="0.8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#evren-bg)" />
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="16"
        fill="none"
        stroke="#ffffff"
        strokeOpacity="0.18"
        strokeWidth="1"
      />
      <g transform="rotate(-24 32 32)">
        <ellipse
          cx="32"
          cy="32"
          rx="23"
          ry="10"
          fill="none"
          stroke="url(#evren-ring)"
          strokeWidth="2.4"
        />
        <circle cx="53" cy="27" r="3.2" fill="#ffffff" />
      </g>
      <circle cx="32" cy="32" r="5.4" fill="#ffffff" />
      <circle cx="32" cy="32" r="2.2" fill="#0ea5e9" />
      <circle cx="15" cy="18" r="1.3" fill="#ffffff" fillOpacity="0.85" />
      <circle cx="46" cy="47" r="1.1" fill="#ffffff" fillOpacity="0.7" />
      <path
        d="M44 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"
        fill="#ffffff"
        fillOpacity="0.9"
      />
    </svg>
  )
}
