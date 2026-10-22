import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest: string }).digest = `NEXT_REDIRECT;${url}`;
    throw error;
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/mongoose", () => ({
  connectDatabase: vi.fn(async () => undefined),
  logDatabaseError: vi.fn(),
  isDatabaseConfigured: vi.fn(() => true),
  DatabaseUnavailableError: class DatabaseUnavailableError extends Error {},
}));

vi.mock("@/lib/auth/guard", () => ({
  requireActionAdmin: vi.fn(async () => ({ ok: true, admin: OWNER })),
  requirePageAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/server/invalidate", () => ({
  invalidateCatalogue: vi.fn(),
}));

vi.mock("@/models/product", () => ({
  ProductModel: { create: vi.fn(), findById: vi.fn(), exists: vi.fn(), updateOne: vi.fn(), findOne: vi.fn() },
}));

vi.mock("@/models/category", () => ({
  CategoryModel: { exists: vi.fn() },
}));

import { redirect } from "next/navigation";
import { CategoryModel } from "@/models/category";
import { ProductModel } from "@/models/product";
import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { invalidateCatalogue } from "@/lib/server/invalidate";
import {
  archiveProductAction,
  createProductAction,
  restoreProductAction,
  setAvailabilityAction,
  updateProductAction,
} from "./products";

const OWNER = { _id: "64b0f00000000000000000aa", email: "owner@example.com", role: "owner", status: "active" };
const CATEGORY_ID = "507f1f77bcf86cd799439011";
const PRODUCT_ID = "507f1f77bcf86cd799439022";

/** Chainable findById stand-in supporting .lean() and .select().lean(). */
function productQuery(record: Record<string, unknown> | null) {
  const query: Record<string, unknown> = {
    lean: async () => record,
    select: () => ({ lean: async () => record }),
  };
  return query;
}

function updateResult(matchedCount: number) {
  return { matchedCount, exec: async () => ({ matchedCount }) };
}

function productForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("id", overrides.id ?? PRODUCT_ID);
  formData.set("name", overrides.name ?? "Jollof Rice");
  formData.set("slug", overrides.slug ?? "");
  formData.set("categoryId", overrides.categoryId ?? CATEGORY_ID);
  formData.set("shortDescription", overrides.shortDescription ?? "");
  formData.set("description", overrides.description ?? "Party jollof rice.");
  formData.set("price", overrides.price ?? "12.50");
  formData.set("status", overrides.status ?? "draft");
  formData.set("availability", overrides.availability ?? "available");
  formData.set("sortOrder", overrides.sortOrder ?? "10");
  formData.set("tags", overrides.tags ?? "");
  if (overrides.featured !== undefined) formData.set("featured", overrides.featured);
  if (overrides.expectedUpdatedAt !== undefined) {
    formData.set("expectedUpdatedAt", overrides.expectedUpdatedAt);
  }
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActionAdmin).mockResolvedValue({ ok: true, admin: OWNER } as never);
  vi.mocked(CategoryModel.exists).mockResolvedValue({ _id: CATEGORY_ID } as never);
  vi.mocked(ProductModel.exists).mockResolvedValue(null as never);
});

describe("authorization (every mutation, independently)", () => {
  it("rejects every product mutation without a valid session", async () => {
    vi.mocked(requireActionAdmin).mockResolvedValue({ ok: false, reason: "unauthorized" } as never);

    const result = await createProductAction({ ok: false }, productForm());
    expect(result).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
    expect(ProductModel.create).not.toHaveBeenCalled();

    const update = await updateProductAction({ ok: false }, productForm({ expectedUpdatedAt: "x" }));
    expect(update.ok).toBe(false);

    await expect(archiveProductAction(productForm())).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/admin/login");
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });
});

describe("createProductAction", () => {
  it("validates input before touching the database", async () => {
    const result = await createProductAction({ ok: false }, productForm({ description: "" }));
    expect(result.ok).toBe(false);
    expect(result.fieldErrors?.description).toBeTruthy();
    expect(ProductModel.create).not.toHaveBeenCalled();
  });

  it("rejects a missing category", async () => {
    vi.mocked(CategoryModel.exists).mockResolvedValue(null as never);
    const result = await createProductAction({ ok: false }, productForm());
    expect(result.fieldErrors?.categoryId).toBeTruthy();
    expect(ProductModel.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate slugs gracefully", async () => {
    vi.mocked(ProductModel.exists).mockResolvedValue({ _id: PRODUCT_ID } as never);
    const result = await createProductAction({ ok: false }, productForm());
    expect(result.fieldErrors?.slug).toMatch(/already used/);
    expect(ProductModel.create).not.toHaveBeenCalled();
  });

  it("converts CAD text to integer cents and writes only allowlisted fields", async () => {
    vi.mocked(ProductModel.create).mockResolvedValue({ _id: PRODUCT_ID, name: "Jollof Rice", status: "draft" } as never);

    await expect(createProductAction({ ok: false }, productForm({ price: "12.50", featured: "on" }))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );

    const payload = vi.mocked(ProductModel.create).mock.calls[0][0] as Record<string, unknown>;
    expect(payload.priceCents).toBe(1250);
    expect(payload.featured).toBe(true);
    expect(payload.status).toBe("draft");
    expect(payload.slug).toBe("jollof-rice"); // derived from the name
    // Mass-assignment guard: nothing outside the allowlist can be written.
    expect(Object.keys(payload).every((key) =>
      [
        "name", "slug", "categoryId", "shortDescription", "description", "priceCents",
        "variants", "status", "availability", "featured", "sortOrder", "tags",
      ].includes(key),
    )).toBe(true);

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ event: "product.created" }));
    expect(invalidateCatalogue).toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(`/admin/products/${PRODUCT_ID}/edit?created=1`);
  });

  it("stores variant prices as integer cents", async () => {
    vi.mocked(ProductModel.create).mockResolvedValue({ _id: PRODUCT_ID, name: "Jollof Rice", status: "draft" } as never);
    const formData = productForm();
    formData.append("variantName", "Family");
    formData.append("variantPrice", "20.00");

    await expect(createProductAction({ ok: false }, formData)).rejects.toThrow(/NEXT_REDIRECT/);
    const payload = vi.mocked(ProductModel.create).mock.calls[0][0] as { variants: Array<{ priceCents: number | null }> };
    expect(payload.variants).toEqual([{ name: "Family", priceCents: 2000 }]);
  });
});

describe("updateProductAction", () => {
  const EXISTING = {
    _id: PRODUCT_ID,
    name: "Jollof Rice",
    slug: "jollof-rice",
    previousSlugs: [] as string[],
    status: "draft",
    updatedAt: new Date("2026-10-01T10:00:00.000Z"),
  };

  it("refuses to save without the concurrency token", async () => {
    const result = await updateProductAction({ ok: false }, productForm());
    expect(result.conflict).toBe(true);
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });

  it("refuses to overwrite a newer save (optimistic concurrency)", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(productQuery(EXISTING) as never);
    const result = await updateProductAction(
      { ok: false },
      productForm({ expectedUpdatedAt: "2026-09-30T09:00:00.000Z" }),
    );
    expect(result.conflict).toBe(true);
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });

  it("saves with the loaded updatedAt inside the filter (race-proof)", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(productQuery(EXISTING) as never);
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(1) as never);

    await expect(
      updateProductAction(
        { ok: false },
        productForm({ expectedUpdatedAt: EXISTING.updatedAt.toISOString(), price: "15.75" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);

    const [filter, update] = vi.mocked(ProductModel.updateOne).mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    // Concurrency guard lives in the filter itself.
    expect(filter.updatedAt).toEqual(EXISTING.updatedAt);
    expect((update.$set as Record<string, unknown>).priceCents).toBe(1575);

    // Allowlist check: only known fields are ever written.
    const written = Object.keys(update.$set);
    expect(written).not.toContain("_id");
    expect(written).not.toContain("createdAt");
    expect(written.every((key) =>
      [
        "name", "slug", "previousSlugs", "categoryId", "shortDescription", "description",
        "priceCents", "variants", "status", "availability", "featured", "sortOrder", "tags",
      ].includes(key),
    )).toBe(true);
  });

  it("detects a concurrent modification through matchedCount = 0", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(productQuery(EXISTING) as never);
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(0) as never);

    const result = await updateProductAction(
      { ok: false },
      productForm({ expectedUpdatedAt: EXISTING.updatedAt.toISOString() }),
    );
    expect(result.conflict).toBe(true);
    expect(invalidateCatalogue).not.toHaveBeenCalled();
  });

  it("keeps the slug stable when the field is unchanged and records history on change", async () => {
    // Unchanged slug: stored history untouched.
    vi.mocked(ProductModel.findById).mockReturnValue(productQuery(EXISTING) as never);
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(1) as never);
    await expect(
      updateProductAction(
        { ok: false },
        productForm({ expectedUpdatedAt: EXISTING.updatedAt.toISOString(), slug: "jollof-rice" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const unchanged = vi.mocked(ProductModel.updateOne).mock.calls[0] as unknown as [
      unknown,
      { $set: { previousSlugs: string[] } },
    ];
    expect(unchanged[1].$set.previousSlugs).toEqual([]);

    // Changed slug: old address is preserved for redirects.
    vi.mocked(ProductModel.findById).mockReturnValue(productQuery(EXISTING) as never);
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(1) as never);
    await expect(
      updateProductAction(
        { ok: false },
        productForm({ expectedUpdatedAt: EXISTING.updatedAt.toISOString(), slug: "party-jollof" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const changed = vi.mocked(ProductModel.updateOne).mock.calls[1] as unknown as [
      unknown,
      { $set: { slug: string; previousSlugs: string[] } },
    ];
    expect(changed[1].$set.slug).toBe("party-jollof");
    expect(changed[1].$set.previousSlugs).toContain("jollof-rice");
  });

  it("rejects a slug already owned by another product", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(productQuery(EXISTING) as never);
    vi.mocked(ProductModel.exists).mockResolvedValue({ _id: "another" } as never);

    const result = await updateProductAction(
      { ok: false },
      productForm({ expectedUpdatedAt: EXISTING.updatedAt.toISOString(), slug: "taken-slug" }),
    );
    expect(result.fieldErrors?.slug).toMatch(/already used/);
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });

  it("reports the status transition in the audit trail", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(productQuery(EXISTING) as never);
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(1) as never);

    await expect(
      updateProductAction(
        { ok: false },
        productForm({ expectedUpdatedAt: EXISTING.updatedAt.toISOString(), status: "published" }),
      ),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "product.status_changed", detail: "draft → published" }),
    );
  });
});

describe("archive / restore / availability", () => {
  it("archives without deleting and audits the event", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(
      productQuery({ _id: PRODUCT_ID, name: "Jollof Rice", status: "published" }) as never,
    );
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(1) as never);

    const formData = new FormData();
    formData.set("id", PRODUCT_ID);
    await expect(archiveProductAction(formData)).rejects.toThrow(/NEXT_REDIRECT/);

    const [filter, update] = vi.mocked(ProductModel.updateOne).mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: { status: string } },
    ];
    // Archived by status change — the document is never removed.
    expect(update.$set.status).toBe("archived");
    expect(filter.status).toMatchObject({ $ne: "archived" });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ event: "product.archived" }));
    expect(invalidateCatalogue).toHaveBeenCalled();
  });

  it("restores an archived product as a draft", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(
      productQuery({ _id: PRODUCT_ID, name: "Jollof Rice", status: "archived" }) as never,
    );
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(1) as never);

    const formData = new FormData();
    formData.set("id", PRODUCT_ID);
    await expect(restoreProductAction(formData)).rejects.toThrow(/NEXT_REDIRECT/);
    const update = vi.mocked(ProductModel.updateOne).mock.calls[0] as unknown as [unknown, { $set: { status: string } }];
    expect(update[1].$set.status).toBe("draft");
  });

  it("redirects with an honest error flag on infrastructure failure", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(
      productQuery({ _id: PRODUCT_ID, name: "Jollof Rice", status: "published" }) as never,
    );
    vi.mocked(ProductModel.updateOne).mockReturnValue({
      exec: async () => Promise.reject(new Error("down")),
    } as never);

    const formData = new FormData();
    formData.set("id", PRODUCT_ID);
    await expect(archiveProductAction(formData)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/admin/products?opError=1");
  });

  it("toggles availability and audits the transition", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(
      productQuery({ _id: PRODUCT_ID, name: "Jollof Rice", availability: "available" }) as never,
    );
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(1) as never);

    const formData = new FormData();
    formData.set("id", PRODUCT_ID);
    formData.set("availability", "unavailable");
    // The toggle succeeds silently (POST-redirect-GET happens via revalidate).
    await expect(setAvailabilityAction(formData)).resolves.toBeUndefined();

    const update = vi.mocked(ProductModel.updateOne).mock.calls[0] as unknown as [unknown, { $set: { availability: string } }];
    expect(update[1].$set.availability).toBe("unavailable");
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "available → unavailable" }),
    );
  });

  it("rejects malformed product ids without database access", async () => {
    const formData = new FormData();
    formData.set("id", "not-an-objectid");
    formData.set("availability", "available");
    await expect(setAvailabilityAction(formData)).rejects.toThrow(/NEXT_REDIRECT/);
    expect(ProductModel.findById).not.toHaveBeenCalled();
  });
});
