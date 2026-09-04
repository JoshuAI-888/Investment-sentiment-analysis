/**
 * F02 §4.4 — the rendered half of an admin authorization failure. Not the check itself: every
 * admin page calls `requireAdmin()` directly in its own body (F02's non-negotiable) and only
 * reaches for this component in the `catch`.
 */
export function AdminDenied({ route }: { readonly route: string }) {
  return (
    <main data-route={route} className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">Not authorized</h1>
      <p className="mt-2 text-sm text-neutral-700">
        This address is signed in but is not on the admin allowlist.
      </p>
    </main>
  );
}
