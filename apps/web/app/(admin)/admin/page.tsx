import { redirect } from 'next/navigation';
import { RouteShell } from '@/ui/RouteShell';
import { AdminDenied } from '@/ui/AdminDenied';
import { requireAdmin, UnauthenticatedError, UnauthorizedError, PasswordChangeRequiredError } from '@/services/auth';

/** F02 §4.4: `requireAdmin()` called in this route's own body — never only at a layout level. */
export default async function Page() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin" />;
    throw error;
  }

  return <RouteShell route="/admin" title="Operator control plane" owner="F15 (SURFACE)" />;
}
