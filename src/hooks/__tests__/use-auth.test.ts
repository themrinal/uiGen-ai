import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAuth } from "../use-auth";
import * as actions from "@/actions";
import * as getProjectsAction from "@/actions/get-projects";
import * as createProjectAction from "@/actions/create-project";
import * as anonTracker from "@/lib/anon-work-tracker";

const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/actions", () => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock("@/actions/get-projects", () => ({
  getProjects: vi.fn(),
}));

vi.mock("@/actions/create-project", () => ({
  createProject: vi.fn(),
}));

vi.mock("@/lib/anon-work-tracker", () => ({
  getAnonWorkData: vi.fn(),
  clearAnonWork: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  (anonTracker.getAnonWorkData as any).mockReturnValue(null);
  (getProjectsAction.getProjects as any).mockResolvedValue([]);
  (createProjectAction.createProject as any).mockResolvedValue({ id: "new-project-id" });
});

describe("useAuth", () => {
  describe("signIn", () => {
    test("returns isLoading false initially", () => {
      const { result } = renderHook(() => useAuth());
      expect(result.current.isLoading).toBe(false);
    });

    test("sets isLoading true while signing in", async () => {
      (actions.signIn as any).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 50))
      );

      const { result } = renderHook(() => useAuth());

      act(() => {
        result.current.signIn("test@example.com", "password");
      });

      expect(result.current.isLoading).toBe(true);
    });

    test("sets isLoading false after signIn resolves", async () => {
      (actions.signIn as any).mockResolvedValue({ success: false, error: "Invalid credentials" });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("test@example.com", "wrong");
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("returns the result from signInAction", async () => {
      (actions.signIn as any).mockResolvedValue({ success: false, error: "Invalid credentials" });

      const { result } = renderHook(() => useAuth());

      let returnValue: any;
      await act(async () => {
        returnValue = await result.current.signIn("test@example.com", "wrong");
      });

      expect(returnValue).toEqual({ success: false, error: "Invalid credentials" });
    });

    test("calls signInAction with correct credentials", async () => {
      (actions.signIn as any).mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "secret");
      });

      expect(actions.signIn).toHaveBeenCalledWith("user@example.com", "secret");
    });

    test("does not redirect when signIn fails", async () => {
      (actions.signIn as any).mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("test@example.com", "wrong");
      });

      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe("signUp", () => {
    test("calls signUpAction with correct credentials", async () => {
      (actions.signUp as any).mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("new@example.com", "password123");
      });

      expect(actions.signUp).toHaveBeenCalledWith("new@example.com", "password123");
    });

    test("sets isLoading false after signUp resolves", async () => {
      (actions.signUp as any).mockResolvedValue({ success: false });

      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signUp("new@example.com", "password123");
      });

      expect(result.current.isLoading).toBe(false);
    });

    test("returns the result from signUpAction", async () => {
      (actions.signUp as any).mockResolvedValue({ success: false, error: "Email taken" });

      const { result } = renderHook(() => useAuth());

      let returnValue: any;
      await act(async () => {
        returnValue = await result.current.signUp("taken@example.com", "pass");
      });

      expect(returnValue).toEqual({ success: false, error: "Email taken" });
    });
  });

  describe("handlePostSignIn — anonymous work exists", () => {
    beforeEach(() => {
      (anonTracker.getAnonWorkData as any).mockReturnValue({
        messages: [{ id: "1", role: "user", content: "Hello" }],
        fileSystemData: { "/App.jsx": { type: "file", content: "..." } },
      });
      (createProjectAction.createProject as any).mockResolvedValue({ id: "saved-anon-project" });
      (actions.signIn as any).mockResolvedValue({ success: true });
    });

    test("creates a project with anonymous work data", async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass");
      });

      expect(createProjectAction.createProject).toHaveBeenCalledWith({
        name: expect.stringContaining("Design from"),
        messages: [{ id: "1", role: "user", content: "Hello" }],
        data: { "/App.jsx": { type: "file", content: "..." } },
      });
    });

    test("clears anonymous work after saving", async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass");
      });

      expect(anonTracker.clearAnonWork).toHaveBeenCalled();
    });

    test("redirects to the saved anon project", async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass");
      });

      expect(mockPush).toHaveBeenCalledWith("/saved-anon-project");
    });

    test("does not fetch existing projects when anon work exists", async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass");
      });

      expect(getProjectsAction.getProjects).not.toHaveBeenCalled();
    });
  });

  describe("handlePostSignIn — no anonymous work, existing projects", () => {
    beforeEach(() => {
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue([
        { id: "project-1" },
        { id: "project-2" },
      ]);
      (actions.signIn as any).mockResolvedValue({ success: true });
    });

    test("redirects to the most recent project", async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass");
      });

      expect(mockPush).toHaveBeenCalledWith("/project-1");
    });

    test("does not create a new project", async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass");
      });

      expect(createProjectAction.createProject).not.toHaveBeenCalled();
    });
  });

  describe("handlePostSignIn — no anonymous work, no existing projects", () => {
    beforeEach(() => {
      (anonTracker.getAnonWorkData as any).mockReturnValue(null);
      (getProjectsAction.getProjects as any).mockResolvedValue([]);
      (createProjectAction.createProject as any).mockResolvedValue({ id: "brand-new-project" });
      (actions.signIn as any).mockResolvedValue({ success: true });
    });

    test("creates a new project", async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass");
      });

      expect(createProjectAction.createProject).toHaveBeenCalledWith({
        name: expect.stringMatching(/^New Design #\d+$/),
        messages: [],
        data: {},
      });
    });

    test("redirects to the newly created project", async () => {
      const { result } = renderHook(() => useAuth());

      await act(async () => {
        await result.current.signIn("user@example.com", "pass");
      });

      expect(mockPush).toHaveBeenCalledWith("/brand-new-project");
    });
  });
});
