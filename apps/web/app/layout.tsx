import type { Metadata } from 'next';
import { env } from '@/env';
import { logAdminAllowlistOnBoot } from '@/services/auth';
import './globals.css';

/**
 * F02 §4.4's boot assertion. Module-scope, not inside the component: this must run once per
 * process, the first time this module is evaluated, not once per request — a log line that
 * repeats on every page render is not "visible in the first deployment log", it is noise that
 * buries it.
 */
logAdminAllowlistOnBoot();

export const metadata: Metadata = {
  title: 'Barebone Social Sentiment',
  description:
    'Observed social samples across Reddit, X and Substack, with every number inspectable and every aggregate labelled with its coverage.',
};

/**
 * The root layout is the composition root and the one place that reads the environment.
 * Importing `@/env` here also means a malformed environment fails the build rather than the
 * first request — which is the whole point of validating at module load (F01 §4.2).
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const mode = env.PROVIDER_MODE;

  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        {mode === 'fixture' ? (
          <p
            data-testid="provider-mode-banner"
            className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-xs text-amber-900"
          >
            Fixture mode — no provider is being called and no number on this page is observed
            data.
          </p>
        ) : null}
        {children}
      </body>
    </html>
  );
}
