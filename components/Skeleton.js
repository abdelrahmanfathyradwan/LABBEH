export function CardSkeleton() {
  return (
    <div className="skeleton-card" aria-hidden="true">
      <span className="skeleton skeleton-img" />
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-line short" />
    </div>
  );
}

export function StoreSkeleton() {
  return (
    <div className="skeleton-store" aria-hidden="true">
      <span className="skeleton skeleton-img" />
      <span className="skeleton skeleton-line" />
      <span className="skeleton skeleton-line short" />
    </div>
  );
}

export function ListSkeleton({ rows = 3 }) {
  return (
    <div className="skeleton-list" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div className="skeleton-row" key={i}>
          <span className="skeleton skeleton-avatar" />
          <div>
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line short" />
          </div>
        </div>
      ))}
    </div>
  );
}
