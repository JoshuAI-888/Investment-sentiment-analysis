export default function RniLoading() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8" data-rni-read-state="loading">
      <p className="text-sm">Retail Narrative Intelligence</p>
      <h1 className="text-3xl font-semibold">Loading RNI</h1>
      <p aria-live="polite" role="status">
        Loading a verified database snapshot…
      </p>
    </main>
  );
}
