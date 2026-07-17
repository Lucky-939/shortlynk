"use client";

import Link from "next/link";
import { useAuth } from "./AuthProvider";

export default function NavBar() {
  const { user, logout } = useAuth();

  return (
    <header className="border-b border-border bg-surface sticky top-0 z-50">
      <nav className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        {/* Wordmark */}
        <Link
          href="/"
          className="font-display font-semibold text-lg text-text tracking-tight hover:text-accent transition-colors"
        >
          Short<span className="text-accent">Lynk</span>
        </Link>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                href="/dashboard"
                className="text-sm text-muted hover:text-text transition-colors"
              >
                Dashboard
              </Link>
              <button
                onClick={logout}
                className="text-sm px-3 py-1.5 border border-border text-muted hover:border-accent hover:text-text transition-colors"
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="text-sm text-text hover:text-accent transition-colors"
              >
                Sign in
              </Link>
              <Link
                href="/signup"
                className="text-sm px-3 py-1.5 bg-accent text-bg font-semibold hover:bg-accent-h transition-colors"
              >
                Sign up
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
