"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { login as apiLogin, ApiError } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import NavBar from "@/components/NavBar";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Friendly message when redirected from landing page unauthenticated
  const redirectMessage = params.get("message") === "sign-in-to-shorten"
    ? "Sign in to shorten your first link."
    : null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await apiLogin({ email, password });
      login({ token: result.token, userId: result.userId, email: result.email });
      router.push("/dashboard");
    } catch (err) {
      // Surface the backend's message as-is — it's already generic and safe.
      // "Invalid credentials" is returned for both wrong password AND unknown email
      // to prevent account enumeration.
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <NavBar />
      <main className="max-w-sm mx-auto px-4 pt-20">
        {redirectMessage && (
          <div className="border-l-[3px] border-l-accent bg-surface pl-4 pr-4 py-3 mb-8 text-sm text-text">
            {redirectMessage}
          </div>
        )}

        <h1 className="font-display text-3xl font-semibold text-text mb-2">Sign in</h1>
        <p className="text-muted text-sm mb-8">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Sign up
          </Link>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="text-xs text-muted font-mono uppercase tracking-wider block mb-1.5">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-surface border border-border px-4 py-3 text-text text-sm font-mono placeholder:text-muted focus:outline-none focus:border-b-2 focus:border-b-accent focus:pb-[11px] transition-all"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="text-xs text-muted font-mono uppercase tracking-wider block mb-1.5">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full bg-surface border border-border px-4 py-3 text-text text-sm font-mono placeholder:text-muted focus:outline-none focus:border-b-2 focus:border-b-accent focus:pb-[11px] transition-all"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p role="alert" className="text-error text-xs font-mono border-l-[3px] border-l-error pl-3 py-1">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-bg font-semibold text-sm py-3 hover:bg-accent-h transition-colors disabled:opacity-60 mt-2"
          >
            {loading ? "Signing in…" : "Sign in →"}
          </button>
        </form>
      </main>
    </>
  );
}
