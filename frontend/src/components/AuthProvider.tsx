"use client";

/**
 * AuthProvider — JWT authentication context for ShortLynk.
 *
 * STORAGE DECISION — JWT in localStorage:
 * ─────────────────────────────────────────
 * A more secure approach would be httpOnly cookies: the browser never exposes
 * them to JavaScript, so XSS attacks cannot read the token. However, httpOnly
 * cookies require a server-side session layer (a cookie-setting API route or
 * BFF) that we deliberately don't have — this project is a fully static Next.js
 * export on Cloudflare Pages, with no server component or Node.js runtime.
 *
 * For this portfolio project demonstrating serverless/edge architecture,
 * client-stored JWT in localStorage is a reasonable and explained compromise:
 *   - The JWTs are short-lived (7 days, per auth-worker)
 *   - The app has no payment or PII beyond email — low blast radius
 *   - XSS risk is mitigated by the strict CSP Next.js sets and the absence of
 *     any user-generated rich content rendered as HTML
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

  // Rehydrate from localStorage on mount (client-only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AuthUser;
        // Basic sanity check — don't restore obviously corrupt data
        if (parsed.token && parsed.userId && parsed.email) {
          setUser(parsed);
        }
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback((authUser: AuthUser) => {
    setUser(authUser);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(authUser));
    } catch {
      // Private browsing may block localStorage — silently degrade to in-memory only
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
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
