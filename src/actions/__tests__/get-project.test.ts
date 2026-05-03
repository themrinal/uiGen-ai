import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn() })),
}));
vi.mock("jose", () => ({ SignJWT: vi.fn(), jwtVerify: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { project: { findFirst: vi.fn() } },
}));

import { getProject } from "../get-project";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const mockGetSession = vi.mocked(getSession);
const mockFindFirst = vi.mocked(prisma.project.findFirst);

beforeEach(() => vi.clearAllMocks());

const fakeSession = {
  userId: "user-1",
  email: "user@example.com",
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
};

const fakeProject = {
  id: "proj-1",
  name: "Test Project",
  messages: "[]",
  data: "{}",
  createdAt: new Date(),
  updatedAt: new Date(),
  userId: "user-1",
};

describe("getProject", () => {
  test("throws Unauthorized when no session", async () => {
    mockGetSession.mockResolvedValue(null);
    await expect(getProject("proj-1")).rejects.toThrow("Unauthorized");
  });

  test("calls findFirst (not findUnique) with id and userId", async () => {
    mockGetSession.mockResolvedValue(fakeSession);
    mockFindFirst.mockResolvedValue(fakeProject);
    await getProject("proj-1");
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: "proj-1", userId: "user-1" },
    });
  });

  test("throws Project not found when findFirst returns null", async () => {
    mockGetSession.mockResolvedValue(fakeSession);
    mockFindFirst.mockResolvedValue(null);
    await expect(getProject("proj-1")).rejects.toThrow("Project not found");
  });

  test("returns parsed project data on success", async () => {
    mockGetSession.mockResolvedValue(fakeSession);
    mockFindFirst.mockResolvedValue(fakeProject);
    const result = await getProject("proj-1");
    expect(result.id).toBe("proj-1");
    expect(result.messages).toEqual([]);
    expect(result.data).toEqual({});
  });
});
