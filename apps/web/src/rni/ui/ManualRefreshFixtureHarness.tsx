'use client';

import { useState } from 'react';
import { FixtureRniCommandService } from '../../../fixtures/rni-ui/read-service';
import { ManualRefreshControls } from './ManualRefreshControls';

/** Browser-fixture harness: production controls receive the same frozen command interface. */
export function ManualRefreshFixtureHarness() {
  const [service] = useState(() => new FixtureRniCommandService({ deferred: true }));

  return (
    <>
      <ManualRefreshControls service={service} />
      <button type="button" data-rni-fixture-release onClick={() => service.releaseNext()}>
        Complete fixture request
      </button>
    </>
  );
}
