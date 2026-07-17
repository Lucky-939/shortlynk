"use client";

import { useState, type FormEvent } from "react";
import { shortenUrl, ApiError } from "@/lib/api";
import { useAuth } from "./AuthProvider";
import { useRouter } from "next/navigation";

interface ShortenFormProps {
  /** Called with the result on success — lets parent refresh its link list */
  onSuccess?: (shortCode: string, shortUrl: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
}

/**
 * ShortenForm — reusable URL input used on both the landing page and dashboard.
 * If no token is present, redirects to /login with a friendly message param.
 */
export default function ShortenForm({
  onSuccess,
  placeholder = "https://example.com/your-long-url",
}: ShortenFormProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ shortCode: string; shortUrl: string } | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    const trimmed = url.trim();
    if (!trimmed) return;

    // Not logged in → redirect to login with friendly message
    if (!user) {
      router.push("/login?message=sign-in-to-shorten");
      return;
    }

    setLoading(true);
    try {
      const res = await shortenUrl({ longUrl: trimmed }, user.token);
      setResult({ shortCode: res.shortCode, shortUrl: res.shortUrl });
      setUrl("");
      onSuccess?.(res.shortCode, res.shortUrl);
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
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-0">
        <input
          id="shorten-input"
          type="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(null); setResult(null); }}
          placeholder={placeholder}
          required
          className="flex-1 bg-surface border border-border sm:border-r-0 px-4 py-3 text-text text-sm font-mono placeholder:text-muted focus:outline-none focus:border-b-2 focus:border-b-accent focus:pb-[11px] transition-all"
          aria-label="Long URL to shorten"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-accent text-bg font-semibold text-sm px-5 py-3 hover:bg-accent-h transition-colors disabled:opacity-60 shrink-0"
        >
          {loading ? "…" : "Shorten"}
        </button>
      </form>

      {/* Error */}
      {error && (
        <p role="alert" className="mt-2 text-error text-xs font-mono">
          {error}
        </p>
      )}

      {/* Success result */}
      {result && (
        <div className="mt-3 flex items-center gap-3 border-l-[3px] border-l-accent pl-3 py-1">
          <span className="font-mono text-accent text-sm">{result.shortUrl}</span>
          <button
            onClick={() => navigator.clipboard.writeText(result.shortUrl)}
            className="text-xs text-muted hover:text-accent transition-colors border border-border px-2 py-0.5"
          >
            Copy
          </button>
        </div>
      )}
    </div>
  );
}
