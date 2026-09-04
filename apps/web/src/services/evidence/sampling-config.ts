/**
 * Static, versioned sampling-frame facts for the three axes (F10 §4.5). Not adapter
 * configuration — `adapters/substack.ts`'s `publicationSlug` is still caller-supplied per call,
 * and F04 owns wiring the confirmed list into the collector (`docs/progress/collect.md`: "MT-15
 * ... still needs wiring into F04's collection config"). This module exists only to give the
 * evidence pack's disclosure the same facts to *report*, honestly and by version, without
 * re-deriving them at call time.
 */

/**
 * MT-15, confirmed 2026-09-04 (D-36): 13 publications across 10 of the 11 GICS sectors,
 * Utilities a disclosed gap. `docs/DEPLOY.md`'s MT-15 section is the source of record; bump
 * `SUBSTACK_PUBLICATION_SET_VERSION` and add a new export if the list ever changes — never edit
 * this one in place, since a disclosure naming a version has to keep meaning what it meant when
 * an artifact was built against it.
 */
export const SUBSTACK_PUBLICATION_SET_VERSION = 'v1';

/** D-29, verbatim — "recorded basis, verbatim, for the Inspector." */
export const SUBSTACK_SELECTION_BASIS =
  'One to two Substack publications per GICS sector represented in the seed universe, selected ' +
  'for sector coverage rather than readership, personal familiarity, or citation frequency. ' +
  'Utilities has no dedicated pick — a disclosed gap, not an oversight (D-36).';

export type SubstackPublication = {
  readonly sector: string;
  readonly name: string;
  readonly slug: string;
};

/** `docs/DEPLOY.md` MT-15's confirmed table, `v1`. */
export const SUBSTACK_PUBLICATIONS_V1: readonly SubstackPublication[] = [
  { sector: 'Energy', name: 'Doomberg', slug: 'doomberg' },
  { sector: 'Financials', name: 'Net Interest', slug: 'netinterest' },
  { sector: 'Information Technology', name: 'The Semiconductor Newsletter', slug: 'thesemiconductornewsletter' },
  { sector: 'Information Technology', name: 'Bits and Bytes', slug: 'semiconductor' },
  { sector: 'Health Care', name: 'Boutique Biotech', slug: 'boutiquebiotech' },
  { sector: 'Health Care', name: 'Bio Brief', slug: 'thebiobrief' },
  { sector: 'Consumer Staples', name: 'As the Consumer Turns', slug: 'adamjosephson' },
  { sector: 'Consumer Staples', name: 'Matt McClintock Retail/Consumer Research', slug: 'matthewmcclintock' },
  { sector: 'Real Estate', name: 'REIT Dividends', slug: 'reits' },
  { sector: 'Industrials', name: 'Industrial Tech Stock Analyst', slug: 'industrialanalyst' },
  { sector: 'Materials', name: 'Metals and Miners', slug: 'metalsandminers' },
  { sector: 'Communication Services', name: 'The Entertainment Strategy Guy', slug: 'entertainment' },
  { sector: 'Consumer Discretionary', name: 'Consumer Spec', slug: 'consumerspec' },
];

/**
 * D-39 (2026-09-05): the legacy product does not source Reddit from its Data API at all. RNI's
 * `apps/web/src/rni/**` OpenAI Web Search path is the only Reddit acquisition this repository
 * has, and it is a separate namespace this feature does not read from or write to. `collected:
 * false` here is the honest, permanent state for this axis until an owner decision changes it —
 * not a temporary "not yet wired" flag.
 */
export const REDDIT_COLLECTED = false;

/** D-39's own words, for the disclosure. */
export const REDDIT_NOT_COLLECTED_STATEMENT =
  'Reddit is not a data source for this product. The legacy collector does not use the Reddit ' +
  'Data API (D-39) — there is no Reddit evidence to sample, and none is shown, rather than a ' +
  'quiet placeholder standing in for it.';
