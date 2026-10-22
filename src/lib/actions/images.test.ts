import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/models/product", () => ({
  ProductModel: { findById: vi.fn(), updateOne: vi.fn(), exists: vi.fn() },
}));

// Real constants (folder, size cap) with only the network-bound functions mocked.
vi.mock("@/lib/cloudinary/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cloudinary/server")>();
  return {
    ...actual,
    isUploadConfigured: vi.fn(() => true),
    signUpload: vi.fn(),
    verifyUploadedAsset: vi.fn(),
    destroyAsset: vi.fn(async () => true),
  };
});

import { recordAudit } from "@/lib/auth/audit";
import { requireActionAdmin } from "@/lib/auth/guard";
import { invalidateCatalogue } from "@/lib/server/invalidate";
import {
  UPLOAD_FOLDER,
  isUploadConfigured,
  signUpload,
  destroyAsset,
  verifyUploadedAsset,
} from "@/lib/cloudinary/server";
import { ProductModel } from "@/models/product";
import {
  attachImageAction,
  removeImageAction,
  requestUploadSignatureAction,
  saveImagesAction,
} from "./images";

const OWNER = { _id: "64b0f00000000000000000aa", email: "owner@example.com", role: "owner", status: "active" };
const PRODUCT_ID = "507f1f77bcf86cd799439022";
const PUBLIC_ID = `${UPLOAD_FOLDER}/jollof-abc123`;

const VERIFIED = {
  publicId: PUBLIC_ID,
  secureUrl: `https://res.cloudinary.com/pearl-test/image/upload/${PUBLIC_ID}.jpg`,
  format: "jpg",
  bytes: 400_000,
  width: 1200,
  height: 900,
};

/** Query stand-in: `.lean()` and `.select(fields).lean()` resolve `main`,
 *  or `imagesProjection` when the projection asks for `images`. */
function projectionQuery(
  main: Record<string, unknown> | null,
  imagesProjection: Record<string, unknown> | null = null,
) {
  return {
    lean: async () => main,
    select: (fields: Record<string, unknown>) => ({
      lean: async () => ("images" in fields && imagesProjection ? imagesProjection : main),
    }),
  } as never;
}

function updateResult(matchedCount: number) {
  return { matchedCount, exec: async () => ({ matchedCount }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireActionAdmin).mockResolvedValue({ ok: true, admin: OWNER } as never);
  vi.mocked(isUploadConfigured).mockReturnValue(true);
  vi.mocked(destroyAsset).mockResolvedValue(true as never);
  vi.mocked(ProductModel.findById).mockReturnValue(projectionQuery(null));
  vi.mocked(ProductModel.exists).mockResolvedValue(null as never);
  vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(1) as never);
});

describe("requestUploadSignatureAction", () => {
  it("refuses to sign without a live session", async () => {
    vi.mocked(requireActionAdmin).mockResolvedValue({ ok: false, reason: "unauthorized" } as never);
    const result = await requestUploadSignatureAction();
    expect(result).toEqual({ ok: false, error: "Your session has expired. Please sign in again." });
    expect(signUpload).not.toHaveBeenCalled();
  });

  it("reports the not-configured state instead of throwing", async () => {
    vi.mocked(isUploadConfigured).mockReturnValue(false);
    const result = await requestUploadSignatureAction();
    expect(result).toEqual({
      ok: false,
      error: "Image uploads are not configured on this deployment yet.",
    });
  });

  it("returns the server-issued signature on success", async () => {
    const signature = { cloudName: "pearl-test", signature: "abc", timestamp: 1 };
    vi.mocked(signUpload).mockReturnValue(signature as never);
    const result = await requestUploadSignatureAction();
    expect(result).toEqual({ ok: true, signature });
    expect(signUpload).toHaveBeenCalledTimes(1);
  });
});

describe("attachImageAction", () => {
  function attachForm(overrides: Record<string, string> = {}): FormData {
    const formData = new FormData();
    formData.set("productId", overrides.productId ?? PRODUCT_ID);
    formData.set("publicId", overrides.publicId ?? PUBLIC_ID);
    formData.set("alt", overrides.alt ?? "Bowl of jollof rice");
    return formData;
  }

  it("refuses without a session before any verification work", async () => {
    vi.mocked(requireActionAdmin).mockResolvedValue({ ok: false, reason: "unauthorized" } as never);
    const result = await attachImageAction(attachForm());
    expect(result.ok).toBe(false);
    expect(verifyUploadedAsset).not.toHaveBeenCalled();
  });

  it("rejects malformed product ids and public ids", async () => {
    const badProduct = await attachImageAction(attachForm({ productId: "nope" }));
    expect(badProduct.error).toBe("That product could not be found.");

    const badPublicId = await attachImageAction(attachForm({ publicId: "Not Valid!" }));
    expect(badPublicId.fieldErrors?.alt).toMatch(/could not be verified/);
    expect(verifyUploadedAsset).not.toHaveBeenCalled();
  });

  it("requires alt text", async () => {
    const result = await attachImageAction(attachForm({ alt: "   " }));
    expect(result.fieldErrors?.alt).toBe("Alt text is required");
    expect(verifyUploadedAsset).not.toHaveBeenCalled();
  });

  it("attaches ONLY after server-side verification succeeds", async () => {
    vi.mocked(verifyUploadedAsset).mockResolvedValue(VERIFIED as never);
    vi.mocked(ProductModel.findById)
      .mockReturnValueOnce(projectionQuery({ _id: PRODUCT_ID, name: "Jollof Rice" }))
      .mockReturnValueOnce(
        projectionQuery(null, { images: [{ ...VERIFIED, alt: "Bowl of jollof rice", sortOrder: 9999 }] }),
      );

    const result = await attachImageAction(attachForm());
    expect(result).toEqual({ ok: true });

    // Verification happened first, and the stored DTO comes from THAT data.
    expect(verifyUploadedAsset).toHaveBeenCalledWith(PUBLIC_ID);
    const [filter, update] = vi.mocked(ProductModel.updateOne).mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $push: { images: Record<string, unknown> } },
    ];
    expect(filter).toHaveProperty("$expr"); // atomic 10-image cap
    expect(update.$push.images).toMatchObject({
      publicId: PUBLIC_ID,
      secureUrl: VERIFIED.secureUrl,
      alt: "Bowl of jollof rice",
      width: 1200,
      height: 900,
    });

    // sortOrder is renumbered from the pushed 9999 to its array position.
    const normalise = vi.mocked(ProductModel.updateOne).mock.calls[1] as unknown as [
      unknown,
      { $set: { images: Array<{ sortOrder: number }> } },
    ];
    expect(normalise[1].$set.images[0].sortOrder).toBe(0);

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ event: "image.attached" }));
    expect(invalidateCatalogue).toHaveBeenCalled();
  });

  it("cleans up an invalid asset when nothing references it", async () => {
    vi.mocked(verifyUploadedAsset).mockResolvedValue("wrong_folder" as never);

    const result = await attachImageAction(attachForm());
    expect(result.error).toBe("That image is outside the allowed upload area.");
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
    expect(destroyAsset).toHaveBeenCalledWith(PUBLIC_ID);
  });

  it("does NOT destroy an asset that another product already references", async () => {
    vi.mocked(verifyUploadedAsset).mockResolvedValue("invalid_type" as never);
    vi.mocked(ProductModel.exists).mockResolvedValue({ _id: "other" } as never);

    const result = await attachImageAction(attachForm());
    expect(result.error).toBe("Upload a JPEG, PNG or WebP image.");
    expect(destroyAsset).not.toHaveBeenCalled();
  });

  it("never destroys anything when the upload simply was not found", async () => {
    vi.mocked(verifyUploadedAsset).mockResolvedValue("not_found" as never);
    const result = await attachImageAction(attachForm());
    expect(result.error).toMatch(/could not be found on the image service/);
    expect(destroyAsset).not.toHaveBeenCalled();
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });

  it("enforces the 10-image ceiling and cleans up the surplus upload", async () => {
    vi.mocked(verifyUploadedAsset).mockResolvedValue(VERIFIED as never);
    vi.mocked(ProductModel.findById).mockReturnValue(
      projectionQuery({ _id: PRODUCT_ID, name: "Jollof Rice" }),
    );
    vi.mocked(ProductModel.updateOne).mockReturnValue(updateResult(0) as never); // cap reached

    const result = await attachImageAction(attachForm());
    expect(result.error).toMatch(/maximum of 10 images/);
    expect(destroyAsset).toHaveBeenCalledWith(PUBLIC_ID);
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("reports a missing product after verification", async () => {
    vi.mocked(verifyUploadedAsset).mockResolvedValue(VERIFIED as never);
    vi.mocked(ProductModel.findById).mockReturnValue(projectionQuery(null));
    const result = await attachImageAction(attachForm());
    expect(result.error).toBe("That product could not be found.");
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });
});

describe("saveImagesAction (permutation-only)", () => {
  const STORED = [
    { secureUrl: "https://res.example/a.jpg", publicId: `${UPLOAD_FOLDER}/a`, alt: "Alt A", sortOrder: 0, width: 800, height: 600 },
    { secureUrl: "https://res.example/b.jpg", publicId: `${UPLOAD_FOLDER}/b`, alt: "Alt B", sortOrder: 1, width: 900, height: 700 },
  ];

  function saveForm(entries: Array<{ publicId: string; alt: string }>): FormData {
    const formData = new FormData();
    formData.set("productId", PRODUCT_ID);
    for (const entry of entries) formData.append("publicId", entry.publicId);
    for (const entry of entries) formData.append("alt", entry.alt);
    return formData;
  }

  function stubProduct(images: typeof STORED | null) {
    vi.mocked(ProductModel.findById).mockReturnValue(
      images === null
        ? projectionQuery(null)
        : projectionQuery({ _id: PRODUCT_ID, name: "Jollof Rice", images }),
    );
  }

  it("rejects mismatched field counts", async () => {
    const formData = new FormData();
    formData.set("productId", PRODUCT_ID);
    formData.append("publicId", `${UPLOAD_FOLDER}/a`);
    const result = await saveImagesAction(formData);
    expect(result.error).toMatch(/could not be saved/);
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });

  it("requires alt text on every entry", async () => {
    const result = await saveImagesAction(
      saveForm([{ publicId: `${UPLOAD_FOLDER}/a`, alt: "" }]),
    );
    expect(result.fieldErrors?.alt).toBe("Alt text is required");
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });

  it("refuses a submitted set that differs from the stored set", async () => {
    stubProduct(STORED);
    const result = await saveImagesAction(
      saveForm([
        { publicId: `${UPLOAD_FOLDER}/a`, alt: "Alt A" },
        { publicId: `${UPLOAD_FOLDER}/smuggled`, alt: "Alt S" },
      ]),
    );
    expect(result.error).toMatch(/changed elsewhere/);
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });

  it("saves reorder + alt edits using only stored metadata", async () => {
    stubProduct(STORED);
    const result = await saveImagesAction(
      saveForm([
        { publicId: `${UPLOAD_FOLDER}/b`, alt: "New B" },
        { publicId: `${UPLOAD_FOLDER}/a`, alt: "New A" },
      ]),
    );
    expect(result).toEqual({ ok: true });

    const update = vi.mocked(ProductModel.updateOne).mock.calls[0] as unknown as [
      unknown,
      { $set: { images: Array<Record<string, unknown>> } },
    ];
    const images = update[1].$set.images;
    expect(images).toHaveLength(2);
    expect(images[0]).toMatchObject({
      publicId: `${UPLOAD_FOLDER}/b`,
      alt: "New B",
      sortOrder: 0,
      secureUrl: "https://res.example/b.jpg", // preserved from storage, not the client
      width: 900,
    });
    expect(images[1]).toMatchObject({ publicId: `${UPLOAD_FOLDER}/a`, alt: "New A", sortOrder: 1 });

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({ event: "image.updated" }));
    expect(invalidateCatalogue).toHaveBeenCalled();
  });

  it("handles an empty list (all images removed via the list form)", async () => {
    stubProduct([]);
    const result = await saveImagesAction(saveForm([]));
    expect(result).toEqual({ ok: true });
  });
});

describe("removeImageAction", () => {
  function removeForm(overrides: Record<string, string> = {}): FormData {
    const formData = new FormData();
    formData.set("productId", overrides.productId ?? PRODUCT_ID);
    formData.set("publicId", overrides.publicId ?? PUBLIC_ID);
    return formData;
  }

  it("rejects malformed input without database access", async () => {
    const bad = await removeImageAction(removeForm({ productId: "nope" }));
    expect(bad.error).toBe("That image could not be found.");

    const empty = await removeImageAction(removeForm({ publicId: "" }));
    expect(empty.error).toBe("That image could not be found.");
    expect(ProductModel.findById).not.toHaveBeenCalled();
  });

  it("detaches and destroys an orphaned asset", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(
      projectionQuery({ _id: PRODUCT_ID, name: "Jollof Rice", images: [{ publicId: PUBLIC_ID }] }),
    );
    vi.mocked(ProductModel.exists).mockResolvedValue(null as never); // no other references

    const result = await removeImageAction(removeForm());
    expect(result).toEqual({ ok: true });

    const update = vi.mocked(ProductModel.updateOne).mock.calls[0] as unknown as [
      unknown,
      { $pull: { images: { publicId: string } } },
    ];
    expect(update[1].$pull.images).toEqual({ publicId: PUBLIC_ID });
    expect(destroyAsset).toHaveBeenCalledWith(PUBLIC_ID);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "image.removed", detail: "Detached and asset deleted" }),
    );
    expect(invalidateCatalogue).toHaveBeenCalled();
  });

  it("keeps an asset that is still referenced by another product", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(
      projectionQuery({ _id: PRODUCT_ID, name: "Jollof Rice", images: [{ publicId: PUBLIC_ID }] }),
    );
    vi.mocked(ProductModel.exists).mockResolvedValue({ _id: "other" } as never);

    const result = await removeImageAction(removeForm());
    expect(result).toEqual({ ok: true });
    expect(destroyAsset).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "Detached; asset kept (referenced elsewhere)" }),
    );
  });

  it("defers cleanup honestly when the destroy call fails", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(
      projectionQuery({ _id: PRODUCT_ID, name: "Jollof Rice", images: [{ publicId: PUBLIC_ID }] }),
    );
    vi.mocked(ProductModel.exists).mockResolvedValue(null as never);
    vi.mocked(destroyAsset).mockResolvedValue(false as never);

    const result = await removeImageAction(removeForm());
    expect(result).toEqual({ ok: true });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ detail: "Detached; asset cleanup deferred (no other references)" }),
    );
  });

  it("reports a missing product", async () => {
    vi.mocked(ProductModel.findById).mockReturnValue(projectionQuery(null));
    const result = await removeImageAction(removeForm());
    expect(result.error).toBe("That product could not be found.");
    expect(ProductModel.updateOne).not.toHaveBeenCalled();
  });
});
