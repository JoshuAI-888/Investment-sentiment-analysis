import { describe, expect, it } from 'vitest';
import { scanChunks } from '../../../scripts/checks/bundle';

describe('check:bundle', () => {
  it('passes on a clean client chunk', () => {
    const findings = scanChunks([
      { path: '.next/static/chunks/app.js', content: 'const a=1;export{a};' },
    ]);
    expect(findings).toEqual([]);
  });

  it('passes on no chunks at all', () => {
    expect(scanChunks([])).toEqual([]);
  });

  // CAN FAIL — a deliberately-leaked import, which is F01 §5's named case.
  it('fails on a secret key name in a client chunk', () => {
    const findings = scanChunks([
      { path: '.next/static/chunks/page.js', content: 'const u=process.env.DATABASE_URL;' },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.where).toContain('DATABASE_URL');
  });

  it('fails on a database client in a client chunk', () => {
    const findings = scanChunks([
      { path: '.next/static/chunks/page.js', content: 'import{neon}from"@neondatabase/serverless";' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fails on a postgres connection string', () => {
    const findings = scanChunks([
      { path: '.next/static/chunks/page.js', content: 'const c="postgres://u:p@h/db";' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('fails on a server-only module even when the minifier stripped its contents', () => {
    // Found by running the real leak, not by reasoning about it. A 'use client' module that
    // imports env.ts folds the guard to an unconditional throw, so the minifier drops every
    // key name as dead code and a payload-only scanner reports "pass" on a genuine leak —
    // and keeps reporting pass right up until someone deletes the guard.
    const findings = scanChunks([
      {
        path: '.next/static/chunks/page.js',
        content:
          'throw s(5156),Error("[server-only:env.ts] env.ts was imported from client code.")',
      },
    ]);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.where).toContain('server-only module');
  });

  it('fails on a model SDK in a client chunk', () => {
    const findings = scanChunks([
      { path: '.next/static/chunks/page.js', content: 'require("@anthropic-ai/sdk")' },
    ]);
    expect(findings).toHaveLength(1);
  });

  it('does not report a substring that merely contains a banned token', () => {
    // A check that cries wolf on minified output is a check someone switches off.
    const findings = scanChunks([
      { path: '.next/static/chunks/page.js', content: 'const MY_DATABASE_URLS=[];const pgUp=1;' },
    ]);
    expect(findings).toEqual([]);
  });

  it('reports every distinct leak in one chunk', () => {
    const findings = scanChunks([
      {
        path: '.next/static/chunks/page.js',
        content: 'process.env.RESEND_API_KEY;process.env.BETTER_AUTH_SECRET;',
      },
    ]);
    expect(findings).toHaveLength(2);
  });
});
