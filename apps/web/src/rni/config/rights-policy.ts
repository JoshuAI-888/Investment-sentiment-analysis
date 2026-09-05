/**
 * D-RNI-26's server-owned P0 authority. Callers may compare persisted lineage with this value,
 * but request payloads and persisted synthesis rows cannot select or activate a policy.
 */
export const RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION = 'rni-source-policy-v1' as const;

export type RniActiveRightsPolicyResolver = () => Promise<
  typeof RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION
>;

export const resolveRniActiveSourceRightsPolicyVersion: RniActiveRightsPolicyResolver =
  async () => RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION;
