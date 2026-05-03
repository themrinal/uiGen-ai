import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockSet = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ set: mockSet, get: mockGet, delete: mockDelete })),
}));

const mockSign = vi.fn().mockResolvedValue("mock.jwt.token");
const mockSignJWT = vi.fn(() => ({
  setProtectedHeader: vi.fn().mockReturnThis(),
  setExpirationTime: vi.fn().mockReturnThis(),
  setIssuedAt: vi.fn().mockReturnThis(),
  sign: mockSign,
}));
const mockJwtVerify = vi.fn();

vi.mock("jose", () => ({
  SignJWT: mockSignJWT,
  jwtVerify: mockJwtVerify,
}));

import { createSession, getSession, deleteSession, verifySession } from "../auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockSign.mockResolvedValue("mock.jwt.token");
});

const COOKIE_NAME = "auth-token";

const fakePayload = {
  userId: "user-123",
  email: "test@example.com",
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

describe("createSession", () => {
  test("sets the cookie with the signed token", async () => {
    await createSession("user-123", "test@example.com");
    expect(mockSet).toHaveBeenCalledWith(
      COOKIE_NAME,
      "mock.jwt.token",
      expect.any(Object)
    );
  });

  test("sets httpOnly: true", async () => {
    await createSession("user-123", "test@example.com");
    const opts = mockSet.mock.calls[0][2];
    expect(opts.httpOnly).toBe(true);
  });

  test("sets sameSite: lax", async () => {
    await createSession("user-123", "test@example.com");
    const opts = mockSet.mock.calls[0][2];
    expect(opts.sameSite).toBe("lax");
  });

  test("sets secure: false outside production", async () => {
    const original = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = "test";
    await createSession("user-123", "test@example.com");
    const opts = mockSet.mock.calls[0][2];
    expect(opts.secure).toBe(false);
    (process.env as any).NODE_ENV = original;
  });

  test("sets secure: true in production", async () => {
    const original = process.env.NODE_ENV;
    (process.env as any).NODE_ENV = "production";
    await createSession("user-123", "test@example.com");
    const opts = mockSet.mock.calls[0][2];
    expect(opts.secure).toBe(true);
    (process.env as any).NODE_ENV = original;
  });

  test("sets expiry approximately 7 days from now", async () => {
    const before = Date.now();
    await createSession("user-123", "test@example.com");
    const after = Date.now();
    const opts = mockSet.mock.calls[0][2];
    const expiresMs = opts.expires.getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDays - 1000);
    expect(expiresMs).toBeLessThanOrEqual(after + sevenDays + 1000);
  });
});

describe("getSession", () => {
  test("returns null when no cookie is present", async () => {
    mockGet.mockReturnValue(undefined);
    const result = await getSession();
    expect(result).toBeNull();
  });

  test("returns null when jwtVerify throws", async () => {
    mockGet.mockReturnValue({ value: "bad.token" });
    mockJwtVerify.mockRejectedValue(new Error("invalid token"));
    const result = await getSession();
    expect(result).toBeNull();
  });

  test("returns the session payload when token is valid", async () => {
    mockGet.mockReturnValue({ value: "mock.jwt.token" });
    mockJwtVerify.mockResolvedValue({ payload: fakePayload });
    const result = await getSession();
    expect(result).toEqual(fakePayload);
  });
});

describe("deleteSession", () => {
  test("deletes the auth-token cookie", async () => {
    await deleteSession();
    expect(mockDelete).toHaveBeenCalledWith(COOKIE_NAME);
  });
});

describe("verifySession", () => {
  function makeRequest(cookieHeader?: string) {
    return new NextRequest("http://localhost/", {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
  }

  test("returns null when request has no auth-token cookie", async () => {
    const request = makeRequest();
    const result = await verifySession(request);
    expect(result).toBeNull();
  });

  test("returns null when jwtVerify throws", async () => {
    const request = makeRequest(`${COOKIE_NAME}=bad.token`);
    mockJwtVerify.mockRejectedValue(new Error("invalid token"));
    const result = await verifySession(request);
    expect(result).toBeNull();
  });

  test("returns the session payload when token is valid", async () => {
    const request = makeRequest(`${COOKIE_NAME}=mock.jwt.token`);
    mockJwtVerify.mockResolvedValue({ payload: fakePayload });
    const result = await verifySession(request);
    expect(result).toEqual(fakePayload);
  });
});
