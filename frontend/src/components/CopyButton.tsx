"use client";

import { useState, useCallback } from "react";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

/**
 * CopyButton — copies `text` to clipboard and shows a brief "Copied!" state.
 * The confirmation resets after 2 seconds. Uses the Clipboard API with a
 * graceful fallback for older browsers.
 */
export default function CopyButton({ text, label = "Copy", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that block clipboard in non-secure contexts
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        // silently fail — can't copy
      }
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      aria-label={copied ? "Copied!" : `Copy ${label}`}
      data-testid="copy-button"
      className={`text-xs px-2 py-1 border transition-colors ${
        copied
          ? "border-success text-success"
          : "border-border text-muted hover:border-accent hover:text-accent"
      } ${className}`}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
