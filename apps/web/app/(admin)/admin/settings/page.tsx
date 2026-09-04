import { redirect } from 'next/navigation';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';
import { getDeploymentSettingsView, getSettingsCatalogueView } from '@/services/admin/reads';
import { SettingsCatalogueTable } from '@/ui/admin/SettingsCatalogueTable';

/** F02 §4.4: `requireAdmin()` called in this route's own body — never only at a layout level. */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/settings" />;
    throw error;
  }

  const { activeConfigVersion, catalogue } = await getSettingsCatalogueView();
  const { secrets, plain } = getDeploymentSettingsView();

  return (
    <main data-route="/admin/settings" className="mx-auto max-w-3xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section>
        <h2 className="text-lg font-semibold">Typed settings catalogue</h2>
        <p className="text-sm text-neutral-600">
          Every change here creates and activates a new config version (ADR-012). D-15: the price
          trigger thresholds below govern X spend directly.
        </p>
        <div className="mt-4">
          <SettingsCatalogueTable initialCatalogue={catalogue} activeConfigVersion={activeConfigVersion} />
        </div>
      </section>

      <section data-deployment-settings="">
        <h2 className="text-lg font-semibold">Deployment (read-only)</h2>
        <p className="text-sm text-neutral-600">
          Never editable from the browser (ADR-012). Secret values are never echoed, not even
          partially — status and a fixed-length mask only.
        </p>
        <table className="mt-4 w-full text-left text-sm">
          <tbody>
            {plain.map((row) => (
              <tr key={row.key} className="border-b border-neutral-100" data-deployment-plain={row.key}>
                <td className="p-2 font-mono text-xs">{row.key}</td>
                <td className="p-2">{row.value ?? '(not set)'}</td>
              </tr>
            ))}
            {secrets.map((row) => (
              <tr key={row.key} className="border-b border-neutral-100" data-deployment-secret={row.key}>
                <td className="p-2 font-mono text-xs">{row.key}</td>
                <td className="p-2 font-mono" data-secret-display={row.key}>
                  {row.display}
                </td>
                <td className="p-2 text-xs text-neutral-500">{row.configured ? 'configured' : 'not set'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
