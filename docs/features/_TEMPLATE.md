# F## — <Feature name>

**Wave:** <n> · **Lane:** <letter> · **Estimate:** <h> · **Depends on:** <F##, F##>
**Status:** see `../PROGRESS.md` (this file never records status)

## 1. Purpose
<Two or three sentences. What the user or operator can do after this that they could not
before. If you cannot state a user-visible or operator-visible outcome, the feature is
mis-scoped.>

## 2. Scope
**In:** <bulleted>
**Out:** <bulleted, with the feature that owns it instead>

## 3. Contracts
**Consumes:** <shared contracts from `../02-ARCHITECTURE-CONTRACTS.md`>
**Produces:** <new contracts other features will depend on>
**Must not redefine:** <contracts owned elsewhere>

## 4. Build spec
<Files, schemas, formulas, states, routes. Concrete enough that two agents would build the
same thing. Reference source-PRD sections rather than restating them at length.>

## 5. Test plan
| Level | Cases |
|---|---|
| Unit | |
| Contract | |
| Integration | |
| E2E | |
| Feature-specific | |

## 6. Definition of Done
- [ ] <each one independently verifiable, each one with a test behind it>

## 7. PR review steps
1. <what the reviewer — or the self-review — checks first, in order>

## 8. Risks and open questions
| Risk | Mitigation / owner |
|---|---|
