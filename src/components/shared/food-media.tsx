import { cn, slugify } from "@/lib/utils";
import type { DishTheme } from "@/types";

type Ratio = "4/3" | "3/2" | "16/10" | "square";

const ratioClass: Record<Ratio, string> = {
  "4/3": "aspect-[4/3]",
  "3/2": "aspect-[3/2]",
  "16/10": "aspect-[16/10]",
  square: "aspect-square",
};

interface FoodMediaProps {
  theme: DishTheme;
  /** Dish name — used for deterministic gradient ids. */
  label: string;
  ratio?: Ratio;
  className?: string;
  /** Disambiguates SVG ids when the same dish renders more than once on a page. */
  idSuffix?: string;
}

/**
 * Temporary dish visual — a stylised “plated dish” SVG composition in a
 * per-dish palette. This is deliberately honest placeholder media: no fake
 * photography is presented as real business imagery.
 *
 * Cloudinary migration path (later phase): keep this component’s props API,
 * swap the SVG body for next/image with a Cloudinary loader and real alt text.
 * Aspect ratios are fixed via `aspect-*`, so layouts never shift.
 *
 * Decorative: the adjacent product name carries the meaning, so the media is
 * hidden from assistive technology.
 */
export function FoodMedia({ theme, label, ratio = "4/3", className, idSuffix = "media" }: FoodMediaProps) {
  const uid = `${slugify(label)}-${idSuffix}`;
  const bgId = `${uid}-bg`;
  const foodId = `${uid}-food`;
  const plateId = `${uid}-plate`;

  return (
    <div aria-hidden="true" className={cn("relative w-full overflow-hidden bg-cream-100", ratioClass[ratio], className)}>
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 400 300"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <linearGradient id={bgId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#FBF6EC" />
            <stop offset="100%" stopColor="#F2E9D6" />
          </linearGradient>
          <radialGradient id={foodId} cx="0.38" cy="0.3" r="0.95">
            <stop offset="0%" stopColor={theme.base} />
            <stop offset="100%" stopColor={theme.deep} />
          </radialGradient>
          <radialGradient id={plateId} cx="0.5" cy="0.42" r="0.75">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="100%" stopColor="#F1E9D9" />
          </radialGradient>
        </defs>

        <rect width="400" height="300" fill={`url(#${bgId})`} />

        {/* Decorative table arcs */}
        <circle cx="346" cy="40" r="60" fill="none" stroke={theme.accent} strokeOpacity="0.32" strokeWidth="10" />
        <circle cx="370" cy="16" r="30" fill="none" stroke={theme.accent} strokeOpacity="0.18" strokeWidth="6" />

        {/* Scattered garnish dots */}
        <g fill={theme.accent} fillOpacity="0.45">
          <circle cx="36" cy="238" r="4" />
          <circle cx="53" cy="252" r="3" />
          <circle cx="24" cy="258" r="2.5" />
        </g>

        {/* Plate + soft shadow */}
        <ellipse cx="200" cy="234" rx="114" ry="15" fill="#1A2530" fillOpacity="0.08" />
        <circle cx="200" cy="176" r="104" fill={`url(#${plateId})`} stroke="#E3D8C2" strokeWidth="1.5" />
        <circle cx="200" cy="176" r="80" fill="#FDFAF3" stroke="#EAE0CC" strokeWidth="1" />

        {/* The dish — organic mound with highlights and garnish */}
        <g>
          <ellipse cx="200" cy="172" rx="66" ry="52" fill={`url(#${foodId})`} />
          <ellipse cx="171" cy="158" rx="34" ry="26" fill={`url(#${foodId})`} opacity="0.9" />
          <ellipse cx="229" cy="160" rx="30" ry="24" fill={`url(#${foodId})`} opacity="0.85" />
          <ellipse cx="200" cy="190" rx="40" ry="20" fill={theme.deep} opacity="0.5" />
          <ellipse cx="180" cy="149" rx="16" ry="10" fill="#FFFFFF" opacity="0.16" />
          <circle cx="223" cy="145" r="7" fill="#FFFFFF" opacity="0.12" />
          <ellipse cx="206" cy="139" rx="10" ry="4.5" fill={theme.accent} opacity="0.8" transform="rotate(-18 206 139)" />
          <circle cx="196" cy="150" r="5" fill={theme.accent} />
          <circle cx="215" cy="166" r="4" fill={theme.accent} opacity="0.85" />
          <circle cx="184" cy="170" r="3.5" fill="#D4AF37" opacity="0.9" />
        </g>

        {/* Gentle steam */}
        <path
          d="M188 80c-5-8 5-12 0-20"
          stroke="#1A2530"
          strokeOpacity="0.14"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M212 76c-5-8 5-12 0-20"
          stroke="#1A2530"
          strokeOpacity="0.1"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
}
