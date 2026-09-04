/**
 * F17 — shared constants for the Architecture Explorer's service layer.
 *
 * A tiny module of its own, mirroring `services/admin/constants.ts`'s own reasoning: this
 * feature does not import from `services/admin/` (build discipline — that module is F15's, and
 * this feature's public-safe projection must not share code with the admin-only, full-detail
 * read path). D-11: one account, one deployment, one environment, so every versioned table's
 * `environment` column is always this string.
 */
export const ARCHITECTURE_ENVIRONMENT = 'production';

/**
 * The subject ids that stand in for "a real, small, cheap subject" when a formula example
 * needs a subject and no live universe member is required to demonstrate the arithmetic. Not a
 * real ticker or a real market/sector row — `calculation_snapshot.subject_id`/`subject_type`
 * carry no foreign key (migration `0004`), so these never collide with, or shadow, a real
 * subject's calculations.
 */
export const EXAMPLE_SECURITY_ID = 'architecture-example-security';
export const EXAMPLE_SECURITY_LABEL = 'EXAMPLE';
export const EXAMPLE_MARKET_ID = 'architecture-example-market';
export const EXAMPLE_SECTOR_ID = 'architecture-example-sector';

/** Used when no `config_version` has ever been bootstrapped in this environment (F16a's own
 * disclosed gap — see migration `0014`'s comment). A plain digit string, never a fabricated
 * production version — `calculation_snapshot.config_version` carries no foreign key either, so
 * this is honest rather than merely convenient: there is no real config version to name yet. */
export const NO_CONFIG_VERSION_BOOTSTRAPPED = '0';
