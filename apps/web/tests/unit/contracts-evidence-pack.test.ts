import { describe, expect, it } from 'vitest';
import {
  AXIS_FRAME_STATEMENT,
  classifiedItem,
  evidencePack,
  frameDisclosure,
} from '../../src/contracts/evidence-pack';

const EVIDENCE_ITEM = {
  id: '11111111-1111-1111-1111-111111111111',
  securityId: '22222222-2222-2222-2222-222222222222',
  evidenceType: 'social_result',
  provider: 'reddit',
  title: 'NVDA is having a moment',
  snippet: 'thread body',
  sourceUrl: null,
  publisher: null,
  authorRef: null,
  stanceLabel: 'bullish',
  stanceScore: '0.8',
  relevanceScore: '0.9',
  publishedAt: new Date(),
  availableAt: new Date(),
  ingestedAt: new Date(),
  lastCheckedAt: null,
  availability: 'available',
  licenseClass: 'standard',
  coverageClass: 'sampled',
  rawHash: 'a'.repeat(64),
  metadata: {},
};

const CLASSIFIED_ITEM = {
  item: EVIDENCE_ITEM,
  axis: 'reddit',
  relevant: true,
  relevanceMethodVersion: 'relevance.filter@1',
  stanceConfidence: '0.75',
  flags: [],
  excludedReason: null,
};

describe('classifiedItem', () => {
  it('accepts a well-formed item', () => {
    expect(classifiedItem.safeParse(CLASSIFIED_ITEM).success).toBe(true);
  });

  it('accepts an excluded item with a reason and no stance', () => {
    expect(
      classifiedItem.safeParse({
        ...CLASSIFIED_ITEM,
        item: { ...EVIDENCE_ITEM, stanceLabel: null, stanceScore: null },
        relevant: false,
        flags: ['ticker_collision'],
        excludedReason: 'AI matched without a corroborating company-name or cashtag reference',
      }).success,
    ).toBe(true);
  });

  it('rejects a stance label outside the shared bullish/bearish/neutral enum — never widened to unclear', () => {
    expect(
      classifiedItem.safeParse({
        ...CLASSIFIED_ITEM,
        item: { ...EVIDENCE_ITEM, stanceLabel: 'unclear' },
      }).success,
    ).toBe(false);
  });
});

describe('frameDisclosure', () => {
  it('accepts a reddit-shaped disclosure', () => {
    expect(
      frameDisclosure.safeParse({
        axis: 'reddit',
        frameStatement: AXIS_FRAME_STATEMENT.reddit,
        window: { from: new Date(), to: new Date() },
        retrievedCount: 40,
        usedCount: 30,
        truncated: false,
        subredditsPolled: ['wallstreetbets'],
        treeComplete: true,
      }).success,
    ).toBe(true);
  });

  it('accepts a substack-shaped disclosure with no reddit/x-only fields', () => {
    expect(
      frameDisclosure.safeParse({
        axis: 'substack',
        frameStatement: AXIS_FRAME_STATEMENT.substack,
        window: { from: new Date(), to: new Date() },
        retrievedCount: 3,
        usedCount: 3,
        truncated: false,
        publicationSetVersion: 'substack-publications-v1',
        selectionBasis: 'sector coverage (D-29)',
      }).success,
    ).toBe(true);
  });

  it('rejects a disclosure missing `truncated` — never silently undisclosed', () => {
    expect(
      frameDisclosure.safeParse({
        axis: 'reddit',
        frameStatement: AXIS_FRAME_STATEMENT.reddit,
        window: { from: new Date(), to: new Date() },
        retrievedCount: 5000,
        usedCount: 30,
      }).success,
    ).toBe(false);
  });
});

describe('evidencePack', () => {
  const PACK = {
    id: '33333333-3333-3333-3333-333333333333',
    securityId: '22222222-2222-2222-2222-222222222222',
    retrievalQuery: 'security_id = NVDA, axes = [reddit]',
    retrievalWindow: { from: new Date(), to: new Date() },
    items: [CLASSIFIED_ITEM],
    frames: [
      {
        axis: 'reddit',
        frameStatement: AXIS_FRAME_STATEMENT.reddit,
        window: { from: new Date(), to: new Date() },
        retrievedCount: 1,
        usedCount: 1,
        truncated: false,
      },
    ],
    createdAt: new Date(),
  };

  it('accepts a well-formed pack', () => {
    expect(evidencePack.safeParse(PACK).success).toBe(true);
  });

  it('rejects more than 30 items', () => {
    const tooMany = Array.from({ length: 31 }, () => CLASSIFIED_ITEM);
    expect(evidencePack.safeParse({ ...PACK, items: tooMany }).success).toBe(false);
  });

  it('rejects two frame disclosures for the same axis (D-14: never blended, never duplicated)', () => {
    expect(
      evidencePack.safeParse({ ...PACK, frames: [PACK.frames[0], PACK.frames[0]] }).success,
    ).toBe(false);
  });

  it('rejects a pack with zero frame disclosures', () => {
    expect(evidencePack.safeParse({ ...PACK, frames: [] }).success).toBe(false);
  });
});
