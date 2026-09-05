'use client';

export default function RniError({ reset }: Readonly<{ reset: () => void }>) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8" data-rni-read-state="error">
      <p className="text-sm">Retail Narrative Intelligence</p>
      <h1 className="text-3xl font-semibold">RNI could not load</h1>
      <p role="alert">The verified RNI view failed unexpectedly.</p>
      <button className="rounded border border-slate-700 px-3 py-2" onClick={reset} type="button">
        Retry
      </button>
    </main>
  );
}
