import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentAdmin: vi.fn(),
  getSessionAdminFromCookies: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    (error as Error & { digest: string }).digest = `NEXT_REDIRECT;${url}`;
    throw error;
  }),
}));

import { redirect } from "next/navigation";
import { getCurrentAdmin, getSessionAdminFromCookies } from "@/lib/auth/session";
import { requireActionAdmin, requirePageAdmin } from "./guard";

const OWNER = { _id: "64b0f00000000000000000aa", email: "owner@example.com", role: "owner", status: "active" };
const STAFF = { _id: "64b0f00000000000000000bb", email: "staff@example.com", role: "staff", status: "active" };
const DISABLED = { _id: "64b0f00000000000000000cc", email: "gone@example.com", role: "owner", status: "disabled" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requireActionAdmin (mutation guard)", () => {
  it("authorises an active owner session", async () => {
    vi.mocked(getSessionAdminFromCookies).mockResolvedValue(OWNER as never);
    const result = await requireActionAdmin();
    expect(result).toEqual({ ok: true, admin: OWNER });
  });

  it("rejects anonymous requests", async () => {
    vi.mocked(getSessionAdminFromCookies).mockResolvedValue(null);
    expect(await requireActionAdmin()).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("rejects staff and disabled accounts", async () => {
    vi.mocked(getSessionAdminFromCookies).mockResolvedValue(STAFF as never);
    expect(await requireActionAdmin()).toEqual({ ok: false, reason: "unauthorized" });

    vi.mocked(getSessionAdminFromCookies).mockResolvedValue(DISABLED as never);
    expect(await requireActionAdmin()).toEqual({ ok: false, reason: "unauthorized" });
  });
});

describe("requirePageAdmin (layout guard)", () => {
  it("returns the owner for a valid session", async () => {
    vi.mocked(getCurrentAdmin).mockResolvedValue(OWNER as never);
    await expect(requirePageAdmin()).resolves.toEqual(OWNER);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects anonymous visitors to the login screen", async () => {
    vi.mocked(getCurrentAdmin).mockResolvedValue(null);
    await expect(requirePageAdmin()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(redirect).toHaveBeenCalledWith("/admin/login");
  });

  it("redirects non-owner roles", async () => {
    vi.mocked(getCurrentAdmin).mockResolvedValue(STAFF as never);
    await expect(requirePageAdmin()).rejects.toThrow(/NEXT_REDIRECT/);
  });
});
