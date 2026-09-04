/**
 * D-11: one account, one deployment, one environment — every versioned table's `environment`
 * column is always this string. Kept as its own tiny module (rather than importing
 * `services/dashboard/refresh.ts`'s `DASHBOARD_CONFIG_ENVIRONMENT`) so this feature does not
 * couple to F07's internals for one literal; both name the same real constraint.
 */
export const ADMIN_ENVIRONMENT = 'production';
