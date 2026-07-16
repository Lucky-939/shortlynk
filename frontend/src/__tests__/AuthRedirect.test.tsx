/**
 * AuthRedirect.test.tsx
 *
 * Tests the auth-redirect-when-no-token logic on the Dashboard page:
 *   - when useAuth returns no user and isLoading=false, router.replace('/login') is called
 *   - when isLoading=true (rehydrating localStorage), redirect does NOT fire yet
 *   - when a user IS present, no redirect occurs
 *
 * We mock next/navigation and the AuthProvider hook so these are pure unit
 * tests — no real routing or storage involved.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import DashboardPage from "@/app/dashboard/page";

// ── Mock next/navigation ──────────────────────────────────────────────────────

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
  useParams: () => ({}),
  useSearchParams: () => ({ get: () => null }),
}));

// ── Mock the AuthProvider hook ────────────────────────────────────────────────
// We control what useAuth() returns per test via mockReturnValue.

const mockUseAuth = jest.fn();

jest.mock("@/components/AuthProvider", () => ({
  // Keep AuthProvider itself as a passthrough for rendering
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}));

// ── Mock the API call — dashboard tries to fetch links if user is present ────

jest.mock("@/lib/api", () => ({
  getLinks: jest.fn().mockResolvedValue([]),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Dashboard — auth redirect logic", () => {
  it("redirects to /login when there is no user and auth is not loading", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      logout: jest.fn(),
      isLoading: false,
    });

    render(<DashboardPage />);

    // Should redirect immediately — no flash of dashboard content
    expect(mockReplace).toHaveBeenCalledWith("/login");
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("does NOT redirect while isLoading=true (auth still rehydrating from localStorage)", () => {
    // isLoading=true means we're still reading from localStorage —
    // redirecting here would cause a flash-redirect for users who ARE logged in.
    mockUseAuth.mockReturnValue({
      user: null,
      logout: jest.fn(),
      isLoading: true,
    });

    render(<DashboardPage />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("does NOT redirect when a user is present", async () => {
    mockUseAuth.mockReturnValue({
      user: { userId: "u1", email: "test@example.com", token: "fake.jwt.token" },
      logout: jest.fn(),
      isLoading: false,
    });

    render(<DashboardPage />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("calls router.replace with '/login' (not push) — replaces history so back button doesn't return to dashboard", () => {
    mockUseAuth.mockReturnValue({
      user: null,
      logout: jest.fn(),
      isLoading: false,
    });

    render(<DashboardPage />);

    // replace() is intentional — we don't want the browser's back button to
    // take an unauthenticated user back to a blank dashboard.
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });
});
