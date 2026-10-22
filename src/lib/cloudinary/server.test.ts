import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CloudinaryNotConfiguredError,
  MAX_IMAGE_BYTES,
  UPLOAD_FOLDER,
  destroyAsset,
  isUploadConfigured,
  signUpload,
  verifyUploadedAsset,
} from "./server";

const ENV = {
  CLOUDINARY_CLOUD_NAME: "pearl-test",
  CLOUDINARY_API_KEY: "test-api-key",
  CLOUDINARY_API_SECRET: "test-api-secret",
};

function stubEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const VALID_RESOURCE = {
  public_id: `${UPLOAD_FOLDER}/jollof-abc123`,
  folder: UPLOAD_FOLDER,
  format: "jpg",
  bytes: 512_000,
  width: 1200,
  height: 900,
  secure_url: `https://res.cloudinary.com/pearl-test/image/upload/${UPLOAD_FOLDER}/jollof-abc123.jpg`,
  type: "upload",
  resource_type: "image",
};

beforeEach(() => {
  stubEnv(ENV);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isUploadConfigured", () => {
  it("requires cloud name, API key AND secret", () => {
    expect(isUploadConfigured()).toBe(true);
    stubEnv({ CLOUDINARY_API_SECRET: undefined });
    expect(isUploadConfigured()).toBe(false);
    stubEnv({ CLOUDINARY_API_SECRET: "s", CLOUDINARY_API_KEY: undefined });
    expect(isUploadConfigured()).toBe(false);
  });
});

describe("signUpload", () => {
  it("signs server-fixed parameters with SHA-256 over the API secret", () => {
    const now = 1_760_000_000_000;
    const signed = signUpload(now);

    expect(signed.cloudName).toBe("pearl-test");
    expect(signed.apiKey).toBe("test-api-key");
    expect(signed.folder).toBe(UPLOAD_FOLDER);
    expect(signed.timestamp).toBe(Math.floor(now / 1000));
    expect(signed.signatureAlgorithm).toBe("sha256");
    expect(signed.uploadUrl).toBe("https://api.cloudinary.com/v1_1/pearl-test/image/upload");

    // Recompute the signature independently: sorted "k=v&" + secret.
    const signable = [
      `folder=${UPLOAD_FOLDER}`,
      "overwrite=false",
      `timestamp=${signed.timestamp}`,
      "unique_filename=true",
    ].join("&");
    const expected = createHash("sha256")
      .update(signable + ENV.CLOUDINARY_API_SECRET, "utf8")
      .digest("hex");
    expect(signed.signature).toBe(expected);
    // The secret must never appear in anything the browser receives.
    expect(JSON.stringify(signed)).not.toContain(ENV.CLOUDINARY_API_SECRET);
  });

  it("throws the typed error when configuration is missing", () => {
    stubEnv({ CLOUDINARY_API_SECRET: undefined });
    expect(() => signUpload()).toThrow(CloudinaryNotConfiguredError);
  });
});

describe("verifyUploadedAsset (authoritative server-side check)", () => {
  it("accepts a valid in-folder image and returns canonical metadata", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, VALID_RESOURCE));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyUploadedAsset(`${UPLOAD_FOLDER}/jollof-abc123`);
    expect(result).toEqual({
      publicId: VALID_RESOURCE.public_id,
      secureUrl: VALID_RESOURCE.secure_url,
      format: "jpg",
      bytes: VALID_RESOURCE.bytes,
      width: 1200,
      height: 900,
    });
    // The Admin API call is authenticated server-side, never via the browser.
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toContain(`/resources/image/upload/${encodeURIComponent(VALID_RESOURCE.public_id)}`);
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(init.headers.Authorization).not.toContain("test-api-secret"); // base64 only
  });

  it("reports missing assets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { error: { message: "Not found" } })));
    expect(await verifyUploadedAsset("pearl-signature/products/ghost")).toBe("not_found");
  });

  it("rejects assets outside the controlled folder", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ...VALID_RESOURCE, folder: "other-app/uploads", public_id: "other-app/uploads/x" })));
    expect(await verifyUploadedAsset("other-app/uploads/x")).toBe("wrong_folder");
  });

  it("rejects formats outside the image allowlist", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ...VALID_RESOURCE, format: "gif" })));
    expect(await verifyUploadedAsset(`${UPLOAD_FOLDER}/x`)).toBe("invalid_type");
  });

  it("rejects oversized files", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ...VALID_RESOURCE, bytes: MAX_IMAGE_BYTES + 1 })));
    expect(await verifyUploadedAsset(`${UPLOAD_FOLDER}/x`)).toBe("too_large");
  });

  it("rejects implausible dimensions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { ...VALID_RESOURCE, width: 0 })));
    expect(await verifyUploadedAsset(`${UPLOAD_FOLDER}/x`)).toBe("bad_dimensions");
  });

  it("rejects delivery URLs pointing at a foreign host or cloud", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { ...VALID_RESOURCE, secure_url: "https://evil.example/img.jpg" })),
    );
    expect(await verifyUploadedAsset(`${UPLOAD_FOLDER}/x`)).toBe("invalid_type");
  });

  it("reports network trouble without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await verifyUploadedAsset(`${UPLOAD_FOLDER}/x`)).toBe("network");
  });

  it("reports missing configuration", async () => {
    stubEnv({ CLOUDINARY_API_KEY: undefined });
    expect(await verifyUploadedAsset(`${UPLOAD_FOLDER}/x`)).toBe("not_configured");
  });
});

describe("destroyAsset", () => {
  it("deletes via the Admin API and treats 404 as already clean", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { result: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await destroyAsset(`${UPLOAD_FOLDER}/x`)).toBe(true);

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(404, { error: { message: "gone" } })));
    expect(await destroyAsset(`${UPLOAD_FOLDER}/x`)).toBe(true);
  });

  it("returns false on failure so callers can reconcile later", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await destroyAsset(`${UPLOAD_FOLDER}/x`)).toBe(false);
  });

  it("returns false when not configured", async () => {
    stubEnv({ CLOUDINARY_API_SECRET: undefined });
    expect(await destroyAsset(`${UPLOAD_FOLDER}/x`)).toBe(false);
  });
});
