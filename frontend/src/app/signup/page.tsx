"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signup as apiSignup, ApiError } from "@/lib/api";
import NavBar from "@/components/NavBar";

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      await apiSignup({ email, password });
      // Redirect to login — user signs in immediately after signup
      router.push("/login?message=account-created");
    } catch (err) {
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
        <h1 className="font-display text-3xl font-semibold text-text mb-2">Create account</h1>
        <p className="text-muted text-sm mb-8">
          Already have one?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
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
              Password <span className="normal-case text-muted/70">(min 8 chars)</span>
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
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
            {loading ? "Creating account…" : "Create account →"}
          </button>
        </form>
      </main>
    </>
  );
}
