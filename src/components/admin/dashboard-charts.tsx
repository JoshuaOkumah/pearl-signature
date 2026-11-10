import { cn } from "@/lib/utils";

/**
 * Dashboard charts (Phase 8 admin refresh).
 *
 * Hand-rolled with plain markup and one SVG circle rather than a charting
 * dependency: the shapes are simple, the bundle stays small, and every
 * value is rendered as text next to the graphic so the page is readable
 * with a screen reader, in print, and if CSS fails.
 *
 * Rules followed here:
 *  - No colour is invented: every class is a design token.
 *  - No animation, so `prefers-reduced-motion` needs no special case.
 *  - A zero is drawn as a faint stub, never as an invisible bar that could
 *    be mistaken for missing data.
 *  - The graphic is decorative (`aria-hidden`); the numbers are the content.
 */

const TONES = {
  navy: { fill: "bg-navy", ring: "text-navy", soft: "bg-navy/15" },
  leaf: { fill: "bg-leaf", ring: "text-leaf", soft: "bg-leaf/20" },
  gold: { fill: "bg-gold", ring: "text-gold", soft: "bg-gold/25" },
  terracotta: { fill: "bg-terracotta", ring: "text-terracotta", soft: "bg-terracotta/20" },
} as const;

export type ChartTone = keyof typeof TONES;

/** A circular progress indicator with the percentage in the middle. */
export function ProgressRing({
  value,
  label,
  detail,
  tone = "leaf",
  emptyLabel = "Nothing to measure yet",
}: {
  /** 0..1 */
  value: number;
  label: string;
  detail?: string;
  tone?: ChartTone;
  emptyLabel?: string;
}) {
  const safe = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0;
  const percent = Math.round(safe * 100);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * safe;

  return (
    <div className="flex flex-col items-center text-center">
      <div className="relative">
        <svg
          viewBox="0 0 100 100"
          className="size-32"
          role="img"
          aria-label={`${label}: ${percent} percent`}
        >
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="9"
            stroke="currentColor"
            className="text-cream-200"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform="rotate(-90 50 50)"
            className={TONES[tone].ring}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-serif text-2xl font-semibold tabular-nums text-navy">
          {percent}%
        </span>
      </div>
      <p className="mt-2 font-sans text-sm font-semibold text-navy">{label}</p>
      <p className="mt-0.5 font-sans text-xs text-ink-muted">{detail ?? emptyLabel}</p>
    </div>
  );
}

/** Vertical bars for a short time series (orders per day). */
export function BarSeries({
  data,
  label,
  unit = "orders",
}: {
  data: Array<{ label: string; value: number }>;
  label: string;
  unit?: string;
}) {
  const max = Math.max(...data.map((point) => point.value), 1);
  const total = data.reduce((sum, point) => sum + point.value, 0);

  return (
    <figure>
      <div className="flex h-44 items-end gap-2 sm:gap-3" role="img" aria-label={`${label}. ${total} ${unit} in total.`}>
        {data.map((point) => {
          const height = point.value === 0 ? 0 : Math.max((point.value / max) * 100, 4);
          return (
            <div key={point.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span className="font-sans text-[11px] font-bold tabular-nums text-navy">{point.value}</span>
              <div className="flex w-full flex-1 items-end">
                {point.value === 0 ? (
                  <div className="h-0.5 w-full rounded-full bg-navy/15" aria-hidden="true" />
                ) : (
                  <div
                    className="w-full rounded-t-md bg-navy"
                    style={{ height: `${height}%` }}
                    aria-hidden="true"
                  />
                )}
              </div>
              <span className="font-sans text-[11px] text-ink-muted">{point.label}</span>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-3 font-sans text-xs text-ink-muted">
        {label} · {total} {total === 1 ? unit.replace(/s$/, "") : unit}
      </figcaption>
    </figure>
  );
}

/** Horizontal ranked bars (best-selling dishes, status counts). */
export function RankedBars({
  items,
  emptyLabel,
  tone = "navy",
  unitLabel = "",
}: {
  items: Array<{ label: string; value: number }>;
  emptyLabel: string;
  tone?: ChartTone;
  unitLabel?: string;
}) {
  if (items.length === 0) {
    return <p className="font-sans text-sm text-ink-muted">{emptyLabel}</p>;
  }
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate font-sans text-sm font-semibold text-navy">{item.label}</span>
            <span className="shrink-0 font-sans text-sm tabular-nums text-ink-muted">
              {item.value}
              {unitLabel ? ` ${unitLabel}` : ""}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-cream-200" aria-hidden="true">
            <div
              className={cn("h-full rounded-full", TONES[tone].fill)}
              style={{ width: `${Math.max((item.value / max) * 100, 2)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A single labelled progress bar (collected vs outstanding, one status). */
export function Meter({
  label,
  value,
  max,
  valueLabel,
  tone = "navy",
  hint,
}: {
  label: string;
  value: number;
  max: number;
  valueLabel: string;
  tone?: ChartTone;
  hint?: string;
}) {
  const ratio = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-sans text-sm font-semibold text-navy">{label}</span>
        <span className="shrink-0 font-sans text-sm tabular-nums text-navy-700">{valueLabel}</span>
      </div>
      <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-cream-200" aria-hidden="true">
        <div className={cn("h-full rounded-full", TONES[tone].fill)} style={{ width: `${ratio * 100}%` }} />
      </div>
      {hint ? <p className="mt-1 font-sans text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}
