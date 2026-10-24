import Image from "next/image";
import Link from "next/link";
import { Archive, Eye, EyeOff, Pencil } from "lucide-react";
import type { AdminProductRow } from "@/lib/repositories/admin";
import { canDeliverImage } from "@/lib/images";
import { archiveProductAction, setAvailabilityAction } from "@/lib/actions/products";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ConfirmSubmit } from "@/components/admin/confirm-submit";

/**
 * Admin product list (Phase 3).
 *
 * Deliberate responsive composition: a dense table on md+ screens and
 * stacked cards on phones — never a compressed table that overflows.
 * Actions are plain forms with Server Actions, so each one is
 * independently authorized and works without client JavaScript beyond
 * the two-step confirmation.
 */

const STATUS_TONE: Record<string, BadgeTone> = {
  published: "leaf",
  draft: "neutral",
  archived: "terracotta",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function PriceText({ priceInput }: { priceInput: string }) {
  if (!priceInput) {
    return <span className="font-sans text-sm text-ink-muted">Not set</span>;
  }
  return <span className="font-sans text-sm font-semibold text-navy">${priceInput}</span>;
}

function StatusBadges({ row }: { row: AdminProductRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status}</Badge>
      {row.availability === "unavailable" && row.status !== "archived" ? (
        <Badge tone="terracotta">Unavailable</Badge>
      ) : null}
      {row.featured && row.status === "published" ? <Badge tone="gold">Featured</Badge> : null}
    </span>
  );
}

function Thumbnail({ row, className }: { row: AdminProductRow; className?: string }) {
  const image = row.thumbnailUrl ? { secureUrl: row.thumbnailUrl } : null;

  // Same guard as the storefront (FoodMedia): `next/image` throws during
  // render when a host is missing from the build's image remote-patterns, so
  // a photo the current build cannot deliver falls back instead of crashing
  // the whole admin page (delivery is configured at build/server start).
  if (canDeliverImage(image)) {
    return (
      <Image
        src={image.secureUrl}
        alt=""
        fill
        sizes="(max-width: 768px) 56px, 56px"
        className={`rounded-lg object-cover ${className ?? ""}`}
      />
    );
  }
  return (
    <div
      className={`flex items-center justify-center rounded-lg bg-cream-200 font-sans text-[11px] font-semibold uppercase tracking-wide text-ink-muted ${className ?? ""}`}
      aria-hidden="true"
      title={
        image
          ? "Photos are saved, but this server is not configured to display product images yet."
          : undefined
      }
    >
      {image ? "Not shown" : "No photo"}
    </div>
  );
}

function AvailabilityToggle({ row }: { row: AdminProductRow }) {
  const next = row.availability === "available" ? "unavailable" : "available";
  return (
    <form action={setAvailabilityAction} className="inline-flex">
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="availability" value={next} />
      <button
        type="submit"
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-navy/25 px-3.5 font-sans text-xs font-bold text-navy transition-colors hover:border-navy hover:bg-navy hover:text-cream focus-gold"
      >
        {row.availability === "available" ? (
          <>
            <EyeOff className="size-3.5" aria-hidden="true" />
            Mark unavailable
          </>
        ) : (
          <>
            <Eye className="size-3.5" aria-hidden="true" />
            Mark available
          </>
        )}
      </button>
    </form>
  );
}

function ArchiveAction({ row }: { row: AdminProductRow }) {
  return (
    <ConfirmSubmit
      action={archiveProductAction}
      fields={{ id: row.id }}
      buttonLabel="Archive"
      confirmLabel="Confirm archive"
    >
      <Archive className="size-3.5" aria-hidden="true" />
    </ConfirmSubmit>
  );
}

function EditLink({ row }: { row: AdminProductRow }) {
  return (
    <Link
      href={`/admin/products/${row.id}/edit`}
      className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-navy px-4 font-sans text-xs font-bold text-cream transition-colors hover:bg-navy-800 focus-gold"
    >
      <Pencil className="size-3.5" aria-hidden="true" />
      Edit
    </Link>
  );
}

export function ProductTable({ rows }: { rows: AdminProductRow[] }) {
  return (
    <>
      {/* Desktop / tablet: table */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-surface md:block">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-border bg-cream-100">
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Product
              </th>
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Category
              </th>
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Price
              </th>
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Status
              </th>
              <th scope="col" className="px-4 py-3 font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Updated
              </th>
              <th scope="col" className="px-4 py-3 text-right font-sans text-xs font-bold uppercase tracking-wide text-ink-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.id} className="align-middle transition-colors hover:bg-cream-100/60">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="relative size-14 shrink-0">
                      <Thumbnail row={row} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-sans text-sm font-bold text-navy">{row.name}</p>
                      <p className="font-sans text-xs text-ink-muted">
                        {row.imageCount === 0
                          ? "No photos yet"
                          : `${row.imageCount} photo${row.imageCount === 1 ? "" : "s"}`}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 font-sans text-sm text-navy-700">{row.categoryName}</td>
                <td className="px-4 py-3">
                  <PriceText priceInput={row.priceInput} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadges row={row} />
                </td>
                <td className="px-4 py-3 font-sans text-sm text-ink-muted">{formatDate(row.updatedAt)}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {row.status !== "archived" ? <AvailabilityToggle row={row} /> : null}
                    {row.status !== "archived" ? <ArchiveAction row={row} /> : null}
                    <EditLink row={row} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <div className="relative size-14 shrink-0">
                <Thumbnail row={row} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-sans text-sm font-bold text-navy">{row.name}</p>
                <p className="font-sans text-xs text-ink-muted">{row.categoryName}</p>
                <div className="mt-1.5">
                  <StatusBadges row={row} />
                </div>
              </div>
            </div>
            <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3">
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-xs font-semibold text-ink-muted">Price</dt>
                <dd>
                  <PriceText priceInput={row.priceInput} />
                </dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="font-sans text-xs font-semibold text-ink-muted">Updated</dt>
                <dd className="font-sans text-sm text-ink-muted">{formatDate(row.updatedAt)}</dd>
              </div>
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <EditLink row={row} />
              {row.status !== "archived" ? <AvailabilityToggle row={row} /> : null}
              {row.status !== "archived" ? <ArchiveAction row={row} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
