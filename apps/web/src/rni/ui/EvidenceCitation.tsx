'use client';

import { useState } from 'react';
import type { CitationEvidence } from './evidence';

export function EvidenceCitation({
  evidence,
  label,
}: Readonly<{ evidence: CitationEvidence; label: string }>) {
  const [isOpen, setIsOpen] = useState(false);
  const { citation, source } = evidence;
  const dialogId = `rni-citation-${citation.id}`;

  return (
    <>
      <button
        type="button"
        data-rni-citation-id={citation.id}
        data-rni-citation-platform={citation.platform}
        aria-controls={dialogId}
        aria-expanded={isOpen}
        onClick={() => setIsOpen(true)}
        className="mr-2 underline focus:outline-none focus:ring-2 focus:ring-blue-700"
      >
        {label}
      </button>
      {isOpen ? (
        <div
          id={dialogId}
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${dialogId}-title`}
          data-rni-evidence-dialog={citation.id}
          data-rni-evidence-platform={citation.platform}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4"
        >
          <div className="mx-auto max-w-2xl space-y-4 bg-white p-6 shadow-lg" tabIndex={-1}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm">{citation.platform === 'x' ? 'X' : 'Reddit'} evidence</p>
                <h2 id={`${dialogId}-title`} className="text-2xl font-semibold">
                  Citation evidence
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="underline focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                Close evidence
              </button>
            </div>
            <section aria-label="Citation">
              <h3 className="font-medium">Cited passage</h3>
              <p>{citation.evidenceText}</p>
              <a
                href={citation.url}
                target="_blank"
                rel="noreferrer"
                className="underline focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                Open canonical source
              </a>
            </section>
            <section aria-label="Bounded source evidence" data-rni-source-item-id={source.id}>
              <h3 className="font-medium">Bounded source evidence</h3>
              <blockquote className="border-l-2 pl-3">{source.boundedContent}</blockquote>
              <p className="text-sm">
                {source.platform === 'x' ? 'X' : 'Reddit'} · {source.sourceKind} ·{' '}
                {source.subredditOrScope}
              </p>
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
}
