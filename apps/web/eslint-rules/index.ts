import layerDirection from './layer-direction';
import noFloatInAnalytics from './no-float-in-analytics';
import noLlmInAnalytics from './no-llm-in-analytics';
import noServerImportInClient from './no-server-import-in-client';
import noSqlOutsideRepositories from './no-sql-outside-repositories';
import noUnboundedPitRead from './no-unbounded-pit-read';

/**
 * The architectural rules. These encode product invariants, so they are code, not convention —
 * a convention survives exactly as long as the first deadline.
 *
 * Five come from F01 §4.3. The sixth, `no-sql-outside-repositories`, is F03 DoD item 9: it
 * could not be written before there was a repositories layer to protect.
 */
export const rules = {
  'no-llm-in-analytics': noLlmInAnalytics,
  'no-float-in-analytics': noFloatInAnalytics,
  'no-server-import-in-client': noServerImportInClient,
  'layer-direction': layerDirection,
  'no-unbounded-pit-read': noUnboundedPitRead,
  'no-sql-outside-repositories': noSqlOutsideRepositories,
} as const;

const plugin = {
  meta: { name: 'architecture', version: '1.0.0' },
  rules,
};

export default plugin;
