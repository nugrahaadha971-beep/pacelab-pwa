interface BrandLogoProps {
  size?: number;
  showText?: boolean;
}

export default function BrandLogo({ size = 32, showText = false }: BrandLogoProps) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect width="512" height="512" rx="112" fill="#070709" />
        <rect x="8" y="8" width="496" height="496" rx="104" stroke="#C8FF00" strokeOpacity="0.22" strokeWidth="4" />
        <path d="M112 136H164L218 256L164 376H112L166 256L112 136Z" fill="#C8FF00" />
        <path d="M174 136H196L250 256L196 376H174L228 256L174 136Z" fill="#38BDF8" />
        <path
          d="M226 136H348L396 184V256L348 304H272V376H226V136ZM272 178V262H330L354 238V202L330 178H272Z"
          fill="#C8FF00"
        />
        <path
          d="M254 220H286L298 192L314 248L326 220H366"
          stroke="#070709"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showText && (
        <span className="font-display text-lg font-bold tracking-tight text-white">
          PACE<span className="text-volt">LAB</span>
        </span>
      )}
    </span>
  );
}
