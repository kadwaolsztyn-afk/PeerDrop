import React from 'react';

interface PeerDropLogoProps {
  className?: string;
  variant?: 'full' | 'icon' | 'badge';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

/**
 * Official PeerDrop Logo & Emblem
 * Faithfully vectorized from the brand identity:
 * - Dual-loop Infinity ribbon (P2P continuous loop)
 * - Geometric crystal / diamond prism on left node
 * - Shield with download arrow (secure encrypted direct transfer)
 * - "PEERDROP" & "INTELIGENTNY TRANSFER PLIKÓW P2P"
 */
export const PeerDropLogo: React.FC<PeerDropLogoProps> = ({
  className = '',
  variant = 'full',
  size = 'md'
}) => {
  if (variant === 'icon') {
    const dim = size === 'sm' ? 'w-8 h-8' : size === 'lg' ? 'w-12 h-12' : size === 'xl' ? 'w-16 h-16' : 'w-10 h-10';
    return (
      <div className={`relative flex items-center justify-center ${dim} ${className}`}>
        <svg
          viewBox="0 0 200 130"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-[0_2px_10px_rgba(6,182,212,0.3)]"
        >
          <g stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            {/* Infinity Ribbon - Outer & Inner Tracks */}
            <path
              d="M62 38 C40 38 24 50 24 68 C24 86 40 98 62 98 C86 98 100 80 110 68 C120 56 134 38 158 38 C180 38 196 50 196 68 C196 86 180 98 158 98 C134 98 120 80 110 68 C100 56 86 38 62 38 Z"
              fill="none"
              className="text-white"
              strokeWidth="4"
            />
            {/* Secondary 3D ribbon contour band */}
            <path
              d="M62 46 C44 46 32 55 32 68 C32 81 44 90 62 90 C80 90 92 76 102 65 C112 54 126 46 148 46"
              fill="none"
              strokeWidth="2.2"
              className="text-cyan-400"
              strokeDasharray="140"
            />
            <path
              d="M120 73 C130 83 142 90 158 90 C176 90 188 81 188 68 C188 55 176 46 158 46"
              fill="none"
              strokeWidth="2.2"
              className="text-cyan-400"
            />

            {/* Left Faceted Diamond / Prism Crystal */}
            <g transform="translate(18, 40)" className="text-cyan-300">
              {/* Outer faceted hexagon */}
              <polygon points="18,0 36,12 36,36 18,48 0,36 0,12" fill="#030d1a" stroke="currentColor" strokeWidth="2.5" />
              {/* Center vertical ridge */}
              <line x1="18" y1="0" x2="18" y2="48" stroke="currentColor" strokeWidth="2" />
              {/* Facet triangulations */}
              <polygon points="18,12 36,12 18,24 0,12" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <polygon points="18,36 36,36 18,24 0,36" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <line x1="18" y1="0" x2="18" y2="12" stroke="currentColor" strokeWidth="2" />
              <line x1="18" y1="36" x2="18" y2="48" stroke="currentColor" strokeWidth="2" />
              <line x1="0" y1="24" x2="36" y2="24" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.6" />
            </g>

            {/* Right Shield with Download Arrow */}
            <g transform="translate(142, 50)" className="text-white">
              {/* Shield Outline */}
              <path
                d="M16 2 C23 2 28 6 28 8 C28 20 23 28 16 32 C9 28 4 20 4 8 C4 6 9 2 16 2 Z"
                fill="#030d1a"
                stroke="currentColor"
                strokeWidth="2.5"
                className="text-white"
              />
              {/* Arrow Down inside Shield */}
              <line x1="16" y1="8" x2="16" y2="21" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
              <polyline points="11,17 16,22 21,17" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </g>
        </svg>
      </div>
    );
  }

  // Full Banner Logo with Typography
  return (
    <div className={`flex items-center gap-1.5 sm:gap-3 select-none shrink-0 ${className}`}>
      {/* Brand Emblem Graphic */}
      <div className="relative shrink-0 w-7 h-7 sm:w-10 sm:h-10 flex items-center justify-center rounded-lg sm:rounded-xl bg-slate-900/90 border border-slate-700/70 p-0.5 sm:p-1 shadow-lg shadow-cyan-950/40">
        <svg
          viewBox="0 0 200 130"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full"
        >
          <g stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            {/* Infinity Ribbon main loop */}
            <path
              d="M62 38 C40 38 24 50 24 68 C24 86 40 98 62 98 C86 98 100 80 110 68 C120 56 134 38 158 38 C180 38 196 50 196 68 C196 86 180 98 158 98 C134 98 120 80 110 68 C100 56 86 38 62 38 Z"
              fill="none"
              stroke="#ffffff"
              strokeWidth="4"
            />
            {/* 3D internal ribbon depth highlight */}
            <path
              d="M62 46 C44 46 32 55 32 68 C32 81 44 90 62 90 C80 90 92 76 102 65 C112 54 126 46 148 46"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.2"
            />
            <path
              d="M120 73 C130 83 142 90 158 90 C176 90 188 81 188 68 C188 55 176 46 158 46"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="2.2"
            />

            {/* Left Crystal Diamond */}
            <g transform="translate(18, 40)">
              <polygon points="18,0 36,12 36,36 18,48 0,36 0,12" fill="#020617" stroke="#ffffff" strokeWidth="2.5" />
              <line x1="18" y1="0" x2="18" y2="48" stroke="#38bdf8" strokeWidth="2" />
              <polygon points="18,12 36,12 18,24 0,12" fill="none" stroke="#38bdf8" strokeWidth="1.6" />
              <polygon points="18,36 36,36 18,24 0,36" fill="none" stroke="#38bdf8" strokeWidth="1.6" />
            </g>

            {/* Right Shield with Download Arrow */}
            <g transform="translate(142, 50)">
              <path
                d="M16 2 C23 2 28 6 28 8 C28 20 23 28 16 32 C9 28 4 20 4 8 C4 6 9 2 16 2 Z"
                fill="#020617"
                stroke="#ffffff"
                strokeWidth="2.5"
              />
              <line x1="16" y1="8" x2="16" y2="21" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" />
              <polyline points="11,17 16,22 21,17" fill="none" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </g>
        </svg>
      </div>

      {/* Typography: PEERDROP */}
      <div className="flex items-center gap-1.5 sm:gap-2">
        <span className="font-black text-sm sm:text-xl lg:text-2xl tracking-[0.05em] text-white font-sans uppercase">
          PEER<span className="text-cyan-400">DROP</span>
        </span>
      </div>
    </div>
  );
};
