'use client';

/**
 * F17 §4.4 — the interactive step-through: play / pause / previous / next / reset, full keyboard
 * operation, visible focus, reduced-motion honoured.
 *
 * This is the **deferred client island** — the page composing this (`app/(app)/architecture`)
 * loads it via `next/dynamic` with `ssr: false`, so its JS never blocks first paint and
 * `StepThroughStatic` is what a reader sees and can use before this component's code has even
 * been requested, let alone hydrated. Cut-line item 5 (§4.4): edge highlighting is a plain
 * `outline`/border state change, not a bespoke animation library.
 *
 * **Reduced motion**: `prefers-reduced-motion: reduce` does not remove any control — play,
 * pause, previous, next and reset all keep working — it removes the CSS transition duration, so
 * the highlighted stage changes state instantly instead of sliding.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

export type AnimatedStage = {
  readonly id: string;
  readonly label: string;
  readonly description: string;
};

export type StepThroughAnimatedProps = {
  readonly stages: readonly AnimatedStage[];
  readonly intervalMs?: number;
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

export function StepThroughAnimated({ stages, intervalMs = 2200 }: StepThroughAnimatedProps) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stage = stages[index];
  const count = stages.length;

  useEffect(() => {
    if (!playing || count === 0) return;
    timerRef.current = setInterval(() => {
      setIndex((current) => {
        const next = current + 1;
        if (next >= count) {
          setPlaying(false);
          return current;
        }
        return next;
      });
    }, intervalMs);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [playing, count, intervalMs]);

  const goTo = (next: number) => {
    setPlaying(false);
    setIndex(((next % count) + count) % count);
  };

  const controlsDisabled = count === 0;

  const transitionClass = useMemo(
    () => (reducedMotion ? '' : 'transition-colors duration-300'),
    [reducedMotion],
  );

  if (stage === undefined) return null;

  return (
    <div data-step-through-animated="" data-playing={playing} data-reduced-motion={reducedMotion}>
      <div role="group" aria-label="Pipeline walkthrough controls" className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-control="prev"
          disabled={controlsDisabled}
          onClick={() => goTo(index - 1)}
          className="rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Previous
        </button>
        <button
          type="button"
          data-control={playing ? 'pause' : 'play'}
          disabled={controlsDisabled}
          onClick={() => setPlaying((current) => !current)}
          aria-pressed={playing}
          className="rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <button
          type="button"
          data-control="next"
          disabled={controlsDisabled}
          onClick={() => goTo(index + 1)}
          className="rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Next
        </button>
        <button
          type="button"
          data-control="reset"
          disabled={controlsDisabled}
          onClick={() => {
            setPlaying(false);
            setIndex(0);
          }}
          className="rounded border border-neutral-300 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          Reset
        </button>
        <span className="text-xs text-neutral-500" aria-live="off">
          Step {index + 1} of {count}
        </span>
      </div>

      <div
        role="group"
        aria-label="Pipeline stages"
        className="flex flex-wrap gap-2"
      >
        {stages.map((s, i) => (
          <button
            key={s.id}
            type="button"
            data-stage-button={s.id}
            data-active={i === index}
            aria-current={i === index ? 'step' : undefined}
            onClick={() => goTo(i)}
            className={
              `rounded border px-2 py-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${transitionClass} ` +
              (i === index
                ? 'border-blue-600 bg-blue-50 text-blue-800'
                : 'border-neutral-300 text-neutral-600 hover:border-neutral-400')
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      <div
        aria-live="polite"
        data-current-stage={stage.id}
        className={`mt-3 rounded border border-neutral-200 p-3 ${transitionClass}`}
      >
        {/* h2: this component is mounted directly under the page's own h1 (it precedes the
         * static alternative's own h2, "Every stage, as text", in the DOM when both are shown),
         * so nothing at h2 sits above it — axe's `heading-order` rule requires this, not h3/h4. */}
        <h2 className="text-sm font-semibold">{stage.label}</h2>
        <p className="mt-1 text-sm text-neutral-700">{stage.description}</p>
      </div>
    </div>
  );
}
