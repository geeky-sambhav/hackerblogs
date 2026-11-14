/** Quiet placeholder while a page's content streams in. */
export function PageSkeleton() {
  return (
    <div aria-hidden className="animate-pulse pt-8 motion-reduce:animate-none">
      <div className="h-10 w-3/4 rounded bg-muted" />
      <div className="mt-4 h-4 w-1/3 rounded bg-muted" />
      <div className="mt-8 space-y-3">
        <div className="h-4 w-full rounded bg-muted" />
        <div className="h-4 w-5/6 rounded bg-muted" />
        <div className="h-4 w-2/3 rounded bg-muted" />
      </div>
    </div>
  );
}
