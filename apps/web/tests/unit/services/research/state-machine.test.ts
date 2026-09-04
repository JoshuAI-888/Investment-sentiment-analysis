import { describe, expect, it } from 'vitest';
import {
  createSequenceCounter,
  dbStatusFor,
  isTerminal,
  RESEARCH_STAGES,
  RETRACTABLE_STATUSES,
  TERMINAL_STAGES,
} from '../../../../src/services/research/state-machine';

describe('RESEARCH_STAGES', () => {
  it('names exactly the ten states F11 §4.1 diagrams', () => {
    expect(RESEARCH_STAGES).toHaveLength(10);
    expect(new Set(RESEARCH_STAGES).size).toBe(10);
  });
});

describe('dbStatusFor', () => {
  it('collapses every running sub-stage to the DB status "running"', () => {
    expect(dbStatusFor('gathering')).toBe('running');
    expect(dbStatusFor('analyzing')).toBe('running');
    expect(dbStatusFor('synthesizing')).toBe('running');
    expect(dbStatusFor('verifying')).toBe('running');
  });

  it('maps every terminal stage and "queued" to themselves', () => {
    expect(dbStatusFor('queued')).toBe('queued');
    expect(dbStatusFor('complete')).toBe('complete');
    expect(dbStatusFor('verification_failed')).toBe('verification_failed');
    expect(dbStatusFor('abstained')).toBe('abstained');
    expect(dbStatusFor('degraded')).toBe('degraded');
    expect(dbStatusFor('failed')).toBe('failed');
  });
});

describe('isTerminal / TERMINAL_STAGES', () => {
  it('treats exactly the five outcome stages as terminal', () => {
    expect(TERMINAL_STAGES.size).toBe(5);
    expect(isTerminal('complete')).toBe(true);
    expect(isTerminal('degraded')).toBe(true);
    expect(isTerminal('verification_failed')).toBe(true);
    expect(isTerminal('abstained')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
  });

  it('treats queued and every running sub-stage as non-terminal', () => {
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('gathering')).toBe(false);
    expect(isTerminal('analyzing')).toBe(false);
    expect(isTerminal('synthesizing')).toBe(false);
    expect(isTerminal('verifying')).toBe(false);
  });
});

describe('RETRACTABLE_STATUSES', () => {
  it('allows retraction only from complete or degraded', () => {
    expect(RETRACTABLE_STATUSES.has('complete')).toBe(true);
    expect(RETRACTABLE_STATUSES.has('degraded')).toBe(true);
    expect(RETRACTABLE_STATUSES.has('failed')).toBe(false);
    expect(RETRACTABLE_STATUSES.has('verification_failed')).toBe(false);
    expect(RETRACTABLE_STATUSES.has('abstained')).toBe(false);
    expect(RETRACTABLE_STATUSES.has('queued')).toBe(false);
    expect(RETRACTABLE_STATUSES.has('running')).toBe(false);
    expect(RETRACTABLE_STATUSES.has('retracted')).toBe(false);
    expect(RETRACTABLE_STATUSES.has('cancelled')).toBe(false);
  });
});

describe('createSequenceCounter', () => {
  it('starts at 0 and increments per call, independently per instance', () => {
    const a = createSequenceCounter();
    const b = createSequenceCounter();
    expect(a()).toBe(0);
    expect(a()).toBe(1);
    expect(b()).toBe(0);
    expect(a()).toBe(2);
  });
});
