export function PageTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="pt-8 pb-5">
      <h1 className="text-4xl leading-tight font-medium tracking-tight text-balance">{title}</h1>
      {children ? <div className="mt-3 max-w-[62ch] text-muted-foreground">{children}</div> : null}
    </header>
  );
}
