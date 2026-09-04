'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { CitationEvidence } from './evidence';

const focusableSelector = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function EvidenceCitation({
  evidence,
  label,
}: Readonly<{ evidence: CitationEvidence; label: string }>) {
  const [isOpen, setIsOpen] = useState(false);
  const instanceId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const { citation, source } = evidence;
  const dialogId = `rni-citation-${citation.id}-${instanceId}`;

  const close = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (isOpen) closeButtonRef.current?.focus();
  }, [isOpen]);

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusableElements = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(focusableSelector),
    );
    const first = focusableElements[0];
    const last = focusableElements.at(-1);
    if (!first || !last) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
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
          onKeyDown={trapFocus}
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
                ref={closeButtonRef}
                onClick={close}
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
