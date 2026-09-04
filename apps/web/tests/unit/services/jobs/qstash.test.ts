import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyMock = vi.fn();

vi.mock('@upstash/qstash', () => ({
  Receiver: vi.fn().mockImplementation(() => ({ verify: verifyMock })),
}));

describe('verifyQStashRequest', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects with no signature header, before ever constructing a Receiver', async () => {
    const { verifyQStashRequest } = await import('../../../../src/services/jobs/qstash');
    const result = await verifyQStashRequest(
      { signature: null, body: '{}', url: 'https://app.example.com/api/cron/dispatch' },
      { currentSigningKey: 'current-key', nextSigningKey: 'next-key' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing_signature');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('rejects an empty signature header the same way as a missing one', async () => {
    const { verifyQStashRequest } = await import('../../../../src/services/jobs/qstash');
    const result = await verifyQStashRequest(
      { signature: '   ', body: '{}', url: 'https://app.example.com/api/cron/dispatch' },
      { currentSigningKey: 'current-key', nextSigningKey: 'next-key' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('missing_signature');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('rejects when no signing key is configured at all, before constructing a Receiver — the "not_configured" code F01\'s fixture-mode response depends on', async () => {
    const { verifyQStashRequest } = await import('../../../../src/services/jobs/qstash');
    const result = await verifyQStashRequest(
      { signature: 'sig', body: '{}', url: 'https://app.example.com/api/cron/dispatch' },
      { currentSigningKey: undefined, nextSigningKey: undefined },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not_configured');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('rejects when the receiver reports the signature invalid', async () => {
    verifyMock.mockResolvedValueOnce(false);
    const { verifyQStashRequest } = await import('../../../../src/services/jobs/qstash');
    const result = await verifyQStashRequest(
      { signature: 'bad-sig', body: '{}', url: 'https://app.example.com/api/cron/dispatch' },
      { currentSigningKey: 'current-key', nextSigningKey: 'next-key' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_signature');
    expect(verifyMock).toHaveBeenCalledOnce();
  });

  it('rejects when the receiver throws (a SignatureError, per the real library)', async () => {
    verifyMock.mockRejectedValueOnce(new Error('signature mismatch'));
    const { verifyQStashRequest } = await import('../../../../src/services/jobs/qstash');
    const result = await verifyQStashRequest(
      { signature: 'bad-sig', body: '{}', url: 'https://app.example.com/api/cron/dispatch' },
      { currentSigningKey: 'current-key', nextSigningKey: 'next-key' },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_signature');
  });

  it('accepts a genuinely valid signature', async () => {
    verifyMock.mockResolvedValueOnce(true);
    const { verifyQStashRequest } = await import('../../../../src/services/jobs/qstash');
    const result = await verifyQStashRequest(
      { signature: 'good-sig', body: '{"hello":"world"}', url: 'https://app.example.com/api/cron/dispatch' },
      { currentSigningKey: 'current-key', nextSigningKey: 'next-key' },
    );
    expect(result.ok).toBe(true);
    expect(verifyMock).toHaveBeenCalledWith({
      signature: 'good-sig',
      body: '{"hello":"world"}',
      url: 'https://app.example.com/api/cron/dispatch',
    });
  });
});
