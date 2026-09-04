/**
 * The confirmed Substack publication set — F16a's collector wiring (MT-15, D-29).
 *
 * **This is a disclosed selection-bias record, not an arbitrary config.** D-29 (`docs/MEMORY.md`)
 * fixes the *basis* — sector coverage, not readership — and `docs/DEPLOY.md`'s MT-15 section
 * ("Confirmed candidate list — signed off 2026-09-04") fixes the *set* itself: 13 publications
 * across 10 of the 11 GICS sectors, owner-confirmed 2026-09-04. **This constant must match that
 * table exactly** — sector and subdomain are not free to drift from the disclosed record, since
 * whatever is polled here is what the Inspector's Substack disclosure describes (§6.1).
 *
 * **Utilities has no dedicated pick.** Two research passes found nothing that cleared both bars
 * every other sector's pick holds (genuinely utilities-specific *and* weekly-or-better cadence) —
 * an accepted, disclosed gap (`docs/DEPLOY.md` MT-15), not an oversight. 10 of 11 GICS sectors are
 * represented; DTE, ES and SO (the seed universe's utilities) carry no Substack coverage on this
 * axis. This constant intentionally has no Utilities entry — do not add a weak placeholder pick to
 * "complete" the table; that would misrepresent a deliberate, disclosed trade-off as coverage.
 *
 * **Verbatim basis, for the Inspector (D-29):** "One to two Substack publications per GICS sector
 * represented in the seed universe, selected for sector coverage rather than readership, personal
 * familiarity, or citation frequency."
 */

/** The 10 of 11 GICS sectors this axis actually covers — Utilities is the disclosed gap. */
export type CoveredGicsSector =
  | 'Energy'
  | 'Materials'
  | 'Industrials'
  | 'Consumer Discretionary'
  | 'Consumer Staples'
  | 'Health Care'
  | 'Financials'
  | 'Information Technology'
  | 'Communication Services'
  | 'Real Estate';

export type SubstackPublication = {
  readonly sector: CoveredGicsSector;
  /** Display name, exactly as recorded in `docs/DEPLOY.md`'s confirmed table. */
  readonly publication: string;
  /** The `<publication>` in `https://<publication>.substack.com/feed` (F04 §4.3). */
  readonly subdomain: string;
};

/** D-29's basis, verbatim, for reuse anywhere the Inspector or a disclosure surface needs it. */
export const SUBSTACK_SELECTION_BASIS =
  'One to two Substack publications per GICS sector represented in the seed universe, selected ' +
  'for sector coverage rather than readership, personal familiarity, or citation frequency.';

/**
 * `docs/DEPLOY.md` MT-15's confirmed candidate list, owner-signed-off 2026-09-04. 13 entries,
 * verbatim sector/publication/subdomain — do not paraphrase or reorder against that table.
 */
export const SUBSTACK_PUBLICATIONS: readonly SubstackPublication[] = [
  { sector: 'Energy', publication: 'Doomberg', subdomain: 'doomberg' },
  { sector: 'Financials', publication: 'Net Interest (Marc Rubinstein)', subdomain: 'netinterest' },
  {
    sector: 'Information Technology',
    publication: 'The Semiconductor Newsletter',
    subdomain: 'thesemiconductornewsletter',
  },
  { sector: 'Information Technology', publication: 'Bits and Bytes', subdomain: 'semiconductor' },
  { sector: 'Health Care', publication: 'Boutique Biotech', subdomain: 'boutiquebiotech' },
  { sector: 'Health Care', publication: 'Bio Brief', subdomain: 'thebiobrief' },
  {
    sector: 'Consumer Staples',
    publication: 'As the Consumer Turns (Adam Josephson)',
    subdomain: 'adamjosephson',
  },
  {
    sector: 'Consumer Staples',
    publication: 'Matt McClintock Retail/Consumer Research',
    subdomain: 'matthewmcclintock',
  },
  { sector: 'Real Estate', publication: 'REIT Dividends', subdomain: 'reits' },
  {
    sector: 'Industrials',
    publication: 'Industrial Tech Stock Analyst',
    subdomain: 'industrialanalyst',
  },
  { sector: 'Materials', publication: 'Metals and Miners', subdomain: 'metalsandminers' },
  {
    sector: 'Communication Services',
    publication: 'The Entertainment Strategy Guy',
    subdomain: 'entertainment',
  },
  { sector: 'Consumer Discretionary', publication: 'Consumer Spec', subdomain: 'consumerspec' },
];

/** `docs/DEPLOY.md` MT-15 — 13 publications across 10 of the 11 GICS sectors. Kept as a named
 *  constant so a test can assert the config matches the disclosed count exactly, not merely
 *  "however many entries happen to be in the array today." */
export const SUBSTACK_PUBLICATION_COUNT = 13;

/** The one GICS sector with no dedicated pick — the disclosed gap `docs/DEPLOY.md` MT-15 names. */
export const SUBSTACK_UNCOVERED_SECTOR = 'Utilities';
