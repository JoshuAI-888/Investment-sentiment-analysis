import { describe, expect, it } from 'vitest';

import {
  RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION,
  resolveRniActiveSourceRightsPolicyVersion,
} from '../../../../src/rni/config';

describe('D-RNI-26 active source-rights authority', () => {
  it('resolves the integration-frozen P0 policy without caller input', async () => {
    expect(RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION).toBe('rni-source-policy-v1');
    await expect(resolveRniActiveSourceRightsPolicyVersion()).resolves.toBe(
      RNI_ACTIVE_SOURCE_RIGHTS_POLICY_VERSION,
    );
  });
});
