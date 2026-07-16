/** Loading skeleton cards for the dashboard link list */
export function LinkCardSkeleton() {
  return (
    <div className="border border-border bg-surface pl-4 pr-4 py-4 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="h-4 w-24 bg-raised" />
          <div className="h-3 w-64 bg-raised" />
        </div>
        <div className="space-y-1 items-end flex flex-col">
          <div className="h-5 w-10 bg-raised" />
          <div className="h-3 w-16 bg-raised" />
        </div>
      </div>
    </div>
  );
}

/** Full-page loading skeleton for the dashboard */
export function DashboardSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <LinkCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Skeleton for the stats page */
export function StatsSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-16 w-40 bg-raised" />
      <div className="h-[180px] bg-raised" />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 bg-raised" />
        ))}
      </div>
    </div>
  );
}
