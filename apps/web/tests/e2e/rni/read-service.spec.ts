import { expect, test } from '@playwright/test';
import {
  RniFixtureNotFoundError,
  createFixtureRniReadService,
  rniUiFixtureCatalogue,
} from '../../../fixtures/rni-ui/read-service';
import {
  rniCitation,
  rniCombinedSummary,
  rniPlatformSlice,
  rniRun,
  rniSecurityDetail,
  rniSourceItem,
} from '@/rni/contracts';
import { comparativeSource, rniFixtureIds } from '@/rni/testing/reference-fixtures';

test.describe('RNI fixture read service', () => {
  test('returns each catalogue state through frozen methods without cross-source shortcuts', async () => {
    for (const [state, fixture] of Object.entries(rniUiFixtureCatalogue)) {
      const service = createFixtureRniReadService(state as keyof typeof rniUiFixtureCatalogue);
      const fixtureRun = await service.getRun(fixture.run.id);
      expect(rniRun.parse(fixtureRun)).toEqual(fixture.run);

      const platformSlices = await service.getPlatformSlices(fixture.run.id);
      expect(platformSlices.map((slice) => slice.platform)).toEqual(['reddit', 'x']);
      for (const platformSlice of platformSlices) {
        expect(rniPlatformSlice.parse(platformSlice)).toEqual(platformSlice);
      }
      expect(platformSlices).toEqual(fixture.platformSlices);

      if (state === 'refreshing') {
        expect(fixtureRun.status).toBe('running');
        expect(platformSlices.map((slice) => slice.status)).toEqual(['running', 'pending']);
        await expect(
          service.getSecuritySummary(fixture.run.id, rniFixtureIds.nvda),
        ).rejects.toEqual(new RniFixtureNotFoundError('security summary', rniFixtureIds.nvda));
      } else {
        const fixtureSummary = await service.getSecuritySummary(fixture.run.id, rniFixtureIds.nvda);
        expect(rniCombinedSummary.parse(fixtureSummary)).toEqual(
          fixture.summariesBySecurityId[rniFixtureIds.nvda],
        );
        for (const citationId of fixtureSummary.sections.flatMap(
          (section) => section.citationIds,
        )) {
          const citation = await service.getCitation(citationId);
          const evidence = await service.getEvidence(citation.sourceItemId);
          expect(rniCitation.parse(citation)).toEqual(fixture.citationsByCitationId[citationId]);
          expect(citation.platform).toBe(evidence.platform);
          expect(citation.url).toBe(evidence.originalUrl);
          expect(evidence.boundedContent).toContain(citation.evidenceText);
        }
      }

      for (const [sourceItemId, evidence] of Object.entries(fixture.evidenceBySourceItemId)) {
        expect(rniSourceItem.parse(await service.getEvidence(sourceItemId))).toEqual(evidence);
      }
    }

    const partialService = createFixtureRniReadService('partial');
    expect(
      (await partialService.getPlatformSlices(rniFixtureIds.run)).map((slice) => slice.status),
    ).toEqual(['complete', 'unavailable']);
    expect(
      (await partialService.getSecuritySummary(rniFixtureIds.run, rniFixtureIds.nvda)).status,
    ).toBe('partial');
    const firstRadarPage = await partialService.getRadarPage({
      runId: rniFixtureIds.run,
      limit: 1,
    });
    const secondRadarPage = await partialService.getRadarPage({
      runId: rniFixtureIds.run,
      cursor: firstRadarPage.nextCursor,
      limit: 1,
    });
    expect(firstRadarPage.rows.map((row) => row.security.ticker)).toEqual(['NVDA']);
    expect(secondRadarPage.rows.map((row) => row.security.ticker)).toEqual(['AMD']);

    const detail = await partialService.getSecurityDetail(rniFixtureIds.run, rniFixtureIds.nvda);
    expect(rniSecurityDetail.parse(detail)).toEqual(
      rniUiFixtureCatalogue.partial.securityDetailsBySecurityId[rniFixtureIds.nvda],
    );
    expect(detail.reddit.dimensions.map((dimension) => dimension.dimension)).toEqual([
      'company_fundamentals',
      'market_trading',
      'catalyst_event',
      'retail_narrative',
    ]);
    expect(detail.x.dimensions.map((dimension) => dimension.dimension)).toEqual(
      detail.reddit.dimensions.map((dimension) => dimension.dimension),
    );
    expect(
      detail.reddit.dimensions.find((dimension) => dimension.dimension === 'market_trading')
        ?.stance,
    ).toBe('bullish');
    expect(
      detail.x.dimensions.find((dimension) => dimension.dimension === 'market_trading')?.stance,
    ).toBe('bearish');
    for (const platform of [detail.reddit, detail.x]) {
      for (const citationId of platform.dimensions.flatMap((dimension) => dimension.citationIds)) {
        expect((await partialService.getCitation(citationId)).platform).toBe(platform.platform);
      }
    }
  });

  test('returns defensive copies through only the frozen read service methods', async () => {
    const service = createFixtureRniReadService('complete');
    const first = await service.getEvidence(comparativeSource.id);
    first.title = 'Mutated in a component';
    const second = await service.getEvidence(comparativeSource.id);

    expect(second.title).toBe(comparativeSource.title);
    const partialService = createFixtureRniReadService('partial');
    const firstDetail = await partialService.getSecurityDetail(
      rniFixtureIds.run,
      rniFixtureIds.nvda,
    );
    firstDetail.reddit.dimensions[0]!.rationale = 'Mutated in a component';
    const secondDetail = await partialService.getSecurityDetail(
      rniFixtureIds.run,
      rniFixtureIds.nvda,
    );
    expect(secondDetail.reddit.dimensions[0]!.rationale).not.toBe('Mutated in a component');
    await expect(service.getRun('00000000-0000-4000-8000-000000000099')).rejects.toEqual(
      new RniFixtureNotFoundError('run', '00000000-0000-4000-8000-000000000099'),
    );
    await expect(
      service.getSecurityDetail(rniFixtureIds.run, '00000000-0000-4000-8000-000000000099'),
    ).rejects.toEqual(
      new RniFixtureNotFoundError('security detail', '00000000-0000-4000-8000-000000000099'),
    );
    await expect(
      service.getSecuritySummary(rniFixtureIds.run, '00000000-0000-4000-8000-000000000099'),
    ).rejects.toEqual(
      new RniFixtureNotFoundError('security summary', '00000000-0000-4000-8000-000000000099'),
    );
    await expect(service.getCitation('00000000-0000-4000-8000-000000000099')).rejects.toEqual(
      new RniFixtureNotFoundError('citation', '00000000-0000-4000-8000-000000000099'),
    );
  });
});
