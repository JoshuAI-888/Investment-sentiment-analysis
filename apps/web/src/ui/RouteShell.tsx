/**
 * The fixture state every route renders until its feature lands (F01 §4.6).
 *
 * Route shells exist in F01 so the routing and layout problems — parallel routes, the
 * intercepted calculation drawer — surface in hour one rather than in Wave 4. The copy here
 * is deliberately plain: it says what is not built yet rather than showing a zero, because a
 * zero and "not built" look identical to a reader and only one of them is true.
 */
export type RouteShellProps = {
  readonly route: string;
  readonly title: string;
  readonly owner: string;
  readonly note?: string;
};

export function RouteShell({ route, title, owner, note }: RouteShellProps) {
  return (
    <main data-route={route} data-state="fixture" className="mx-auto max-w-3xl p-8">
      <p className="text-xs uppercase tracking-wide text-neutral-500">Fixture state</p>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      <p className="mt-1 font-mono text-sm text-neutral-600">{route}</p>
      <p className="mt-6 text-sm text-neutral-700">
        This route exists so its layout and routing behaviour are exercised from the first
        commit. It renders no data yet.
      </p>
      {note === undefined ? null : <p className="mt-2 text-sm text-neutral-700">{note}</p>}
      <p className="mt-6 text-xs text-neutral-500">Built by {owner}.</p>
    </main>
  );
}
