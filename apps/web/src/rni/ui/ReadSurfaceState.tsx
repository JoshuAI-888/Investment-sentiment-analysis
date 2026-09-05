export type RniReadSurfaceState = 'empty' | 'error' | 'forbidden' | 'unavailable';

export function ReadSurfaceState({
  title,
  message,
  state,
}: Readonly<{ title: string; message: string; state: RniReadSurfaceState }>) {
  return (
    <main
      className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8"
      data-rni-read-state={state}
    >
      <p className="text-sm">Retail Narrative Intelligence</p>
      <h1 className="text-3xl font-semibold">{title}</h1>
      <p role={state === 'error' || state === 'forbidden' ? 'alert' : 'status'}>{message}</p>
      {state === 'error' || state === 'unavailable' ? (
        <a className="inline-block rounded border border-slate-700 px-3 py-2" href="">
          Retry
        </a>
      ) : null}
    </main>
  );
}
