interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

/**
 * ErrorState — a clear, retry-able error display.
 * Used when API calls fail (network error, 5xx, etc.).
 */
export default function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="border border-error border-l-[3px] border-l-error bg-surface pl-4 pr-4 py-5"
    >
      <p className="text-error text-sm font-mono mb-3">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-muted border border-border px-3 py-1.5 hover:border-accent hover:text-text transition-colors"
        >
          Try again
        </button>
      )}
    </div>
  );
}
