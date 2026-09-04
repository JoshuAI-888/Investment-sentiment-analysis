# Universe seed

`universe-v1.json` is **owner-provided and not in the repository yet** — it is `DEPLOY.md`
**MT-07**. The count and the basis are decided (**100** most-discussed on Reddit, ranked via
ApeWisdom — D-27, D-30); the ranking itself has not been pulled.

`scripts/seed-universe.ts` refuses to run without it rather than inventing one. A universe
nobody chose sits under every aggregate in the product, and under D-16 the collection that
follows it cannot be repeated.

## Shape

```json
{
  "seededAt": "2026-09-01",
  "basis": "100 most-discussed on Reddit, ranked via ApeWisdom (D-30)",
  "symbols": [
    { "symbol": "NVDA", "exchange": "NASDAQ" }
  ]
}
```

`seededAt` is the date the ranking was pulled. It is a **methodological commitment, not a
convenience**: the universe is circular with the headline metric (ADR-004), so the date the
selection was frozen is part of what any later result means.

## The rule the script exists to keep

It seeds **only when the environment has zero universe versions**. Not "insert the symbols that
are missing" — that resurrects every symbol an administrator removed, on every deploy, silently.
