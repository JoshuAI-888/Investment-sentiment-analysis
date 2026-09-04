/**
 * The `(app)` group carries the parallel drawer slot. Every route in this group renders
 * `children` plus whatever `calculationDrawer` resolves to — the intercepted Inspector when
 * a metric was clicked, and `default.tsx`'s null otherwise.
 */
export default function AppLayout({
  children,
  calculationDrawer,
}: {
  children: React.ReactNode;
  calculationDrawer: React.ReactNode;
}) {
  return (
    <div data-layout="app">
      {children}
      {calculationDrawer}
    </div>
  );
}
