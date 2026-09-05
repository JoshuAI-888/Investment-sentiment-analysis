import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ScheduleSettingsLiveHarness } from '../../../src/rni/ui/ScheduleSettingsLiveHarness';
import type { ScheduleSetting } from '../../../src/rni/settings/schedule/schemas';

const mock = vi.hoisted(() => ({
  env: { PROVIDER_MODE: 'live', DATABASE_URL: 'configured' },
  construct: vi.fn(),
}));
vi.mock('@/env', () => ({ env: mock.env }));
vi.mock('@/rni/read-model', () => ({ rniEnvironment: () => 'server-environment' }));
vi.mock('@/rni/settings/schedule/repositories/store', () => ({
  PostgresRniScheduleSettingsService: class {
    constructor(options: unknown) {
      mock.construct(options);
    }
  },
}));
import { createLiveScheduleSettingsService } from '../../../src/rni/settings/schedule/service';

const setting: ScheduleSetting = {
  jobId: '00000000-0000-4000-8000-000000000001',
  version: 1,
  enabled: true,
  scheduleType: 'interval',
  scheduleExpression: '3600',
  displayTimezone: 'UTC',
  scope: { kind: 'full_universe' },
  nextDueAt: '2026-09-05T01:00:00.000Z',
  observedAt: '2026-09-05T00:00:00.000Z',
  updatedAt: '2026-09-05T00:00:00.000Z',
  updatedBy: '<unsafe-admin>',
  nextRuns: Array.from({ length: 5 }, (_, i) => ({
    dueAt: `2026-09-05T0${i + 1}:00:00.000Z`,
    localTime: `05 Sept 2026 0${i + 1}:00`,
    timezone: 'UTC',
  })),
};

describe('live schedule settings composition and initial surface', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.env.PROVIDER_MODE = 'live';
    mock.env.DATABASE_URL = 'configured';
  });
  it.each(['fixture', ''])(
    'rejects provider mode %s without constructing storage or a fixture',
    (mode) => {
      mock.env.PROVIDER_MODE = mode;
      expect(() => createLiveScheduleSettingsService('admin')).toThrow('unavailable');
      expect(mock.construct).not.toHaveBeenCalled();
    },
  );
  it('requires a database and always resolves environment server-side', () => {
    mock.env.DATABASE_URL = '';
    expect(() => createLiveScheduleSettingsService('admin')).toThrow('unavailable');
    mock.env.DATABASE_URL = 'configured';
    createLiveScheduleSettingsService('admin');
    expect(mock.construct).toHaveBeenCalledExactlyOnceWith({
      environment: 'server-environment',
      actorId: 'admin',
    });
  });
  it('renders one heading, labelled controls, escaped actor and exactly five saved UTC times', () => {
    const html = renderToStaticMarkup(
      createElement(ScheduleSettingsLiveHarness, { initialSetting: setting }),
    );
    expect(html.match(/<h1\b/gu)).toHaveLength(1);
    expect(html.match(/<time\b/gu)).toHaveLength(5);
    expect(html).toContain('Change reason');
    expect(html).toContain('IANA timezone');
    expect(html).toContain('Enable scheduled refreshes');
    expect(html).toContain('&lt;unsafe-admin&gt;');
    expect(html).not.toContain('<unsafe-admin>');
    expect(html).toContain('future schedule fires only');
  });
  it('labels paused projections and overdue enabled schedules honestly', () => {
    expect(
      renderToStaticMarkup(
        createElement(ScheduleSettingsLiveHarness, {
          initialSetting: { ...setting, enabled: false },
        }),
      ),
    ).toContain('projections only');
    expect(
      renderToStaticMarkup(
        createElement(ScheduleSettingsLiveHarness, {
          initialSetting: { ...setting, observedAt: '2026-09-05T02:00:00.000Z' },
        }),
      ),
    ).toContain('next fire is overdue');
  });
});
