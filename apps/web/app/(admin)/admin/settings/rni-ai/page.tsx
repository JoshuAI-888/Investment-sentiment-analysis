import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { stageRniTaskEnvelopesAction } from './actions';
import {
  createRniTaskEnvelopeSettingsService,
  RniTaskEnvelopeConfigurationUnavailableError,
} from '@/services/jobs';
import {
  PasswordChangeRequiredError,
  requireAdmin,
  UnauthenticatedError,
  UnauthorizedError,
} from '@/services/auth';
import { AdminDenied } from '@/ui/AdminDenied';

export const dynamic = 'force-dynamic';

type PageProps = {
  readonly searchParams: Promise<{ readonly staged?: string }>;
};

const taskLabel = (task: string): string =>
  task.replace(/^rni_/u, '').replace(/^./u, (letter) => letter.toUpperCase());

export default async function RniAiEnvelopeSettingsPage({ searchParams }: PageProps) {
  let session;
  try {
    session = await requireAdmin();
  } catch (error) {
    if (error instanceof UnauthenticatedError) redirect('/sign-in');
    if (error instanceof PasswordChangeRequiredError) redirect('/change-password');
    if (error instanceof UnauthorizedError) return <AdminDenied route="/admin/settings/rni-ai" />;
    throw error;
  }
  const environment = process.env['VERCEL_ENV'] ?? 'development';
  let setting;
  try {
    setting = await createRniTaskEnvelopeSettingsService({
      environment,
      actorId: session.userId,
    }).getCurrentTaskEnvelopes();
  } catch (error) {
    if (error instanceof RniTaskEnvelopeConfigurationUnavailableError) {
      return (
        <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-8" data-state="ready">
          <p className="text-xs uppercase tracking-wide text-neutral-500">Admin settings</p>
          <h1 className="text-3xl font-semibold">RNI model call limits</h1>
          <p role="status">
            No active configuration exists for this environment. Activate the reviewed initial
            configuration before staging task-limit changes.
          </p>
        </main>
      );
    }
    throw error;
  }
  const { staged } = await searchParams;

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8" data-state="ready">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Admin settings</p>
        <h1 className="text-3xl font-semibold">RNI model call limits</h1>
        <p>
          Active configuration <strong>{setting.configVersion}</strong>. Saving creates a staged
          successor for review; it does not switch active or running work.
        </p>
        <p>
          Input is capped by serialized bytes and reserved as the same number of tokens. The
          global USD 2 manual-run, USD 25 full-universe, USD 50 daily and USD 500 monthly stops
          remain enforced separately.
        </p>
      </header>

      {staged === undefined ? null : (
        <p className="rounded border border-emerald-300 bg-emerald-50 p-3" role="status">
          Staged successor configuration {staged} for review. No active run was changed.
        </p>
      )}

      <form action={stageRniTaskEnvelopesAction} className="space-y-5">
        <input name="idempotencyKey" type="hidden" value={randomUUID()} />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="mb-2 text-left font-semibold">Per-task provider envelope</caption>
            <thead>
              <tr>
                <th className="border p-2" scope="col">Task</th>
                <th className="border p-2" scope="col">Input bytes</th>
                <th className="border p-2" scope="col">Output tokens</th>
                <th className="border p-2" scope="col">Tool calls</th>
                <th className="border p-2" scope="col">Timeout (ms)</th>
                <th className="border p-2" scope="col">Call cap (USD)</th>
              </tr>
            </thead>
            <tbody>
              {setting.envelopes.map((envelope) => (
                <tr key={envelope.task}>
                  <th className="border p-2" scope="row">{taskLabel(envelope.task)}</th>
                  <td className="border p-2">
                    <input aria-label={`${taskLabel(envelope.task)} input byte ceiling`}
                      className="w-28 border p-1" defaultValue={envelope.maxInputBytes}
                      max={131072} min={1024} name={`${envelope.task}.maxInputBytes`} required type="number" />
                  </td>
                  <td className="border p-2">
                    <input aria-label={`${taskLabel(envelope.task)} output token ceiling`}
                      className="w-24 border p-1" defaultValue={envelope.maxOutputTokens}
                      max={8000} min={256} name={`${envelope.task}.maxOutputTokens`} required type="number" />
                  </td>
                  <td className="border p-2">
                    <input aria-label={`${taskLabel(envelope.task)} tool call ceiling`}
                      className="w-20 border p-1" defaultValue={envelope.maxToolCalls}
                      max={envelope.task === 'rni_discovery' ? 3 : 0}
                      min={envelope.task === 'rni_discovery' ? 1 : 0}
                      name={`${envelope.task}.maxToolCalls`} required type="number" />
                  </td>
                  <td className="border p-2">
                    <input aria-label={`${taskLabel(envelope.task)} timeout milliseconds`}
                      className="w-24 border p-1" defaultValue={envelope.timeoutMs}
                      max={120000} min={5000} name={`${envelope.task}.timeoutMs`} required type="number" />
                  </td>
                  <td className="border p-2">
                    <input aria-label={`${taskLabel(envelope.task)} call cost cap`}
                      className="w-20 border p-1" defaultValue={envelope.maxCostUsd}
                      max="2" min="0.01" name={`${envelope.task}.maxCostUsd`} required step="0.01" type="number" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="flex max-w-2xl flex-col gap-1" htmlFor="rni-envelope-reason">
          Change reason
          <textarea id="rni-envelope-reason" maxLength={500} name="reason" required rows={3} />
        </label>
        <button className="rounded border border-slate-700 px-3 py-2" type="submit">
          Stage limits for review
        </button>
      </form>
    </main>
  );
}
