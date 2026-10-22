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
  requireActionAdmin: vi.fn(),
  requirePageAdmin: vi.fn(),
}));

vi.mock("@/lib/auth/audit", () => ({
  recordAudit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/server/invalidate", () => ({
  invalidateCatalogue: vi.fn(),
}));

vi.mock("@/models/category", () => ({
  CategoryModel: { exists: vi.fn(), create: vi.fn(), findById: vi.fn(), updateOne: vi.fn() },
}));

vi.mock("@/models/product", () => ({
  ProductModel: { countDocuments: vi.fn() },
}));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { connectDatabase } from "@/lib/db/mongoose";
import { invalidateCatalogue } from "@/lib/server/invalidate";
import { CategoryModel } from "@/models/category";
import { ProductModel } from "@/models/product";
import {
  countProductsInCategory,
  createCategoryAction,
  updateCategoryAction,
} from "./categories";

const OWNER = { _id: "64b0f00000000000000000aa", email: "owner@example.com", role: "owner", status: "active" };
const CATEGORY_ID = "507f1f77bcf86cd799439011";

function categoryForm(overrides: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set("name", overrides.name ?? "Sides");
  formData.set("slug", overrides.slug ?? "");
  formData.set("description", overrides.description ?? "Small plates and sides.");
  formData.set("sortOrder", overrides.sortOrder ?? "5");
  if (overrides.isActive !== undefined) formData.set("isActive", overrides.isActive);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActionAdmin).mockResolvedValue({ ok: true, admin: OWNER } as never);
  vi.mocked(CategoryModel.exists).mockResolvedValue(null as never);
  vi.mocked(CategoryModel.findById).mockReturnValue({ lean: async () => null } as never);
  vi.mocked(CategoryModel.updateOne).mockReturnValue({
    matchedCount: 1,
    exec: async () => ({ matchedCount: 1 }),
  } as never);
});

describe("authorization", () => {
  it("rejects create, update and count without a live session", async () => {
    vi.mocked(requireActionAdmin).mockResolvedValue({ ok: false, reason: "unauthorized" } as never);

    const create = await createCategoryAction({ ok: false }, categoryForm({ isActive: "true" }));
    expect(create).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
    expect(CategoryModel.create).not.toHaveBeenCalled();

    const update = await updateCategoryAction({ ok: false }, categoryForm({ isActive: "true" }));
    expect(update.ok).toBe(false);
    expect(CategoryModel.updateOne).not.toHaveBeenCalled();

    expect(await countProductsInCategory(CATEGORY_ID)).toBeNull();
    expect(ProductModel.countDocuments).not.toHaveBeenCalled();
  });
});

describe("createCategoryAction", () => {
  it("validates input before touching the database", async () => {
    const result = await createCategoryAction({ ok: false }, categoryForm({ name: "" }));
    expect(result.fieldErrors?.name).toBe("Category name is required");
    expect(CategoryModel.create).not.toHaveBeenCalled();
    expect(connectDatabase).not.toHaveBeenCalled();
  });

  it("rejects a duplicate name", async () => {
    vi.mocked(CategoryModel.exists).mockResolvedValue({ _id: CATEGORY_ID } as never);
    const result = await createCategoryAction({ ok: false }, categoryForm({ isActive: "true" }));
    expect(result.fieldErrors?.name).toMatch(/already exists/);
    expect(CategoryModel.create).not.toHaveBeenCalled();
  });

  it("derives the slug from the name and writes only allowlisted fields", async () => {
    vi.mocked(CategoryModel.create).mockResolvedValue({ _id: CATEGORY_ID, name: "Sides" } as never);

    await expect(createCategoryAction({ ok: false }, categoryForm({ name: "Small Plates", isActive: "true" }))).rejects.toThrow(
      /NEXT_REDIRECT/,
    );

    const payload = vi.mocked(CategoryModel.create).mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({
      name: "Small Plates",
      slug: "small-plates",
      description: "Small plates and sides.",
      sortOrder: 5,
      isActive: true,
    });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ event: "category.created" }));
    expect(invalidateCatalogue).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/admin/categories");
    expect(redirect).toHaveBeenCalledWith("/admin/categories?created=1");
  });

  it("honours an explicit slug", async () => {
    vi.mocked(CategoryModel.create).mockResolvedValue({ _id: CATEGORY_ID, name: "Sides" } as never);
    await expect(
      createCategoryAction({ ok: false }, categoryForm({ slug: "sides-and-starters", isActive: "true" })),
    ).rejects.toThrow(/NEXT_REDIRECT/);
    const payload = vi.mocked(CategoryModel.create).mock.calls[0][0] as { slug: string };
    expect(payload.slug).toBe("sides-and-starters");
  });

  it("maps the unique-index backstop to a friendly field error", async () => {
    vi.mocked(CategoryModel.create).mockRejectedValue({ code: 11000 } as never);
    const result = await createCategoryAction({ ok: false }, categoryForm({ isActive: "true" }));
    expect(result.fieldErrors?.name).toMatch(/already exists/);
    expect(result.error).toBeUndefined();
  });

  it("reports infrastructure failures honestly", async () => {
    vi.mocked(CategoryModel.create).mockRejectedValue(new Error("down") as never);
    const result = await createCategoryAction({ ok: false }, categoryForm({ isActive: "true" }));
    expect(result.error).toBe("The category could not be saved. Please try again.");
  });
});

describe("updateCategoryAction", () => {
  const EXISTING = { _id: CATEGORY_ID, name: "Sides", slug: "sides", isActive: true };

  function stubExisting(record: typeof EXISTING | null) {
    vi.mocked(CategoryModel.findById).mockReturnValue({ lean: async () => record } as never);
  }

  it("rejects malformed ids without database access", async () => {
    const result = await updateCategoryAction({ ok: false }, categoryForm({ isActive: "true" }));
    expect(result.error).toBe("That category could not be found.");
    expect(CategoryModel.findById).not.toHaveBeenCalled();
  });

  it("reports a missing category", async () => {
    stubExisting(null);
    const formData = categoryForm({ isActive: "true" });
    formData.set("id", CATEGORY_ID);
    const result = await updateCategoryAction({ ok: false }, formData);
    expect(result.error).toBe("That category could not be found.");
    expect(CategoryModel.updateOne).not.toHaveBeenCalled();
  });

  it("never rewrites the slug (public filter URLs stay stable)", async () => {
    stubExisting(EXISTING);
    const formData = categoryForm({ name: "Sides & Starters", slug: "", isActive: "true" });
    formData.set("id", CATEGORY_ID);

    await expect(updateCategoryAction({ ok: false }, formData)).rejects.toThrow(/NEXT_REDIRECT/);

    const [filter, update] = vi.mocked(CategoryModel.updateOne).mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(filter).toEqual({ _id: CATEGORY_ID });
    expect(update.$set).not.toContain("slug");
    expect(update.$set).toMatchObject({ name: "Sides & Starters", isActive: true });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ event: "category.updated" }));
    expect(redirect).toHaveBeenCalledWith("/admin/categories?saved=1");
  });

  it("audits a visibility flip with an explicit on/off detail", async () => {
    stubExisting(EXISTING);
    const formData = categoryForm({ name: "Sides", isActive: "" }); // unchecked → disabled
    formData.set("id", CATEGORY_ID);

    await expect(updateCategoryAction({ ok: false }, formData)).rejects.toThrow(/NEXT_REDIRECT/);

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "category.visibility_changed",
        detail: "Visibility on → off",
      }),
    );
  });

  it("rejects a name owned by another category but allows the current one", async () => {
    stubExisting(EXISTING);
    vi.mocked(CategoryModel.exists).mockResolvedValue({ _id: "other" } as never);
    const formData = categoryForm({ name: "Taken Name", isActive: "true" });
    formData.set("id", CATEGORY_ID);

    const result = await updateCategoryAction({ ok: false }, formData);
    expect(result.fieldErrors?.name).toMatch(/already exists/);
    expect(CategoryModel.updateOne).not.toHaveBeenCalled();

    const clashFilter = vi.mocked(CategoryModel.exists).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(clashFilter._id).toMatchObject({ $ne: CATEGORY_ID });
  });
});

describe("countProductsInCategory", () => {
  it("returns the live product count for confirmation copy", async () => {
    vi.mocked(ProductModel.countDocuments).mockResolvedValue(4 as never);
    await expect(countProductsInCategory(CATEGORY_ID)).resolves.toBe(4);
    expect(ProductModel.countDocuments).toHaveBeenCalledWith({ categoryId: CATEGORY_ID });
  });

  it("rejects malformed ids without database access", async () => {
    expect(await countProductsInCategory("nope")).toBeNull();
    expect(ProductModel.countDocuments).not.toHaveBeenCalled();
  });

  it("degrades to null when the database is unreachable", async () => {
    vi.mocked(ProductModel.countDocuments).mockRejectedValue(new Error("down") as never);
    expect(await countProductsInCategory(CATEGORY_ID)).toBeNull();
  });
});
