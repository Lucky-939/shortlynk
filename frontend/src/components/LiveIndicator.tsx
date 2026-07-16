/**
 * LiveIndicator — a slow-pulsing dot that signals live polling is active.
 * Deliberately subtle: one small element, not a banner.
 */
export default function LiveIndicator() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      title="Updating every 5 seconds"
    >
      <span
        className="inline-block w-1.5 h-1.5 bg-accent rounded-full animate-pulse"
        style={{ animationDuration: "2s" }}
        aria-hidden="true"
      />
      Live
    </span>
  );
}
