'use client';

import { useState } from 'react';
import { createFixtureRniUniverseReadService } from '../../../fixtures/rni-ui/read-service';
import type {
  RniActiveUniverse,
  RniStagedUniversePreview,
  RniUniverseSearchResult,
} from '@/rni/contracts';

export function UniverseSettings({
  active,
  staged,
}: {
  active: RniActiveUniverse;
  staged: RniStagedUniversePreview;
}) {
  const [service] = useState(createFixtureRniUniverseReadService);
  const [result, setResult] = useState<RniUniverseSearchResult | null>(null);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
      <h1>Universe settings</h1>
      <p>
        Active version {active.version.id} · {active.version.securityCount} members
      </p>
      <p>
        Default: {active.defaultSecurity.ticker} — {active.defaultSecurity.companyName} ·{' '}
        {active.defaultSecurity.exchange}
      </p>
      <label>
        Search active S&amp;P 500 members{' '}
        <input
          aria-label="Search active S&P 500 members"
          onChange={async (event) =>
            setResult(await service.searchActiveUniverse({ query: event.target.value, limit: 20 }))
          }
        />
      </label>
      {result ? (
        <ul>
          {result.members.map((member) => (
            <li key={member.id}>
              {member.ticker} — {member.companyName} · {member.exchange}
            </li>
          ))}
        </ul>
      ) : null}
      <section>
        <h2>Staged preview {staged.stagedVersion.id}</h2>
        <p>
          Active version {staged.activeVersion.id} → staged version {staged.stagedVersion.id}
        </p>
        <p>
          {staged.added.length} added · {staged.removed.length} removed ·{' '}
          {staged.stagedVersion.securityCount} members
        </p>
      </section>
    </main>
  );
}
