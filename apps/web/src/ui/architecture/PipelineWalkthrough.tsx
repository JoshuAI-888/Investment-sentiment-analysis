'use client';

/**
 * F17 §4.4 — composes the static alternative (always rendered, part of first paint) with the
 * animated step-through (a deferred client island).
 *
 * `next/dynamic(..., { ssr: false })` is only legal inside a Client Component boundary in the App
 * Router, which is why this thin wrapper exists rather than calling `dynamic()` straight from the
 * server-rendered page. The animated component's chunk is not even requested until a reader
 * opts in — `StepThroughStatic` above it is the complete answer for everyone else, including a
 * crawler, a screen-reader user who never presses the button, and first paint itself.
 */
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { StepThroughStatic, type StaticStage } from './StepThroughStatic';

const StepThroughAnimated = dynamic(
  () => import('./StepThroughAnimated').then((mod) => mod.StepThroughAnimated),
  {
    ssr: false,
    loading: () => <p className="text-sm text-neutral-500">Loading the interactive walkthrough…</p>,
  },
);

export type PipelineWalkthroughProps = {
  readonly stages: readonly StaticStage[];
};

export function PipelineWalkthrough({ stages }: PipelineWalkthroughProps) {
  const [showAnimated, setShowAnimated] = useState(false);

  return (
    <div data-pipeline-walkthrough="">
      <button
        type="button"
        onClick={() => setShowAnimated((current) => !current)}
        aria-expanded={showAnimated}
        aria-controls="pipeline-walkthrough-interactive"
        data-toggle-interactive-walkthrough=""
        className="mb-4 rounded border border-neutral-300 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        {showAnimated ? 'Hide interactive walkthrough' : 'Show interactive walkthrough'}
      </button>

      {showAnimated ? (
        <div id="pipeline-walkthrough-interactive" className="mb-6">
          <StepThroughAnimated stages={stages.map(({ id, label, description }) => ({ id, label, description }))} />
        </div>
      ) : null}

      {/* h2: this sits directly under the page's own h1, with nothing at h2 above it. */}
      <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Every stage, as text
      </h2>
      <div className="mt-2">
        <StepThroughStatic stages={stages} />
      </div>
    </div>
  );
}
