/**
 * A `JudgeModelClient` (`judge.ts`) backed by committed fixtures — the fixture-before-live-call
 * discipline `04-BUILD-LOOP.md` §2.3 asks for, applied to the judge model call.
 *
 * Keyed by `answerText` rather than by a caller-supplied id: the answer text is what a real
 * judge call would actually be keyed on (there is no other stable identifier crossing the
 * judge/synthesiser boundary), and it is exactly what `buildJudgeInput` puts into `JudgeInput`.
 */
import { readFileSync } from 'node:fs';
import { judgeResponse, type JudgeResponse } from './contracts';
import type { JudgeModelClient } from './judge';

/** Loads a `{ answerText: JudgeResponse }` fixture file, validating every value. */
export function loadJudgeResponseMap(filePath: string): Map<string, JudgeResponse> {
  const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`loadJudgeResponseMap: ${filePath} must contain a JSON object`);
  }

  const map = new Map<string, JudgeResponse>();
  for (const [answerText, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = judgeResponse.safeParse(value);
    if (!parsed.success) {
      throw new Error(
        `loadJudgeResponseMap: ${filePath} entry for answer starting "${answerText.slice(0, 40)}..." failed the judgeResponse schema — ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
    }
    map.set(answerText, parsed.data);
  }
  return map;
}

/** Merges any number of `{ answerText: JudgeResponse }` maps into one lookup table, last write wins. */
export function mergeJudgeResponseMaps(...maps: ReadonlyMap<string, JudgeResponse>[]): Map<string, JudgeResponse> {
  const merged = new Map<string, JudgeResponse>();
  for (const map of maps) for (const [key, value] of map) merged.set(key, value);
  return merged;
}

/**
 * A `JudgeModelClient` that looks up its response by the exact answer text it is asked to
 * judge. Throws rather than falling back to a live call — `PROVIDER_MODE=fixture` has no live
 * fallback (`04-BUILD-LOOP.md` §2.3): a test whose fixture is missing is a test that would
 * otherwise silently pass for the wrong reason.
 */
export function createFixtureJudgeClient(byAnswerText: ReadonlyMap<string, JudgeResponse>): JudgeModelClient {
  return {
    async judge(input) {
      const found = byAnswerText.get(input.answerText);
      if (found === undefined) {
        throw new Error(
          `createFixtureJudgeClient: no fixture judge response for this answer (starts "${input.answerText.slice(0, 60)}...") — PROVIDER_MODE=fixture has no live fallback`,
        );
      }
      return found;
    },
  };
}
