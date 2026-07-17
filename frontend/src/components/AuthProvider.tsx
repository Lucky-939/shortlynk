"use client";

/**
 * AuthProvider — JWT authentication context for ShortLynk.
 *
 * STORAGE DECISION — JWT in sessionStorage:
 * ─────────────────────────────────────────
 * A more secure approach would be httpOnly cookies: the browser never exposes
 * them to JavaScript, so XSS attacks cannot read the token. However, httpOnly
 * cookies require a server-side session layer that we don't have — this project
 * is a fully static Next.js export on Cloudflare Pages.
 *
 * We use sessionStorage (not localStorage) deliberately:
 *   - sessionStorage clears when the tab is closed or the browser restarts,
 *     which gives the "logged out after restart" behaviour users expect in dev.
 *   - localStorage would persist the JWT indefinitely, causing stale sessions
 *     when the worker KV state is wiped between dev restarts.
 *   - Both have the same XSS exposure; sessionStorage just has a shorter
 *     effective lifetime, reducing the blast radius of a stolen token.
 *
 * In a production app handling sensitive data, httpOnly cookies + a
 * /api/refresh endpoint would be the correct upgrade path.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AuthUser {
  userId: string;
  email: string;
  token: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  login: (user: AuthUser) => void;
  logout: () => void;
  isLoading: boolean;
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "shortlynk_auth";

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Rehydrate from sessionStorage on mount (client-only).
  // sessionStorage clears when the tab/browser closes, so restarting dev
  // servers gives a clean "logged out" state as expected.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AuthUser;
        // Basic sanity check — don't restore obviously corrupt data
        if (parsed.token && parsed.userId && parsed.email) {
          setUser(parsed);
        }
      }
    } catch {
      sessionStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback((authUser: AuthUser) => {
    setUser(authUser);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    } catch {
      // Private browsing may block sessionStorage — silently degrade to in-memory only
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
