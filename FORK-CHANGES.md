# Fork changes

What this fork adds on top of upstream, and what to check when merging upstream
into it.

- Upstream: [`decolua/9router`](https://github.com/decolua/9router) (remote `upstream`,
  default branch `master` — there is no `main`)
- Fork point: `699edac3`, tag `v0.5.55`
- Features, oldest first: [`logs`](#feature-logs) (unredacted request inspector),
  [`locks`](#feature-locks) (configurable account cooldowns and a per connection release
  button), [`conntest`](#feature-conntest) (Test on each Connections row),
  [`tokenstat`](#feature-tokenstat) (token refresh status on each Connections row)

### Merge log

- `v0.5.59` → `5920eec4`, 2026-08-29. **No counts moved**, 24/24. `errorConfig.js` and
  `backgroundTokenRefresh.js` — the two most consequential upstream files — were absent
  from upstream's diff entirely. **Conflicted:** `src/sse/services/auth.js`, in
  `markAccountUnavailable`'s `resetsAtMs` branch; resolved by keeping upstream's
  antigravity case with the fork's resolver as the cap on the other side, commented in
  place. **Claims corrected rather than counts**, each rewritten where it lives: step 2 of
  [How outcome is decided](#how-outcome-is-decided) (`onStreamComplete` now also fires from
  `transform()`), a new third bullet in
  [Known limitations — locks](#known-limitations--locks) (antigravity quota now bypasses
  `markAccountUnavailable`), [The timeout](#the-timeout-is-the-only-new-behaviour) plus the
  two rows repeating it (`fetchWithConnectionProxy` gained a 15 s per-fetch bound, giving
  `TEST_TIMEOUT_MS` a lower bound), and post-merge step 10 (it said *equality* where the
  comparison must be strict). Post-merge steps 1 to 5 and 9 to 11 pass; 6 to 8 were run
  later, in the review below.

  **Four defects found, none by a checklist item — that is the lesson of this merge.**
  Recorded here because each one names a blind spot that is now covered elsewhere:

  | Found by | Defect | Now covered by |
  | --- | --- | --- |
  | reading upstream's diff against [What upstream can break](#files-the-fork-depends-on-but-never-edits), too late | the 15 s bound above | doing step 1 *before* merging |
  | the test comparison | the `locks` settings read failed open only on an *async* throw, taking down two cases in `github-monthly-usage-lock.test.js` | its row in [What upstream can break](#files-the-fork-depends-on-but-never-edits) |
  | reading the whole fork diff | `handleForcedSSEToJson` never received a `reqLogger`, so every successful forced-SSE-to-JSON row was badged `Incomplete` | [The third response path](#the-third-response-path) |
  | reviewing the two features that share a row | `handleTestConnection` never refetched, so the badge updated while four row fields it writes stayed stale | a bullet in post-merge step 8 |

  The same review deleted seven pieces of dead or defensive code, each of which now says in
  place why it is absent: `/api/locks/reset`'s unread `cleared` count (and
  `MODEL_LOCK_PREFIX` with it), `CollapsibleSection`'s unpassed `badge` and `defaultOpen`,
  the `!== undefined` half of `LogsTab`'s `stream` test, `TokenStatus`'s unreachable
  non-permanent `attempt.code` branch, `readConfiguredMs`'s numeric-string arm, and
  `readRefreshAttempt`'s shape screen for "an older build" of a field this diff introduces.
  Two robustness fixes with no behavioural change: `fs.openSync` moved inside the `try` in
  both `requestLogsFs.js` readers, and `hasClearableLock` gained the `isActive` gate its
  neighbours had. Verified in a browser, not by reading: the Test click issues a fresh
  `GET /api/providers` and `GET /api/token-status`, and on the `codex` list none of the 146
  disabled rows carries an Unlock button while all 120 active errored ones do.

  A pass over this document then corrected the `npx eslint .` figure and closed one gap —
  see [Verifying](#verifying) for why that total is not reproducible, and
  [Known limitations — tokenstat](#known-limitations--tokenstat) for the sweep's per-refresh
  write. It also renamed the four `### Known limitations` headings per feature, retiring the
  rule against linking to them.
- Fork point `699edac3`, tag `v0.5.55`. No merges before this.

**Merging right now?** In order:

1. Before merging, read `git diff HEAD..upstream/master --stat` against
   [What upstream can break](#what-upstream-can-break). That turns upstream's file list
   into a shortlist of what to watch, and it is the only step that catches trouble in
   files the fork never edits.
2. Merge, resolve conflicts.
3. Run `node scripts/fork-check.mjs`. It executes every grep in the
   [checklist](#upstream-merge-checklist) and prints one line per item, so a clean run
   answers items 1 to 24 in one command and a failing one names the item to read.
4. For each `FAIL`, read the matching checklist item — it holds the repair, which the
   script does not. Then [Verifying](#verifying) and the
   [post-merge check](#post-merge-check), neither of which the script covers.

The feature sections explain why an item exists; read one when its check fails.

**Run the greps through the script rather than by hand.** The commands quoted in the
checklist are POSIX-shell spellings — `git grep -c`, `| sort -u` — and this fork is
developed on Windows, where `sort -u` does not exist and PowerShell expands the `[id]` in
`src/app/api/logs/session/[name]` and `providers/[id]` as a wildcard character class unless
the path goes through `-LiteralPath`. The script already handles both. The quoted commands
are kept because they are the readable statement of what is being asserted, and because
`git grep` itself behaves the same on either platform.

## Contents

- [Maintaining this file](#maintaining-this-file) — the rules that keep the rest of it
  useful. Read before editing this document, not before merging.
- [Fork inventory](#fork-inventory) — every file the fork touches, as
  [Added](#added) and [Modified](#modified) tables.
- [Rules that outlive a feature](#rules-that-outlive-a-feature) — constraints that bind
  the next feature too. Read before designing one.
- [What upstream can break](#what-upstream-can-break) — the table a merge starts from:
  [files the fork edits](#files-the-fork-edits), and
  [files it depends on but never edits](#files-the-fork-depends-on-but-never-edits),
  whose only record this is.
- [Feature: logs](#feature-logs) — the unredacted request inspector.
  [The `logDir` bridge](#the-logdir-bridge--most-likely-to-conflict) is the part a merge
  lands on. Also [The third response path](#the-third-response-path),
  [Header masking](#header-masking), [Access](#access),
  [Tab registration](#tab-registration), [Environment](#environment),
  [How outcome is decided](#how-outcome-is-decided) and
  [Known limitations](#known-limitations--logs).
- [Feature: locks](#feature-locks) — configurable cooldowns and a per connection release
  button. [The remapping](#the-remapping--most-likely-to-conflict) is the part a merge
  lands on. Also [The reset route](#the-reset-route) and
  [Known limitations](#known-limitations--locks).
- [Feature: conntest](#feature-conntest) — Test on each Connections row.
  [The timeout](#the-timeout-is-the-only-new-behaviour) is the only new behaviour. Also
  [Known limitations](#known-limitations--conntest).
- [Feature: tokenstat](#feature-tokenstat) — token refresh status on each Connections row.
  [The two branches](#the-two-branches--most-likely-to-conflict) are the part a merge
  lands on. Also [The record field](#the-record-field),
  [Eligibility](#eligibility-and-the-three-things-a-row-can-say),
  [The read route](#the-read-route) and
  [Known limitations](#known-limitations--tokenstat).
- [Upstream merge checklist](#upstream-merge-checklist) — one numbered item per
  assertion, each with its grep, its expected count and its repair.
- [Verifying](#verifying) — lint, build and the test comparison, none of which the
  checklist covers.
- [Post-merge check](#post-merge-check) — the steps that need a running instance,
  because nothing above proves a feature still works end to end.

**Four headings repeat across the feature sections and are deliberately absent here** —
`Why it exists`, `Design`, `Settings` and `Deliberately untouched`. A repeated heading gets
a positional anchor id (`#design-2`) that shifts silently when a feature is added or
reordered, so linking them would put rotting anchors in the one place a reader trusts. Jump
to the feature and read down: within a section they always appear in that order, with the
conflict-prone section and `Known limitations` linked here among them. Not every feature
carries all four — `conntest` has no `Settings` and no `Deliberately untouched`.

**`Known limitations` used to be the fifth, and was renamed per feature instead** —
`Known limitations — logs` and so on. It is the sub-section the rest of this document
cross-references most, and three places had to say "read it below" rather than link to it.
Suffixing the feature name costs one word and buys a stable anchor. **Do the same for a
fifth feature's, and do not reintroduce a bare `### Known limitations`** — the anchors are
positional, so adding one silently retargets every link above to whichever section now comes
second.

This list carries no counts on purpose; item 25 already owns every number that goes stale.

## Maintaining this file

This file has one job: making an upstream merge reviewable without re-deriving why
the fork's code looks the way it does. Write it for whoever runs that merge, most
likely you, a year from now, with conflict markers open.

- **One feature per `## Feature:` section.** A new feature gets its own section
  rather than being threaded through the existing ones.
- **The inventory, the merge checklist and the verification steps stay global.** A
  merge happens once for the whole fork, not once per feature. Tag their entries
  with the feature they belong to instead of splitting them up.
- **A constraint that binds the next feature too belongs in "Rules that outlive a
  feature".** Leaving it inside the feature section that discovered it is how the next
  feature walks into the same wall. Keep the feature section as a pointer.
- **Present tense. State the constraint together with the failure it prevents**, not
  the story of how it was found. Every "do not do X" needs the concrete breakage
  that follows from X, described well enough to recognise in a diff.
- **Never abbreviate an identifier.** Exact paths, function names, field names,
  literal string values and grep commands with their expected counts are what make
  a merge check possible at all.
- **Only write a number that something can be checked against.** Grep counts and diff
  sizes belong here: they are assertions, and their going stale is the signal to look.
  Sizes are different. A size that is not traceable to a named constant is derived from
  something configurable, so it describes one configuration and then lies about the
  rest — quote the constant or the formula instead of the result. And **never make a
  size the diagnostic when a structural check exists**: "these four keys must be absent"
  beats "the response should be under N", stays exact, and survives retuning. That rule
  came from a real bug, a page-size threshold that could not fire.
- **Label any figure that came from one install.** Timings and disk usage need a
  measurement command, not a value.
- **Keep the code tags in step.** Every file the fork edits carries a
  `FORK(<feature>):` comment, so one grep returns the whole feature. Either form is
  fine — `//` on its own line, or `*` inside an existing JSDoc block — so the tag can
  sit where the explanation belongs. Always grep the bare `FORK(<feature>)`, never the
  comment prefix. Add the tag when you add a file, and update the inventory below.

  **A file can carry more than one tag, and three do** — `src/dashboardGuard.js` carries
  two, and `providers/[id]/ConnectionRow.js` and `providers/[id]/page.js` carry three
  each. Tag every feature whose code is in the file rather than picking the dominant one,
  or dropping a feature leaves its lines behind in a file that no longer mentions it. The
  consequence for greps: per-feature counts overlap, so the whole-fork inventory uses the
  bare `FORK(` prefix and only per-feature checks use a full tag. **The overlap is not one
  per shared file** — a three-tag file inflates the per-feature sum by two — so derive the
  expected sum from the tag counts rather than from the number of shared files.

  **A file that belongs to no feature carries no tag, and the Added table is its only
  record.** Two do: this document and `scripts/fork-check.mjs`. The tag's job is to return
  one feature's footprint, so tagging fork-wide tooling with every feature tag would inflate
  every per-feature count while telling nobody anything. Keep such files out of the tag scheme
  and in the table — and if a third appears, say so there, because nothing else will.
- **Record what the fork depends on but does not edit.** Those files carry no tag, by
  definition, so "What upstream can break" is their only record. A dependency added
  without an entry there is invisible at merge time.
- **Append to the merge log at the top.** After a merge, the fork point alone stops
  being the useful fact. Replace the "Last merged" line with a `### Merge log` section
  under the header, newest first, one line each:

  ```
  ### Merge log

  - `v0.6.02` → `4f1c9ab2`, 2026-09-14. Items 12, 13 re-counted (upstream retuned the
    backoff base). `chatCore.js` conflicted; `logDir` re-threaded by hand.
  - Fork point `699edac3`, tag `v0.5.55`. No merges before this.
  ```

  Tag, merge commit, date, then only what a future merge needs: which counts moved, and
  which files conflicted. Not a changelog of upstream — `git log` has that.

Kept at the repo root rather than under `docs/`: `.gitignore` line 52 ignores
`docs/*`, so a copy there would be silently left out of every commit. The neighbouring
line 49, `logs/*`, is what keeps raw dumps out of version control — see the entry for
`.gitignore` in [What upstream can break](#what-upstream-can-break).

## Fork inventory

Every file the fork touches, across all features. Fifteen modified, thirteen added,
**+435 −32** in the modified ones, measured as `git diff upstream/master..HEAD --stat`
over the fifteen rows of the Modified table.

```
git grep -l --untracked "FORK(" -- open-sse src
```

That returns twenty-six code files — every modified one, plus every added one except the
**two that belong to no feature and therefore carry no tag**: this document and
`scripts/fork-check.mjs`. Both are listed in the Added table below, which is their only
record; the scope above also does not reach `scripts/`, so tagging the script would not
change the count either way.

The bare `FORK(` prefix is what makes it whole-fork; a single feature is `FORK(logs)`,
`FORK(locks)`, `FORK(conntest)` or `FORK(tokenstat)`, and those four sum to thirty-one
rather than twenty-six because three files carry more than one tag — one carries two and
two carry three.

Keep `--untracked` on every grep in this document. A file added by the feature you are
working on is untracked until it is committed, and without the flag it is simply absent
from the results — which reads as a missing tag rather than as a missing flag.

The tag is exhaustive for **edits**: an untagged file is one the fork does not modify.

It says nothing about risk. The fork also leans on upstream files it never edits, and
those carry no tag precisely because there is no fork code in them to hang it on. Read
the next section before concluding that an untagged file in upstream's diff is
harmless.

### Added

| File | Feature | Purpose |
| --- | --- | --- |
| `FORK-CHANGES.md` | — | This file. |
| `scripts/fork-check.mjs` | — | Runs checklist items 1 to 24 and prints pass/fail per item. Holds the same expected numbers as the checklist, so **the two must be updated together** — nothing detects a disagreement between them. Node rather than a shell script so one copy works on Windows and POSIX; asserts nothing about lint, build, tests or the post-merge check. |
| `src/lib/requestLogsFs.js` | logs | Read-only accessor for the `logs/` tree: name parsing, stage reading, outcome resolution, retention. Rewrites nothing it reads. **The only fork-added code that deletes files** — `pruneSessions` is its single `fs.rmSync`. Upstream deletes in several places of its own (`src/mitm/*`, `src/lib/db/backup.js`, `src/lib/tunnel/*`, `open-sse/executors/devin-cli.js`), so this is a claim about the fork's diff, not about the repo. |
| `src/app/api/logs/records/route.js` | logs | List endpoint, and the only one the list view calls — so retention is triggered from here. Metadata only. |
| `src/app/api/logs/session/[name]/route.js` | logs | Reads one session's stages, lazily, per opened row. |
| `src/app/(dashboard)/dashboard/usage/components/LogsTab.js` | logs | The tab: filters, table, and a side panel with the summary and the raw dump. |
| `src/lib/lockPolicy.js` | locks | The settings keys and the resolver that remaps upstream's computed cooldown onto a configured one. Pure, imported by both server and client. |
| `src/app/api/locks/reset/route.js` | locks | Clears every `modelLock_*` on one connection plus the error state. The only fork route that mutates a connection. |
| `src/app/(dashboard)/dashboard/profile/components/LockDurationsCard.js` | locks | The six duration fields on the Settings page. Reads and writes `/api/settings` itself. |
| `src/shared/utils/connectionTest.js` | conntest | Client wrapper around `POST /api/providers/<id>/test`. Adds the timeout that route has no server-side equivalent for. |
| `src/sse/services/tokenRefreshStatus.js` | tokenstat | Both halves of the feature's policy: the shape written to the record, and the read-side resolution of eligibility, permanence and the next due time. Holds `REFRESH_ATTEMPT_FIELD` and `REFRESH_ERROR_DETAIL_MAX`. **No database import** — the write call lives in `tokenRefresh.js`, matching `lockPolicy.js` and `requestLogsFs.js`. |
| `src/app/api/token-status/route.js` | tokenstat | `GET`, one entry per connection, keyed by id. Names every field it emits instead of spreading the record, which is what keeps tokens out. The only fork route with no `LOCAL_ONLY_PATHS` entry — see its header for why. |
| `src/app/(dashboard)/dashboard/providers/[id]/TokenStatus.js` | tokenstat | The line inside a connection row. Display only, no state, no interval. |

### Modified

| File | Feature | Δ | Change |
| --- | --- | --- | --- |
| `open-sse/handlers/chatCore.js` | logs | +10 −2 | `logDir: reqLogger.sessionPath` in `sharedCtx`, plus the two error-path `saveRequestDetail` calls that run before it exists. Also `reqLogger` itself at the `handleForcedSSEToJson` call — that handler is the one upstream never gave it to. |
| `open-sse/handlers/chatCore/requestDetail.js` | logs | +4 | `buildRequestDetail` passes `logDir` through. |
| `open-sse/handlers/chatCore/streamingHandler.js` | logs | +5 −2 | `logDir` destructured in `handleStreamingResponse` and `buildOnStreamComplete`, forwarded in both record calls. |
| `open-sse/handlers/chatCore/nonStreamingHandler.js` | logs | +3 −1 | Same, one call site. |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` | logs | +58 −2 | The dump field added to the local `ctx`, which is spread into both record calls. Then `reqLogger` in the signature and five calls through it — stage 5 once per branch, stage 7 once before each of the three returns. Mostly the docblock explaining why. See [The third response path](#the-third-response-path). |
| `open-sse/utils/requestLogger.js` | logs | +26 −18 | `maskSensitiveHeaders` enabled and applied at all four write sites. |
| `src/lib/db/repos/requestDetailsRepo.js` | logs | +24 | Stores the dump directory *name* as `logDir`; copies `stream` to the top level of the record. |
| `src/lib/db/repos/settingsRepo.js` | logs | +9 −1 | `enableObservability` defaults to `true`; new `requestLogsMaxSessions`. |
| `src/dashboardGuard.js` | logs, locks | +29 | `/api/logs` and `/api/locks` added to `LOCAL_ONLY_PATHS`. Mostly comment: the `/api/locks` entry records what the guard does *not* cover. |
| `src/app/(dashboard)/dashboard/usage/page.js` | logs | +7 −1 | Registers the tab under the key `inspector`. |
| `src/sse/services/auth.js` | locks | +47 −3 | `markAccountUnavailable` reads settings once and routes two of its three cooldown branches through the resolver. The whole runtime footprint of configurable durations. Since `v0.5.59` the `resetsAtMs` branch also carries upstream's antigravity carve-out, which skips the cap rather than the resolver — the conflict landed exactly here, so the resolution is commented in place. The settings read is wrapped in `try`/`catch` rather than `.catch()`, which two upstream tests depend on — see `tests/unit/github-monthly-usage-lock.test.js` in "What upstream can break". |
| `src/app/(dashboard)/dashboard/profile/page.js` | locks | +6 | One import, one render line for `LockDurationsCard`. |
| `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` | locks, conntest, tokenstat | +72 −1 | Two buttons — Unlock (conditional) and Test — plus `onResetLock`, `onTest`, `testBusy` and the local `resettingLock` state. Then one `tokenStatus` prop and one `<TokenStatus>` line in the info column. |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | locks, conntest, tokenstat | +75 −1 | `handleResetConnectionLock`, `handleTestConnection`, and the three props. Both handlers end in `fetchConnections()`, because both routes write row fields beyond the one the button displays. `handleRunOneByOneTest` is untouched. Then the `tokenStatuses` state, a fifth entry in `fetchConnections`'s `Promise.all`, and one more prop. |
| `src/sse/services/tokenRefresh.js` | tokenstat | +60 | `recordRefreshAttempt`, called from both branches of `checkAndRefreshToken`. The whole runtime footprint of the feature. Upstream's `if` condition line is untouched. |

## Rules that outlive a feature

Constraints that apply to anything this fork adds next, not just to the feature that
discovered them. Read these before designing a feature, not while merging one.

- **A fork route that mutates anything gets its own `/api/<name>` prefix.**
  `LOCAL_ONLY_PATHS` in `src/dashboardGuard.js` is matched with `pathname.startsWith`,
  so a path whose distinguishing segment sits in the middle cannot be listed there at
  all. `/api/providers/<id>/reset-lock` would have been unguardable: the only prefix
  that covers it is `/api/providers`, which would lock the entire provider API to
  loopback. The route went to `/api/locks/reset` for that reason, exactly as the logs
  endpoints went under `/api/logs`. Naming a fork route after the upstream resource it
  touches instead of after the fork feature is how a mutating endpoint ends up outside
  the guard while every static check still passes.

- **Reach the database through `@/lib/db/index.js`, never `@/lib/localDb`.** The second is
  a re-export shim over the first and says so in its own opening line — "kept for backward
  compatibility with existing imports" — so a fork file routed through it inherits a
  retirement this fork has no say in, in exchange for no behaviour at all. Both spellings
  resolve to the same functions, which is what makes the wrong one invisible: nothing
  fails, no check can see it, and the house convention is the shim by a wide margin, so a
  new file drifts there by default. The exception is an upstream file the fork only edits:
  `src/sse/services/auth.js` keeps upstream's `localDb` import, and the `getSettings()`
  call the `locks` feature added rides on it — changing that line would fork a line for
  nothing and would desynchronise it from the specifier
  `tests/unit/github-monthly-usage-lock.test.js` mocks.

- **Export only what another file imports.** A policy module's export list is the only
  statement of its contract, so a name exported for nobody makes the contract unreadable
  and invites a second caller into an internal that was never designed for one. Keep the
  helpers file-local and say so where it is not obvious — `deriveStreamingOutcomeFromRecord`
  in `src/lib/requestLogsFs.js` carries a "Not exported: callers should go through
  `resolveOutcome`" line because the precedence it omits is the whole reason. Nothing
  enforces this: lint accepts an unused export, and the count in the inventory does not
  look at export lists. It has to be read off the importers, which is one grep per name.

- **Never copy an upstream numeric constant into `DEFAULT_SETTINGS`.** Store nothing,
  and resolve an absent value to the imported constant instead. A copied number is a
  second source of truth that goes wrong silently the moment upstream retunes the
  original, and no check in this file can catch it — the value stays plausible. This is
  what `src/lib/lockPolicy.js` does for all six of its keys, and it is also why
  `requestLogsMaxSessions` is the exception rather than the pattern: that key has no
  upstream counterpart to disagree with. The useful side effect is that an install which
  never opens the new UI behaves exactly like upstream, and "clear the field" becomes the
  reset-to-default gesture with no extra code.

- **Treat any new field on a stored record as public.** Two record types are affected and
  both leak the same way, through a route that spreads the whole record and blanks a fixed
  list of secrets:

  | Record | Published by | Blanks only |
  | --- | --- | --- |
  | `requestDetails` | `src/app/api/usage/request-details/route.js` | `request`, `providerRequest`, `providerResponse`, `response` |
  | `providerConnections` | `src/app/api/providers/route.js` | `apiKey`, `accessToken`, `refreshToken`, `idToken` |

  Neither route is in `LOCAL_ONLY_PATHS`, and `isAuthenticated()` passes everyone when
  `requireLogin` is off, so everything not on those two blank lists is served to anyone who
  can reach the dashboard. Adding a field is therefore not a private act. `logDir` stores a
  bare directory name instead of an absolute path for exactly this reason, and
  `tokenRefreshAttempt` stores a bounded, classified error instead of the provider's
  response body for the same one.

  Weigh any new field against the matching route first, and if it must hold something
  local, reduce it at the single write point — `requestDetailsRepo.js` for the first,
  `tokenRefreshStatus.js` for the second. **The reduction is the whole control, not a
  belt-and-braces measure**: guarding a fork route that only re-serves these fields buys
  nothing, because the record publishes them regardless of what the fork route does.

- **A policy module goes where its imports let it go, and that decides who computes.**
  Two shapes exist in this fork and picking the wrong one is a build-time surprise or a
  bloated client bundle:

  - *Pure and shared*, like `src/lib/lockPolicy.js` — imported by the server and by a
    client component, so its only import is `errorConfig.js`, which itself has none.
  - *Server side, dumb client*, like `src/lib/requestLogsFs.js` with `LogsTab.js`, or
    `src/sse/services/tokenRefreshStatus.js` with `TokenStatus.js` — the module resolves
    everything and the component renders the answer.

  The test is mechanical: **can the module reach the value it needs without importing the
  provider registry, the database or `fetch`?** If not, the second shape is the only
  option, because the alternative is writing upstream's numbers down in client-safe code,
  which the rule above forbids. `tokenRefreshStatus.js` needs `getRefreshLeadMs`, whose
  table is derived from `PROVIDER_OAUTH`, so it could never have been the first shape.

  This also settles where the file lives. A module that needs something from
  `src/sse/services/` belongs in `src/sse/services/`: `src/lib` importing `src/sse` appears
  nowhere in this codebase, and introducing it to save a directory move is how a layering
  rule stops being one.

## What upstream can break

The inventory answers "what did we change?". This answers the question a merge
actually starts from: **upstream touched this file — what of mine does it threaten?**

Pointers only, deliberately. Every claim lives in the section or checklist item named
here, so this table cannot drift out of agreement with anything; it can only fall
behind, which is what the maintenance rule above guards against.

### Files the fork edits

The tag grep finds these on its own. The table adds which check covers them.

| Upstream file | Threatens |
| --- | --- |
| `open-sse/handlers/chatCore.js` and `chatCore/*` | Checklist 1 — the `logDir` thread. **Also the `reqLogger` thread, which no checklist item covers:** `handleForcedSSEToJson` only writes its stages because `chatCore.js` passes `reqLogger` to it by name, and a resolution that drops that argument fails silently — see [The third response path](#the-third-response-path). |
| `open-sse/handlers/chatCore/streamingHandler.js` | Checklist 1, and 6: this file owns the placeholder text the outcome logic compares against |
| `open-sse/utils/requestLogger.js` | Checklist 2 (masking), 4 (session directory naming), 5 (stage filenames), 10 (the `logs/` root) |
| `src/lib/db/repos/requestDetailsRepo.js` | Checklist 7 (`truncateField`) on the write path. Also the read path: `getRequestDetails` does `SELECT data` and parses the whole blob, which is the only reason `logDir` and `stream` arrive with no reader-side code. A projection onto named fields would drop both in silence. |
| `src/lib/db/repos/settingsRepo.js` | Checklist 8 |
| `src/dashboardGuard.js` | Checklist 3 (`/api/logs`) and 16 (`/api/locks`) |
| `src/app/(dashboard)/dashboard/usage/page.js` | Tab registration — the `inspector` key must not collide with upstream's `logs` |
| `src/sse/services/auth.js` | Checklists 11 to 15 — every one of them is about whether the resolver still receives what it expects. This is the one runtime file the `locks` feature edits, so a refactor of `markAccountUnavailable` lands here and nowhere else. |
| `src/app/(dashboard)/dashboard/profile/page.js` | Nothing but the render line for `LockDurationsCard`. If upstream restructures the Settings page into tabs, the card needs a home in the new structure — it is self-contained, so that is a move, not a rewrite. |
| `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` | Both buttons live here. Upstream reworking the action cluster costs the two buttons; upstream renaming `isCooldown` or `connection.lastError` costs the Unlock button's visibility condition, which then either never appears or never hides. The `tokenstat` line is one self-contained element in the info column and moves with whatever that column becomes. |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | Checklist 18. `oneByOneResults` is shared between upstream's one-by-one run and the fork's per-row test, so its `{ state, error }` shape is a contract between them now. Also the `Promise.all` in `fetchConnections`: upstream adding or removing a request there conflicts with the fifth entry, and a botched resolution loses `tokenStatuses` with no error — the status line just stops appearing. |
| `src/sse/services/tokenRefresh.js` | Checklists 19 and 23. The one file `tokenstat` edits at runtime, so a refactor of `checkAndRefreshToken` lands here and nowhere else. Two specific risks: upstream retuning the success condition (`accessToken \|\| apiKey \|\| copilotToken`) silently reclassifies attempts, since the recorded `ok` is decided by which branch ran; and upstream adding an early `return` inside the refresh block skips both `recordRefreshAttempt` calls, which reads as a connection that stopped being refreshed rather than one that stopped being recorded. |

### Files the fork depends on but never edits

**No tag points at these.** This table is their only record.

| Upstream file | Threatens |
| --- | --- |
| `open-sse/config/errorConfig.js` | Checklists 11, 12 and 15. **The single most consequential file for the `locks` feature, and the fork does not touch it.** `lockPolicy.js` imports `BACKOFF_CONFIG`, `COOLDOWN_MS`, `TRANSIENT_COOLDOWN_MS` and `MAX_RATE_LIMIT_COOLDOWN_MS` and uses their values as the *keys* of its remapping, so upstream retuning a number is handled automatically while upstream removing or renaming an export is a build failure. Adding a rule with a new distinct duration is the quiet case: that rule keeps upstream's value and no configured field reaches it. **`COOLDOWN_MS` is the weak link:** upstream marks it backward compat, nothing in `open-sse` actually reads it, and the fork is its only real consumer — so it is the export most likely to disappear. Checklist 12 has the consumer list and the repair. |
| `open-sse/services/accountFallback.js` | Checklists 13, 14 and 17. Owns `getQuotaCooldown`, whose formula `resolveBackoffCooldownMs` mirrors; `checkFallbackError`, whose `newBackoffLevel` field is the only thing distinguishing a ladder duration from a fixed one; and `buildClearModelLocksUpdate`, which the reset route uses so no lock-key naming is duplicated in fork code. |
| `src/app/api/providers/[id]/test/route.js` and `test/testUtils.js` | Checklist 18 — the row button reads `valid` and `error` from this route's JSON. The fork adds no test logic of its own, so every provider quirk in `testUtils.js` shows through unchanged. Worth knowing which: `claude`, `kiro`, `kimi`, `kimi-coding` are `checkExpiry` and `cursor`, `codebuddy-cn` are `tokenExists`, so for those six a green result means "a token exists and has not expired" and nothing reaches the provider. **Also `fetchWithConnectionProxy`'s `AbortSignal.timeout(15000)`, added in `v0.5.59`:** `TEST_TIMEOUT_MS` has to stay above it, so upstream retuning that number upward past 30000 silently makes this fork's deadline the one that fires first. No checklist item covers it — the counts cannot see a number, and both values stay plausible. Read [The timeout](#the-timeout-is-the-only-new-behaviour). **`tokenstat` depends on this file too, through `refreshOAuthToken`:** its `codex`, `grok-cli` and `xai` branches delegate to `refreshProviderCredentials` and so stamp `lastRefreshAt`, which is what lets `isSupersededByLastRefresh` retire a stale record after a Test. Every other branch hand-rolls the token POST and leaves no timestamp, so the recovery does not reach those providers. Upstream moving a branch either way silently widens or narrows that coverage, and nothing counts it. |
| `src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js` | **A divergent copy, deliberately left alone.** It carries its own inner `ConnectionRow` and `CooldownTimer`, duplicated by upstream, and is reached only from `dashboard/media-providers/[kind]/[id]`. Neither the Test nor the Unlock button was added to it, so media-provider connections have neither. Adding them would mean maintaining the same two buttons in two components that already drift. If upstream ever merges the two copies, the buttons come along for free — check that they did. |
| `open-sse/translator/formats.js` | Checklist 4 — a format id containing `_` splits every directory name wrongly. Thirteen ids today and none contains `_`: ten are single lowercase words, three are hyphenated (`openai-responses`, `openai-response`, `gemini-cli`). Read the **values**, not the keys — the keys do use underscores (`OPENAI_RESPONSES`) and never reach a directory name. |
| `open-sse/utils/stream.js` | "How outcome is decided", steps 2 **and** 3 — two separate dependencies in one file. Step 3: it owns all three `[DONE]` append sites, and the fact that the translate path uses none of them is why the terminal-marker list cannot be narrowed to that one string. A new append site on the translate path would not break anything; losing `finish_reason` from the final chunk would. Step 2: it also decides **when `onStreamComplete` fires**, which is the whole basis for treating a non-placeholder body as proof the stream finished. `v0.5.59` moved that from flush-only to a `finalizeStream()` called from three places, deduplicated by a `finalized` flag — read step 2 for which direction of change breaks the signal, because a count cannot see this one. |
| `open-sse/transformer/responsesTransformer.js` | Checklist 9 — `createResponsesLogger` has no callers today; wiring it up puts directories in `logs/` that retention will not touch |
| `src/sse/handlers/chat.js` | Known limitations — its account loop is why rows are per attempt, and why some failures produce no row at all. Also the antigravity bypass in the `locks` known limitations: this file decides whether `markAccountUnavailable` is called at all. |
| `tests/unit/github-monthly-usage-lock.test.js` | **The only upstream test whose module doubles constrain fork code, and the fork does not edit it.** It mocks `@/lib/localDb` with `getProviderConnections` and `updateProviderConnection` only, and Vitest throws on reading an undeclared export of a mocked module. So the `getSettings()` call the `locks` feature added to `markAccountUnavailable` is reached by a mock that does not provide it, and the guard around that call has to survive a **synchronous** throw — `.catch()` on the returned promise does not, because no promise is created. Both of its cases exercise the `githubResetAtMs` branch, which never consults those settings, so the failure looks unrelated to anything configurable. Upstream adding a mocked export changes nothing; upstream adding *another* test that mocks this module and reaches `markAccountUnavailable` is covered by the same guard. Only the test comparison in [Verifying](#verifying) catches a regression here — no checklist item can. |
| `src/app/api/settings/route.js` | Checklist 8 — `PATCH` deletes `PROTECTED_SETTING_KEYS` and lets everything else through. Turning that into an allowlist silently drops `requestLogsMaxSessions` and all six `lock*Ms` keys; the Settings card would keep reporting a successful save while every value reverted to upstream's. |
| `src/app/api/usage/request-details/route.js` | Deliberately untouched — upstream's redaction has to stay as written. Also the reason record fields are treated as public: it forwards everything except the four payloads, and it is not local-only. |
| `src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js` | `LogsTab` carries copies of `getInputTokens`, `getCachedTokens` and `getCacheCreationTokens` from it, on purpose: the two tabs render the same rows, so a different rule in one would show two input-token counts for one request. Change either copy and change both. **Identical logic, not identical text** — `getCachedTokens` and `getCacheCreationTokens` are character-for-character copies, while `getInputTokens` matches only in its executable lines and carries a longer comment here explaining that it is a mirror. So a text diff of the three reports a difference that is not one, and nothing in the checklist can detect a real drift — the numbers stay plausible, they just disagree. |
| `src/sse/services/backgroundTokenRefresh.js` | Checklist 20. **The most consequential file for `tokenstat`, and the fork does not touch it.** `tokenRefreshStatus.js` mirrors it twice over: its four conditions become `isRefreshEligible` plus the `scheduled` flag, and its `Math.max(getRefreshLeadMs(provider), BACKGROUND_REFRESH_LEAD_MS)` becomes `resolveRefreshLeadMs`. Both operands are imported, so upstream retuning `BACKGROUND_REFRESH_LEAD_MS` is handled automatically and removing the export is a build failure. **Read `loadActiveConnections` as well as the selector** — the `isActive` filter lives there, not in `selectConnectionsNeedingRefresh`, and the fork's first version of the mirror missed it for exactly that reason. A fifth condition anywhere in the path is the quiet failure: the sweep skips connections the fork still shows a due time for. Also owns the interval, which is why no time is quoted for it — see the feature's known limitations. |
| `src/sse/services/auth.js` (the credential lookup) | Checklist 20's second half. `getProviderConnections({ provider, isActive: true })` is why `isActive` belongs in eligibility rather than in `scheduled`: a disabled connection is refreshed by neither the sweep nor a request, so there is no honest phrasing for it and the row shows nothing. If upstream ever stops filtering here, a disabled connection becomes refreshable on demand again and the exclusion turns from correct into over-eager. Note this file is already in the edits table for `locks`, but for `markAccountUnavailable` — a different function with a different risk. |
| `open-sse/services/oauthCredentialManager.js` | Checklist 20, and the failure shape behind checklist 22. Owns `getCredentialExpiryMs` (the fork's only expiry reader, and the reason a numeric epoch in seconds or milliseconds both work), `getCredentialLastRefreshMs`, and `mergeRefreshedCredentials` — whose three possible returns are exactly what `buildRefreshAttempt` is written against: `null`, an unrecoverable-error object passed straight through, or merged credentials. A fourth return shape would land in the record as a reasonless failure. **Also the stamping order that `isSupersededByLastRefresh` rests on:** `mergeRefreshedCredentials` takes its `nowMs` before `buildRefreshAttempt` takes its own, so on the covered path `attempt.at` is the later of the two and keeps precedence. If upstream ever made `lastRefreshAt` the later stamp — or let a provider's own value win with a clock ahead of this host's — every successful attempt would be discarded on read and the row would lose its outcome wording while still showing a plausible time. No checklist item can see this; only post-merge step 10 can. |
| `open-sse/services/tokenRefresh.js` and `open-sse/config/appConstants.js` | Checklists 21 and 22. `getRefreshLeadMs` is the per-provider lead, `REFRESH_LEAD_MS` is derived from `PROVIDER_OAUTH` rather than written down, and `isUnrecoverableRefreshError` is the sole source of the "re-authenticate" distinction. Upstream adding a permanent code there upgrades the fork's message with no edit; upstream removing the export is a build failure. Note the derivation is also why this module can never be imported client side — see the policy-module rule above. |
| `open-sse/handlers/chatCore.js`'s 401 block and `open-sse/executors/base.js` | Known limitations — the refresh path `tokenstat` deliberately does not observe. `chatCore.js` calls `executor.refreshCredentials` directly, so the result never passes `mergeRefreshedCredentials` and its failure branch is a `log.warn` and nothing else. If upstream ever routes that block through `checkAndRefreshToken`, the gap closes for free — check whether it did. |
| `src/lib/db/repos/connectionsRepo.js` | Checklist 23. `updateProviderConnection` merges `{ ...existing, ...data }` with no whitelist, which is the only reason `tokenRefreshAttempt` round-trips through the `data` blob without being declared anywhere. `OPTIONAL_FIELDS` is a whitelist in `createProviderConnection` only; extending it to the update path drops the field silently, and the status line reverts to reporting upstream's `lastRefreshAt` with no outcome — a plausible-looking display, not an error. |
| `src/lib/db/index.js` and `src/lib/localDb.js` | How the fork reaches the database. All three fork-added routes import from `db/index.js`; `auth.js` is the only fork-touched file on the `localDb.js` shim, and through upstream's own import line. Retiring or renaming an export on either side is a build failure, the good direction. The quiet direction is a new fork file drifting onto the shim, which is a rule rather than a risk — see the `@/lib/db/index.js` entry in [Rules that outlive a feature](#rules-that-outlive-a-feature). |
| `src/app/api/providers/route.js` | Two ways. It publishes `tokenRefreshAttempt` whether the fork likes it or not, which is what makes the write-point reduction load-bearing (see the record-fields rule). And it blanks `refreshToken`, which is why eligibility cannot be decided in the browser and `/api/token-status` exists at all. Narrowing it to a whitelist would break far more than this feature; widening it to leak `refreshToken` would make the extra route pointless but harm nothing the fork owns. |
| `src/shared/utils/index.js` | `TokenStatus.js` imports `getRelativeTime` from the barrel for past timestamps. Non-ticking and past-only by design, which is why the forward-looking half is formatted locally in that component rather than by a shared helper — there is none. |
| `src/lib/db/backup.js` | Known limitations — `requestDetails` is excluded from backups |
| `.gitignore` | Line 49 `logs/*` is the only thing keeping raw dumps out of version control, and line 52 `docs/*` is why this file sits at the repo root. Lose the first and every dump — full prompts, replies, headers — shows up in `git status`, one `git add .` from being published. Neither line was added by the fork. |
| `src/proxy.js` | Where the guard gets called. `LOCAL_ONLY_PATHS` protects nothing if a request never reaches `dashboardGuard.proxy()` — narrow the routing here and every static check in this file still passes while `/api/logs` and `/api/locks` both answer the world. Only post-merge step 5 catches it. |
| `.env.example` | Ships `ENABLE_REQUEST_LOGS=false`. Copying it over `.env` turns the whole feature off in the quietest way available: no dumps written, and no `requestDetails` rows either, because the variable overrides the `enableObservability` default rather than just gating the dump. The tab goes empty with nothing logged anywhere. See Environment below. |
| `/api/usage/providers`, `/api/provider-nodes`, `/api/providers` | `LogsTab` fetches all three for the provider and account labels. A changed response shape empties those columns with no error anywhere. |
| `src/shared/components/{Badge,Button,Card,Drawer,Pagination}` | `LogsTab` is built from them and depends on their prop contracts. It imports each by its own path — the exception in this codebase, where nearly every dashboard screen goes through the barrel. `Drawer` and `Pagination` are not in the barrel at all, which is why. |
| `src/shared/components/Input` and `src/shared/components/index.js` (the barrel) | `LockDurationsCard` imports `{ Button, Card, Input }` through the barrel, matching the house style and `profile/page.js`'s own import. Two dependencies here, neither visible to the tag grep. The barrel's named exports: dropping `Input` from `index.js` is a build failure, the good direction. And **`Input`'s prop contract, which is the fragile one** — the card passes `inputClassName`, `type="number"`, `min` and `placeholder`. `inputClassName` exists only to reach the inner `<input>`; remove it and the six fields lose their centring with no error anywhere. |
| `src/shared/components/Tooltip` | Wraps the Unlock button in `ConnectionRow.js`. Upstream already uses it in the same cluster for Auto-ping, so it is unlikely to move, but a changed `text` prop would drop the button's only explanation of what it does. |
| `src/shared/utils/cn`, `src/shared/constants/providers` | `LogsTab` imports `cn`, `AI_PROVIDERS` and `getProviderByAlias` |

## Feature: logs

An unredacted view of what actually went to the provider and came back, as a tab
in the dashboard.

### Why it exists

Upstream records per-request observability data and then blanks it before the
dashboard sees it. `src/app/api/usage/request-details/route.js` replaces `request`,
`providerRequest`, `providerResponse` and `response` with `{ redacted: true }` for
every caller, unconditionally — no env var, no setting. That is security commit
`8a527fec`, and its reasoning holds for a shared deployment: any dashboard user, or
anyone at all when `requireLogin` is off, could otherwise read every conversation.
The Details tab still renders all four sections, so it shows `{"redacted": true}`.

This fork is single-user and local and needs that data. It adds a parallel endpoint
and a new tab, and leaves upstream's guard untouched.

### Design

Two sources, each doing only what it is good at:

| | Source | Carries |
| --- | --- | --- |
| List | SQLite `requestDetails` | Indexed on timestamp, provider, model and connectionId — so real paging and filtering. `status` is a filterable column but carries no index. Also the only place with the account, latency, tokens and HTTP status. |
| Payloads | `logs/` directories | Up to seven files across seven numbered stages: the unfiltered client body, the upstream URL and headers, raw SSE frames, stack traces. |

One field joins them: `logDir`, stored on each record. Without it a row could only be
matched to its directory by guessing from model plus a timestamp that differs by the
whole request duration.

**The split is exclusive — the panel renders payloads only from the dump.** SQLite's
four payload fields are near-duplicates of dump stages, and where they differ they are
worse: `providerRequest` is byte-identical to stage 4 without the URL or headers, and
`providerResponse` holds assembled text rather than SSE frames. So
`/api/logs/records` drops them server-side rather than the UI hiding them, keeping
three small values the badges need (`stream`, `errorStatus`, `errorMessage`).

No page size is quoted here on purpose. The saving is `pageSize` × four fields ×
`observabilityMaxJsonSize`, and every one of those is configurable, so a figure would
be true of one configuration and silently wrong about the others. Measure your own if
you need it; what matters structurally is that the four keys are absent from the
response.

A row whose dump is missing gets one plain "No raw dump on disk for this record." line,
with **no fallback rendering**. A second render path would mean a conditional in both
the API and the UI, maintained through every merge, for rows that age out on their own.

Know what that costs at merge time: `/api/logs/records` sets `sessionPath` only when
the dump exists and the panel hides the field when it is null, so **a row that aged out
and a moved logs root look identical in the UI** — no path, one line, nothing to tell
them apart. Diagnose it from the API instead: `logDir` present with `hasLogs: false`
means the row kept its name but the directory was not found, which is checklist 4 or
10 rather than retention. Post-merge step 2 is where that lives.

```
src/app/api/v1/*  →  src/sse/handlers/chat.js  →  open-sse/handlers/chatCore.js
                     (account loop)               (creates reqLogger, writes records)
                                                        ↓
                     logs/<session>/1..7    +    requestDetails row (+ logDir)
                                                        ↓
                     /api/logs/session/[name]   /api/logs/records
                                                        ↓
                                                Usage → Logs tab
```

### The `logDir` bridge — most likely to conflict

`logDir` travels from the logger to the persisted record. Adding it to `sharedCtx`
reaches all four response handlers at once, since each receives that object by spread.
All seven `saveRequestDetail` call sites are covered.

**What gets stored is the directory name, not the path.** `reqLogger.sessionPath` is
absolute, and `requestDetailsRepo` reduces it to its last segment on the way in. Two
reasons, and the second is the one to preserve:

- Nothing needs the path. The panel's path is recomputed from `resolveLogsDir()` so it
  survives a moved working directory; the stored absolute value would be the stale one.
- **An absolute path here escapes the fork.** Upstream's
  `/api/usage/request-details` copies every record field and blanks only the four
  payloads, so whatever else sits on the record is published by a route this fork
  deliberately does not modify — and that route is not in `LOCAL_ONLY_PATHS`, so with
  `requireLogin` off it answers anyone who can reach the dashboard. A full path handed
  out the install directory and the OS user name.

The reduction lives in `requestDetailsRepo.js` rather than at the source in
`chatCore.js`, so it is one line in a file the fork already owns and it normalises
whatever any handler passes. **Keep it as the single normalisation point, and note that
it is load-bearing rather than defensive.** `sessionNameFromLogDir` strips nothing; it
screens the stored value and rejects anything path-shaped, since a name containing `/`
or `\` is a traversal vector. Drop the reduction and every row resolves to `hasLogs:
false` — the tab reports no raw dump anywhere, with no error to explain it, while the
path is also back on the record and back out through
`/api/usage/request-details`.

This is where the fork-wide rule on record fields came from — see
[Rules that outlive a feature](#rules-that-outlive-a-feature).

**`reqLogger` is not in `sharedCtx` and must not be put there.** It travels to each
handler by name at the call site, which is upstream's arrangement, and the reason to keep
it is that the two objects have different lifetimes: `sharedCtx` is built once and spread
into whichever handler wins, while `reqLogger` is created earlier — the two error paths
above `sharedCtx` already use `reqLogger.sessionPath` directly. Moving it in would look
like a tidy-up and would quietly change which of the four handlers can write stages;
[The third response path](#the-third-response-path) is what that costs.

Both `logDir` and the top-level `stream` copy land in the existing `data` JSON blob:
**no migration, no `SCHEMA_VERSION` bump.**

**Why `stream` is copied.** `requestDetailsRepo` clips the four payload fields to
`observabilityMaxJsonSize`, replacing anything larger with a `{_truncated, …}` stub.
Most real conversations clear that cap, so reading the streaming flag out of
`request` yields `undefined` and the badge silently disappears.

**The copy reads `item.request`, the caller's object, not the clipped result — and it runs
after the clipping, not before.** Both live in the same object literal, `request:
truncateField(item.request, …)` above and `stream: item.request?.stream ?? null` below, and
object literal properties evaluate top to bottom. So the only thing making this work is
that `truncateField` returns a new value instead of mutating what it was handed. Checklist
7 is what pins that, and it is the whole guard: if `truncateField` ever starts mutating,
`item.request` is already a `{_truncated, …}` stub by the time this line reads it, `stream`
lands `null` on every long conversation, and the badge disappears with no error.

### The third response path

`chatCore.js` picks one of three response handlers, and **upstream passes `reqLogger` to
only two of them.** `handleForcedSSEToJson` — the path taken when the provider forces
streaming but the client wants JSON — never received it, so every dump it produced
stopped at `4_req_target.json`. The fork passes it now and calls through it five times:
stage 5 once per branch, stage 7 once before each of the three returns.

Left alone, the missing stages were not a cosmetic gap. Two things followed:

- **The response was unreadable.** No stage 5 and no stage 7 on disk, and
  `/api/logs/records` drops the record's payload fields server-side, so for this path
  the panel could show the summary and the request stages and nothing else — the one
  thing the tab exists for was absent.
- **A successful request was badged `Incomplete`.** `deriveOutcome` reads "no
  `7_res_client.*`" as `incomplete`, and step 2 of
  [How outcome is decided](#how-outcome-is-decided) could not overrule it, because that
  step is gated on `response.type === "streaming"` and this handler sets no `type`.
  Reproduced on a `grok-cli` row carrying 133 completion tokens and a 3368 ms ttft.

**Which providers reach it:** any with `forceStream: true` in its registry entry —
`openai`, `codex`, `grok-cli`, `zed`, `codebuddy-cn`, `codebuddy-intl`, `commandcode` —
whenever the client asks for a non-streaming reply. So the affected set is not exotic,
which is why it went unnoticed rather than why it was rare: most clients stream, and a
streamed request takes a different handler.

**Stage 5 holds the assembled body here, not the SSE frames**, and that is a decision
rather than a shortcut. `handleNonStreamingResponse` faces the same ambiguity — its
`text/event-stream` branch also receives frames and returns JSON — and it parses first,
then hands `logProviderResponse` the parsed object. Following it keeps both
JSON-returning paths writing the same pair of `.json` stages, so the `.json`/`.txt`
split still means "how the client was answered". It also keeps the change additive:
`convertResponsesStreamToJson(providerResponse.body)` consumes the stream, so capturing
frames would have meant buffering and replaying it around an upstream line. The cost is in
[Known limitations — logs](#known-limitations--logs): frame-level detail stays the
streaming path's alone.

**What a merge can do to this.** Nothing counts it: `reqLogger` is a plain parameter, and
a resolution that drops it from either the signature or the call site leaves no error
behind — the optional chaining on all five calls is deliberate, so the handler keeps
working and only the stages go missing. The symptom to recognise is the one above: rows
on a `forceStream` provider turning `Incomplete` while the record says the request
succeeded. Post-merge step 2 sees `hasLogs: true` for these rows either way, so it does
not catch it.

### Header masking

`maskSensitiveHeaders` in `open-sse/utils/requestLogger.js` is enabled. Upstream had
disabled it deliberately (`"DISABLED - keep full token for testing"`), writing live
OAuth tokens and API keys to disk in plaintext. The value is replaced wholesale with the
literal string `<redacted>` rather than trimmed to a prefix — a partial token is still a
token, and a short key would survive a length-based rule untouched. The key itself
survives, which is why post-merge step 3 looks for `<redacted>` and not for an absent
field. The helper is applied at **all four** write sites.

`logProviderResponse` is worth knowing about specifically: it is the write site that
never went through the masking helper, even before upstream disabled it. Stage 5 holds
the provider's *response* headers, which can carry `set-cookie`. It is masked now.

**Headers are the only thing masked. Bodies are not, anywhere.** That is the feature, not
an oversight — an unredacted view of what went to the provider is the entire point — but it
bounds what the paragraphs below are claiming. `1_req_client.json`, `2_req_source.json`,
`3_req_openai.json` and `4_req_target.json` hold the full request body verbatim, and
`4_req_target.json` additionally stores the resolved upstream `url`. So a credential passed
in a body rather than a header, a signed or pre-authenticated URL, or a token pasted into a
prompt all land on disk in plaintext with nothing between them and the file. Two practical
consequences: `logs/` deserves the same handling as a credential store (see the `.gitignore`
entry in [What upstream can break](#what-upstream-can-break)), and if upstream ever moves
an auth value from a header into a body, checklist item 2 will keep passing while the leak
returns.

**The write side is the only side that masks.** `requestLogsFs.js` renders each stage
exactly as stored and does not re-mask on read, so what the panel shows is what is on
disk. **Do not add a read-time masking pass.** A reader that rewrote files would make
this view disagree with them, and a second layer invites relying on it instead of on the
write side, which is the only place the guarantee can hold.

The consequence is worth stating plainly: **if masking is ever lost at a write site,
nothing downstream catches it.** Checklist item 2 is the guard, and it is the only
one.

### Access

`/api/logs` is in `LOCAL_ONLY_PATHS` in `src/dashboardGuard.js`. Deny-by-default on
`/api/*` is not enough on its own: `isAuthenticated()` returns true for everyone when
`requireLogin` is false. This also keeps Cloudflare tunnel and Tailscale hosts out.
Remove the entry to allow remote access.

### Settings

`src/lib/db/repos/settingsRepo.js` changes `enableObservability` from `false` to
`true` and adds `requestLogsMaxSessions: 1000`. `settings` is a single JSON blob, so
a new key needs no migration, and `PATCH /api/settings` uses a blocklist rather than
an allowlist, so it passes through with no route change.

**There is no UI for either of these two keys.** They are set once in practice, and a
dashboard control for a value you touch once is not worth the diff. Change them in
`DEFAULT_SETTINGS`, or for a running install:

```
PATCH /api/settings {"requestLogsMaxSessions":5000}
```

**Do not read that as "the Settings page is untouched" — it is not.** The statement above
is scoped to these two keys only: `locks` puts `LockDurationsCard` on the same page, so
the page itself is not byte-identical to upstream. The `locks` feature's own settings do
have a card; see [Feature: locks](#feature-locks).

> **Defaults do not reach an existing install.** `mergeWithDefaults` lets stored values
> win, so an install created before this change keeps `enableObservability: false`.
> Update it once:
>
> ```
> PATCH /api/settings {"enableObservability":true,"requestLogsMaxSessions":1000}
> ```

**Leave `observabilityMaxJsonSize` at upstream's default of 5.** The only stored payload with
any reader is `response`, and both readers cope with a clipped one: `resolveOutcome`
treats it as no signal and falls back to the raw dump (see step 2 of "How outcome is
decided"), and the `errorStatus` / `errorMessage` badges only go null on long successful
replies, which carry no error to report. So a larger cap buys no accuracy. Raising it
stores payloads nobody reads and breaks `unit/request-details-tab.test.js`, whose
truncation case pins a fixture larger than the default against that default — change
the setting and the assertion fails.

### Tab registration

`src/app/(dashboard)/dashboard/usage/page.js` gains an import, `"inspector"` in the
tab allow-list, `{ value: "inspector", label: "Logs" }` in the control, and one
render line.

The key is `inspector`, not `logs`: `logs` already belongs to the pre-existing
`RequestLogger` view, which is in the allow-list and reachable via `?tab=logs` but
absent from the control, so it never appears in the UI. Left as it is.

### Environment

`.env` is gitignored, so this is local only:

```
ENABLE_REQUEST_LOGS=true
```

**Upstream's `.env.example` ships this as `false`.** Recreating `.env` from it — after a
merge, on a fresh clone, or while chasing an unrelated setting — silently disables the
whole feature. Nothing warns you; the tab is simply empty.

It does two things, not one. It enables the `logs/` dump, and
`requestDetailsRepo.js` treats the variable as an override, so it also force-enables
observability recording regardless of the dashboard toggle. Setting it to `false`
force-*disables* recording whatever the UI says. Removing it entirely leaves recording
on (from the setting) but stops the dumps — which is the one configuration where every
row reports no raw dump.

**Write the value as exactly `true`, lowercase.** The two sides parse it differently, and
neither is the fork's code:

| | Reads | How | When |
| --- | --- | --- | --- |
| The dump | `open-sse/utils/requestLogger.js` | `process.env?.ENABLE_REQUEST_LOGS === 'true'` — case-**sensitive** | once, at module load |
| The `requestDetails` row | `src/lib/db/repos/requestDetailsRepo.js` | `envRequestLogs.toLowerCase() === "true"` | re-read every `CONFIG_CACHE_TTL_MS` |

So `ENABLE_REQUEST_LOGS=TRUE` enables recording and *not* the dump: rows appear in the tab
and every one of them reports no raw dump — the same symptom as a broken `logDir` thread
(checklist 1) or a moved logs root (checklist 10), from a cause neither of those checks can
see. `1`, `yes` and `on` are worse still: `!== undefined` is what makes the variable an
override, so any of those force-disables recording *and* the dump while looking like an
attempt to switch the feature on. Diagnose it before checklist 1: if
`/api/logs/records` returns rows whose `logDir` is `null` rather than a name, the writer
never ran, and the value in `.env` is the first thing to read.

Also worth knowing that the dump gate is captured at module load. Changing `.env` needs a
restart for the dump, whereas the recording side picks it up within five seconds — the two
can disagree for that window, and a `.env` edit with no restart leaves them disagreeing
indefinitely.

### How outcome is decided

`requestDetails.status` cannot answer "did this actually work?" for a stream, because
`streamingHandler.js` writes `status: "success"` when the stream *opens*.
`resolveOutcome` in `src/lib/requestLogsFs.js` therefore combines four signals, in
this order:

1. **Explicit error** — `6_error.json` in the dump, or `status === "error"`.
2. **The record's completion markers**, when the record still carries them. A row
   starts life with body `"[Streaming in progress...]"`, `ttft: 0` and zero tokens,
   then gets upserted with real values by `buildOnStreamComplete`'s callback. That
   callback only ever runs once the stream reached its end, which is what makes the
   signal mean anything: a body that is no longer the placeholder, or a non-zero ttft
   or completion count, means the stream finished.

   **What "reached its end" means is upstream's to define, and it changed in `v0.5.59`.**
   `createSSEStream` in `open-sse/utils/stream.js` now collects the usage-and-logging tail
   into a `finalizeStream()` guarded by a `finalized` flag, called from three places rather
   than only the flush: the flush, the flush's own `catch`, and — the new one — `transform()`,
   as soon as an OpenAI Responses terminal event is seen. That third site *fixed* a class of
   false `incomplete` results: a Responses client such as codex CLI closes on
   `response.completed` instead of `[DONE]`, cancelling the reader so flush never ran, and the
   row kept its placeholder. **The `finalized` flag is what keeps the signal honest** — lose
   it and the record is written twice, the second time from a later path, rewriting the row's
   `logDir` and token counts behind the reader.

   **The direction that would break this step is the reverse:** `finalizeStream()` called
   somewhere a terminal event has *not* been seen. Then a stream that died mid-flight gets
   real values written over its placeholder and reads as `ok` here, with steps 3 and 4 never
   consulted.

   **This step is gated on `detail.response?.type === "streaming"` and answers for
   streams only.** `deriveStreamingOutcomeFromRecord` returns `null` for anything else, so
   a non-streaming row can never produce a record signal and always falls through to step
   3 — which is why step 3 is described below as the one that normally answers for those.
   The gate is also the mechanism behind the next paragraph: a clipped `response` has no
   `type` left, so it fails this check rather than being handled by it.

   **This signal drops out for long replies**, and that is by design rather than a
   gap. `requestDetailsRepo` replaces `response` wholesale with a
   `{_truncated, _originalSize, _preview}` stub once it passes
   `observabilityMaxJsonSize` — a setting, defaulting to 5 and multiplied by 1024, so
   5120 characters of JSON unless this install changed it — leaving no
   `type` for step 2 to recognise, so step 3 answers instead. Know why before
   reordering these steps: a response only grows large enough to be clipped by
   completing, whereas an aborted stream keeps the short placeholder and is still
   read here. Step 2 therefore keeps exactly the case it exists for.
3. **The transcript tail**, which is what normally answers for any row answered with
   JSON: `7_res_client.json` exists, or a terminal marker appears in
   `7_res_client.txt`'s tail. Neither `7_*` file present resolves to `incomplete`.

   That last sentence is why this step depends on every response handler writing stage 7,
   and on one of them it did not until the fork passed it a `reqLogger` —
   [The third response path](#the-third-response-path). A handler that returns a body
   without writing stage 7 lands every one of its successful rows here as `incomplete`,
   and step 2 cannot save it, because step 2 answers for streams only.

   **The tail test is `includes`, not "ends with".** `deriveOutcome` reads the last
   `TAIL_PROBE_BYTES` and asks whether any marker appears *anywhere* in that window, so a
   marker echoed inside assistant content — a reply that quotes `[DONE]`, or a tool result
   carrying a `"finish_reason"` field — resolves the row to `ok`. That is the intended
   trade: anchoring to the true end of the file would break on the trailing newline every
   SSE frame ends with, and on the usage-block chunk many providers send last. The
   false-positive direction is the safe one here, since step 1 has already claimed every
   row with an explicit error.
4. **The stored `status`**, and only `"success"` counts. This is the branch that answers
   when there is no dump to read at all — a row whose directory was pruned, or any row
   written while `ENABLE_REQUEST_LOGS` was off. Anything else resolves to `unknown`.

   Both remaining branches report `source: "record"`, so the badge tooltip cannot tell
   them apart from step 2. That is deliberate: this is the weakest signal in the chain,
   because `streamingHandler.js` writes `status: "success"` at stream open, so a stream
   that died mid-flight and lost its dump reads as `ok` here. Steps 1 to 3 exist to keep
   that case from reaching this branch; it only fires once the dump is gone.

For step 3, a terminal marker is `[DONE]`, `response.completed`, `message_stop`, or a
non-null `finish_reason` / `finishReason` (`FINISH_REASON_RE`). The probe reads
`TAIL_PROBE_BYTES` from the end of the file — 8 KB today, sized so a large final chunk
still fits whole.

**Do not narrow that list to `[DONE]`, and know the actual reason.**
`open-sse/utils/stream.js` has three sites that append the sentinel, and a plain OpenAI
chat-completions stream on the translate path hits none of them:

- two of the three are gated on `keepsOpenAIResponsesFormat`, i.e. Responses API in *and*
  Responses API out;
- the third is the terminator at the end of the `STREAM_MODE.PASSTHROUGH` branch of
  `flush`, guarded by `!streamDoneSent && !isGeminiFamily`. This is the only site the
  Gemini-family guard covers, and the branch `return`s before the translate path runs.

So the translate path never appends `[DONE]` at all, whatever the provider — the last chunk
carries `"finish_reason":"stop"` and a usage block instead, and `FINISH_REASON_RE` is what
catches it. `!isGeminiFamily` guards the passthrough site alone, so it is the wrong
mechanism to reach for here.

### Deliberately untouched

- **`src/app/api/usage/request-details/route.js`** — upstream's redaction stays as
  written. Do not "fix" it; the parallel route is the whole point. The consequence of
  leaving it alone is a fork-wide constraint, not a logs one:
  [Rules that outlive a feature](#rules-that-outlive-a-feature).
- **`src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js`** and the
  Details tab — unchanged, still redacted.
- **`src/app/(dashboard)/dashboard/usage/components/RequestLogger.js`** and the hidden
  `?tab=logs` view.
- **`streamingHandler.js`'s hardcoded `status: "success"`** — worked around in
  `resolveOutcome` rather than patched.
- No table, column, index or `SCHEMA_VERSION` change anywhere.

### Known limitations — logs

- **One row per attempt, not per client request.** `saveRequestDetail` runs inside
  `chatCore`, which the account loop in `src/sse/handlers/chat.js` calls once per
  attempt. Account A failing then B succeeding produces two rows; combo fallback to
  another model likewise. A 401/403 token-refresh retry does not, since it replaces
  the response in place. Nothing correlates the rows of one client request — upstream
  has no request id.
- **Some failures produce no row at all.** `chat.js` returns before `chatCore` runs on
  `!credentials || credentials.allRateLimited`, which covers missing credentials **and
  the case you will actually hit: every account rate limited.** Both surface as "All
  accounts unavailable" and neither leaves a trace in the Logs tab, so a provider that
  has locked you out looks like no traffic rather than failed traffic. The SSE and JSON
  parse failures in `nonStreamingHandler.js` only call `appendLog`.
- **Chat endpoints only.** `/v1/models`, embeddings and similar never write
  `requestDetails`.
- **The stored payloads are near dead weight.** Only `response` is read at all, by two
  callers: `resolveOutcome`, while it fits under the cap, falling back to the dump
  once it does not; and `/api/logs/records`, for the `errorStatus` and `errorMessage`
  badges. `request`, `providerRequest` and `providerResponse` have no reader. Anything
  past the cap is clipped to a short preview, so the waste is trivial. Removing the
  three entirely would mean not storing them at all — a deeper change to an upstream
  file for no visible gain.
- **Read-time truncation.** A stage file over `MAX_FILE_BYTES` (2 MB) renders as its
  first 2 MB with a badge and the filename; the dump directory path in the panel is
  how you read the rest. Nothing *inside* a file is ever filtered out — a raw view
  that hid fields would be lying about the file.

  A file past the cap also comes back as raw text rather than parsed JSON, since its
  first 2 MB will not parse. Nothing is masked or rewritten either way, so the two
  paths agree on what they show; they differ only in whether the panel gets a JSON
  tree or a text blob.
- **Frame-level detail is the streaming path's alone.** Stage 5 holds individual SSE
  frames only when the client was streamed to. The two handlers that answer with JSON
  both record the assembled body instead, so on a `forceStream` provider answering a
  non-streaming request you get the provider's reply and its headers but not the frames
  that carried it — no per-delta timing, no reasoning deltas, no separate usage frame.
  `handleNonStreamingResponse` has always behaved this way; `handleForcedSSEToJson`
  matches it deliberately, see [The third response path](#the-third-response-path).
  Recovering the frames would mean buffering and replaying a stream upstream hands
  straight to its converter.
- **Outcome filtering narrows the current page only.** It is derived per row, partly
  from the filesystem, so it cannot be a SQL predicate. The UI says so under the
  control.
- **Stage count varies per row, one to seven**, because a file exists only if that step
  ran. The panel lists what is on disk rather than padding out absent stages.

  | Stage file | Written when |
  | --- | --- |
  | `1_req_client.json` | only `if (clientRawRequest)` |
  | `2_req_source.json` | unconditionally — the floor |
  | `3_req_openai.json` | the OpenAI pivot path only, from `translator/index.js` |
  | `4_req_target.json` | *after* `executor.execute()` returns, inside the same `try` |
  | `5_res_provider.json` / `.txt` | `.json` when the client is answered with JSON, `.txt` when streamed |
  | `6_res_openai.txt` | translated streams, from `open-sse/utils/stream.js` |
  | `6_error.json` | `chatCore.js`'s `if (!providerResponse.ok)` block |
  | `7_res_client.json` / `.txt` | the same `.json`/`.txt` split as stage 5 |

  **`STAGE_FILES` lists ten names and no row reaches ten**, for two reasons beyond the
  conditionals above. The stage 5 and 7 variants are mutually exclusive, and **the split is
  by how the client was answered, not how the provider replied** — `handleNonStreamingResponse`
  and `handleForcedSSEToJson` both write `.json`, the second after reading SSE frames to get
  there, and only `handleStreamingResponse` appends `.txt`. And **`6_res_openai.txt` and
  `6_error.json` cannot coexist**, which caps the total at seven rather than eight:
  `reqLogger.logError` has exactly one call site, inside that `!ok` block, which `return`s
  immediately, while `appendOpenAIChunk` runs only once that return has been passed. So a
  translated stream dying mid-flight leaves `6_res_openai.txt` and **no** `6_error.json`.

  The floor follows from stage 4 being conditional: the `catch` around `executor.execute()`
  saves a row without reaching it and without calling `logError`, so such a row can hold
  `2_req_source.json` alone.

  **Five to seven is the band for a request the provider answered *successfully*, not one
  that merely reached it.** A non-2xx answer writes four — stages 1, 2, 4 and `6_error.json`
  — or five on the pivot path, because that `!ok` block returns without ever calling
  `logProviderResponse`. **So read stage 4 rather than the total:** its presence means the
  provider was reached whatever the count, and judging by the count reads the most common
  row in the tab, a failed upstream call, as "never left the router".

  Checked by reading rather than counting — `git grep -n
  "reqLogger.logError\|appendOpenAIChunk" -- open-sse` returns both write sites and their
  call sites, and the question is whether any call site of the second is reachable after the
  first has run.
- **`logs/` follows `process.cwd()`, not `DATA_DIR`** — matching the upstream writer.
  A packaged CLI with a different working directory reads a different tree. Checklist 10
  guards the pairing.
- **Visible lag.** Settings sit behind a 5-second config cache (`CONFIG_CACHE_TTL_MS`)
  and records flush in batches of 20 or every 5 seconds, so new rows trail slightly.
- **Retention only runs when you look at it.** It hangs off `/api/logs/records`, and
  **the tab does not poll** — it fetches on mount and whenever a filter, page or
  refresh changes the URL. `PRUNE_THROTTLE_MS` (5 minutes) is a floor between runs, not
  a period, so the honest statement is the pessimistic one: with the Logs tab closed,
  nothing prunes, however long you wait. There is no scheduler and no manual trigger.

  Two consequences worth having straight. **Lowering `requestLogsMaxSessions` takes
  effect on your next visit to the tab, not after five minutes** — open it, and if you
  were there within the last five minutes, wait out the throttle or restart, since the
  throttle is module state and a restart clears it. And `logs/` can grow well past the
  limit during a stretch where you are not watching; the limit is a high-water mark
  applied on the next look, not a live ceiling.

  For a disk budget, measure rather than trust a figure — `du -sh logs/` divided by the
  directory count gives your own average, and multiplying by `requestLogsMaxSessions`
  gives the ceiling. Any number written here would be an artefact of one workload;
  directory size tracks prompt size almost linearly, because the same request body is
  written up to **five** times per attempt: `1_req_client.json`, `2_req_source.json`,
  `3_req_openai.json`, `4_req_target.json`, and again inside `6_error.json`'s
  `requestBody` field. Three of those land on any attempt that reaches the provider;
  stage 3 only on the pivot path, and the error copy only on failure. That multiplier is
  the part worth knowing; the megabytes are not.
- **A second writer shares `logs/`.** `createResponsesLogger` in
  `open-sse/transformer/responsesTransformer.js` creates
  `responses_<model>_<timestamp>_<uniqueId>` directories, and the legacy `logError` in
  `requestLogger.js` writes `<provider>-<date>.log` files. Neither name parses as a
  session, so retention leaves both alone by design — pruning only touches directories
  it can positively identify. `createResponsesLogger` has no callers today; if upstream
  wires it up, those directories accumulate unmanaged. Checklist 9 watches for that.
- **`requestDetails` is excluded from DB backups** (`src/lib/db/backup.js`), by
  upstream design. Raw dumps are not backed up either.

## Feature: locks

Upstream's account cooldowns, made configurable from the Settings page, plus a per
connection button to release them.

### Why it exists

Two separate complaints, one mechanism.

The durations are short and hardcoded. The first rate-limit step is 2 seconds, and the
branch that fires most often — every unmatched error, so all of 500, 502, 503, 504 and
every network failure — is 30 seconds. Against subscription-backed OAuth providers on a
single-user install, retrying an account that fast is a way to attract the provider's own
abuse detection rather than a way to recover.

And a lock could not be released. Nothing clears one but a genuinely successful request
through that account, `backoffLevel` never decays and is stored, so an account that
failed repeatedly keeps its rung across restarts. The only existing control,
`clearCooldown` on `/api/models/availability`, is scoped to provider plus model and
clears that key across every connection of the provider — not something to put behind a
button on one connection's row.

### Design

The durations live in `open-sse/config/errorConfig.js` and are consumed by
`checkFallbackError`, a pure synchronous function inside a provider-agnostic engine with
no database access. Settings are async and app-side. So the engine cannot read them, and
teaching it to would mean handing the routing engine a database connection.

Instead: **leave `open-sse/` completely alone and remap the computed duration inside
`markAccountUnavailable`** in `src/sse/services/auth.js`, which every modality handler
routes its failures through — it already imported `getSettings`, it already held the only
reader of `MAX_RATE_LIMIT_COOLDOWN_MS`, and it performs the single
`updateProviderConnection` write that stores the lock.

**It is not quite every cooldown path, and the exception arrived in `v0.5.59`.** An
antigravity quota block never reaches this function at all: `src/sse/handlers/chat.js`
hard-codes `shouldFallback` and skips the call when `handleAntigravityQuotaError` comes back
with a `resetAt`, so no configured duration is consulted and no `modelLock_*` is written.
That is the third bullet of [Known limitations — locks](#known-limitations--locks), and it
is the one gap in
the "one convergence point" premise — everything else in this section still rests on it.

Its three branches are treated differently, on purpose:

| Branch | Source | Treatment |
| --- | --- | --- |
| GitHub monthly exhaustion | absolute date, 1st of next UTC month | **Not resolved.** Not a duration from the rules table, and upstream leaves it uncapped deliberately. |
| Provider-reported reset (`resetsAtMs`) | the provider's own reset time | Clamped by `resolveProviderResetCapMs`. In practice only `executors/codex.js` feeds this. |
| The rules table | `checkFallbackError` | Duration replaced by `resolveLockCooldownMs`. Upstream still decides which rule fires, whether to fall back, and the next backoff level. |

`src/lib/lockPolicy.js` holds the whole policy and is pure — no imports beyond
`errorConfig.js`, which itself has none, so the same module is imported by the server and
by the Settings card without pulling anything server-only into the client bundle.

### The remapping — most likely to conflict

Two properties carry the design, and both are worth recognising in a diff:

**The remapping keys are the imported upstream constants, never literals.** The map is
built from `COOLDOWN_MS.unauthorized`, `COOLDOWN_MS.requestNotAllowed` and
`TRANSIENT_COOLDOWN_MS`, so upstream retuning any of those keeps the mapping correct with
no edit here. It also means removing or renaming one of those exports is a **build
failure** rather than a silent wrong value — the loud direction, deliberately.

**Anything unrecognised passes through unchanged.** A rule upstream adds with a fourth
distinct duration keeps upstream's value instead of picking up an unrelated configured
field. That is the quiet failure mode of this design and checklist 11 is what surfaces it.

Three things upstream owns that the resolver depends on:

- **`newBackoffLevel` is set only on backoff rules.** It is the sole signal separating a
  ladder duration from a fixed one; `checkFallbackError` returns it from its two `backoff:
  true` branches and nowhere else. If it ever came back on every rule, every fixed
  cooldown would be recomputed as a ladder value. Note that the other two branches in
  `markAccountUnavailable` also assign a variable of that name — they set it to `0`, which
  is why those branches are resolved separately and never routed through the resolver, and
  why the resolver additionally requires the level to be at least 1.
- **The three mapped constants hold three different numbers.** If two ever became equal
  the map would collapse and one category would silently take the other's configured
  value. `buildFixedCooldownMap` drops colliding entries instead, so both fall through to
  upstream's own duration — wrong in a way that matches upstream rather than wrong in a way
  nobody asked for.
- **`getQuotaCooldown`'s `level - 1` offset.** `resolveBackoffCooldownMs` mirrors it,
  because upstream stores the level and the two formulas have to agree on what a stored
  level means.

### Settings

Six keys, all optional overrides:

`lockBackoffBaseMs`, `lockBackoffMaxMs`, `lockAuthCooldownMs`, `lockShortCooldownMs`,
`lockTransientCooldownMs`, `lockProviderResetCapMs`.

**None of them appears in `DEFAULT_SETTINGS`, and that is the point** — see
[Rules that outlive a feature](#rules-that-outlive-a-feature). An unset key resolves to
the imported upstream constant, so an install that never opens the card is byte-identical
to upstream in behaviour, and clearing a field is the reset-to-default gesture.
`PATCH /api/settings` is a blocklist, so the keys need no route change; checklist 8 is
what watches that.

Zero, negative, empty and non-numeric values are all rejected and fall back to the
upstream constant. A zero cooldown would write a lock that has already expired, which
reads as no lock at all and would quietly disable the backoff this feature exists to
lengthen. There is no validation message — the field simply has no effect.

The card stores milliseconds and displays seconds. `msToSeconds` and `secondsToMs` live in
`lockPolicy.js` so the resolver and the UI cannot drift on the unit.

**`BACKOFF_CONFIG.maxLevel` is deliberately not exposed.** It caps the stored counter,
not the duration, and `lockBackoffMaxMs` already caps the duration — so it only becomes
the effective ceiling when `lockBackoffMaxMs > lockBackoffBaseMs * 2^(maxLevel - 1)`. In
every other configuration it would be a control that does nothing. No number is quoted
here because that threshold moves with the configured base.

### The reset route

`POST /api/locks/reset`, body `{ connectionId }`.

**A new route was unavoidable.** `PUT /api/providers/[id]` destructures a fixed set of
fields — `name`, `priority`, `globalPriority`, `defaultModel`, `isActive`, `apiKey`,
`testStatus`, `lastError`, `lastErrorAt`, `providerSpecificData` — so `modelLock_*` and
`backoffLevel` cannot travel through it. Anything sent there is dropped without an error.

It clears the locks with upstream's own `buildClearModelLocksUpdate`, which enumerates by
prefix off the record rather than from a fixed list, so no lock-key naming is duplicated in
fork code and a key this route has never heard of is still cleared. On top of that it
applies the same reset block as `clearAccountError`: `testStatus`, `lastError`,
`errorCode`, `lastErrorAt`, `backoffLevel`. Clearing only the locks would leave the row
showing `unavailable` and its error text until a real request succeeded, and would leave
`backoffLevel` in place so the next failure resumed the ladder mid-climb.

The response is `{ ok: true }` and deliberately carries no count. The caller re-reads the
connection list to redraw the row, so a number would have had no reader, and the only count
worth reporting — how many locks were actually *released* — is not what a scan of the record
measures: expired `modelLock_*` keys sit on it until something clears them and this route
clears them too, so any such figure mixes live cooldowns with stale keys. Post-merge step 7
checks the five reset fields on the record instead, which is exact.

The `/api/locks` prefix is a guard requirement, not a preference — see the fork-wide rule.
`/api/locks` is in `LOCAL_ONLY_PATHS`, and deny-by-default does not cover it while
`requireLogin` is off.

**Be precise about what that entry buys, because the fork's reach here is asymmetric.**
`/api/settings` is *not* on that list, so a caller who can PATCH it can set the six
durations to a second each and neuter the backoff without ever touching `/api/locks`. This
entry is therefore not what stands between an attacker and the cooldowns. What it does
cover is the part the settings route cannot reach: releasing locks that already exist,
immediately, leaving no configuration trace.

`/api/settings` was left off deliberately — listing it would lock a large upstream surface
to loopback and change upstream behaviour well beyond this feature. And the exposure is
upstream's, predating the fork: with `requireLogin` off, `PUT /api/providers/<id>` already
lets a LAN caller swap an API key or delete a connection outright. The fork did not widen
that surface; the point of this paragraph is only that the guard should not be described as
more load-bearing than it is.

### Deliberately untouched

- **`open-sse/config/errorConfig.js` and `open-sse/services/accountFallback.js`** — no
  edits. Every value and every classification rule stays upstream's. Changing the numbers
  there would have been the obvious move and the wrong one: it hands the fork a permanent
  conflict in two files and loses upstream's future retuning.
- **`checkFallbackError`'s signature** — an optional overrides parameter was considered
  and rejected. `ERROR_RULES` stores resolved numbers rather than symbolic names, so
  overriding a category by name would have meant restructuring the rules table itself.
- **`src/lib/db/repos/settingsRepo.js`** — untouched by this feature. The `logs` entries
  there are unrelated.
- **`/api/models/availability`** — its provider-plus-model `clearCooldown` action and the
  `ModelAvailabilityBadge` UI are left as upstream wrote them. That is where per-model
  release lives; this feature's button is per connection.

### Known limitations — locks

- **A saved value does not shorten a lock already written.** The duration is baked into
  the `modelLock_*` timestamp at write time, so a new value applies to the next failure and
  changes nothing about locks already on the record. The Unlock button is the way to
  release those.

  There is **no delay beyond that**. `settingsRepo.getSettings()` is uncached — a fresh
  `SELECT` and JSON parse per call — so the next failure reads the new value. **The
  5-second cache in this codebase is not a lock delay:** `CONFIG_CACHE_TTL_MS` lives in
  `src/lib/db/repos/requestDetailsRepo.js` and caches `getObservabilityConfig()` on the
  record-writing path, with nothing to do with the lock durations. Do not add a cache to
  close the gap between them.
- **GitHub's monthly exhaustion ignores every setting**, including the provider reset
  cap. It locks the whole account until the 1st of the next UTC month.
- **Antigravity quota exhaustion bypasses this feature entirely, as of `v0.5.59`.** It is
  the only path that escapes *both* halves of `locks`, so it is worth knowing precisely
  when it fires. In `src/sse/handlers/chat.js`, a 409 or 429 from antigravity calls
  `handleAntigravityQuotaError`, and if that comes back with an exhausted model carrying a
  future `resetAt`, `markAccountUnavailable` is **never called**. Two consequences, neither
  of them an error anywhere:

  - No configured duration is consulted, because the whole runtime footprint of
    configurable durations lives inside that one function.
  - No `modelLock_*` is written, so the Unlock button has nothing to clear. The block is a
    module-level `Map` in `src/sse/services/antigravityQuota.js`, read by `auth.js`'s
    pre-filter, and it ends only when the upstream `resetAt` passes or the process
    restarts. **The button still renders** if `connection.lastError` or `isCooldown` says so
    on an active connection, and clicking it will report success while the account stays
    blocked.

  The fall-through is the case that still works: when the quota call fails, or the model
  is not actually exhausted, `handleAntigravityQuotaError` returns `null` and the normal
  `markAccountUnavailable` path runs with configured durations intact.

  **The two files disagree about what counts as antigravity, and it is upstream's
  inconsistency, not the fork's.** `chat.js` tests the raw `provider === "antigravity"`
  while the `resetsAtMs` branch in `auth.js` tests `resolveProviderId(provider)`. An alias
  that resolves to antigravity therefore takes the ordinary lock path in `chat.js` while
  `auth.js` leaves its cooldown uncapped — a lock as long as the provider asks for, with
  the configured cap not applied. If upstream ever aligns the two, re-read this bullet.
- **A provider-reported reset time still bypasses the ladder.** Only the cap applies, so
  if Codex says a minute, the lock is a minute however large the ladder's first step is
  set. Lowering the cap is the only control over that path.
- **Unlock is all-or-nothing per connection.** It clears every model's lock on that
  connection, not a chosen one. Per-model release already exists in
  `ModelAvailabilityBadge`, and a second per-model control would have meant two ways to
  do the same thing.
- **No Unlock button on media-provider connections.** They render through the divergent
  `ConnectionsCard` copy — see "What upstream can break".
- **The action cluster wraps on narrow screens.** `ConnectionRow.js` lays the buttons out
  as `grid-cols-3` below the `sm` breakpoint and only switches to flex above it. Upstream
  had at most four buttons there (Proxy, Auto-ping, Edit, Delete); Unlock and Test take it
  to six, so on a phone the cluster becomes two rows, and at five buttons the second row is
  a cell short. Cosmetic only, and it is the reason to keep Unlock conditional rather than
  always rendered.
- **The button returns 403 over a tunnel or Tailscale**, because `/api/locks` is
  loopback-only. The row simply does not change; there is no message.
- **Free, no-auth providers are never locked at all**, so nothing here applies to them.
  `markAccountUnavailable` returns early for `connectionId === "noauth"`.

## Feature: conntest

The existing Test Connection action, surfaced on each row of the Connections list.

### Why it exists

Testing one connection meant opening its Edit modal — two clicks and a dialog — and the
only list-level option was "Test Connection One-by-One", which walks every connection in
sequence with a delay between each. There was no way to re-test the single account you
had just fixed.

### Design

**No test logic was written.** `POST /api/providers/<id>/test` already tests exactly one
connection and already returns `{ valid, error, refreshed }`. The row button calls it
through `src/shared/utils/connectionTest.js` and writes the outcome into the page's
existing `oneByOneResults` state, so the badge beside the connection name renders it with
no second display path — `getOneByOneVariant` and `getOneByOneLabel` in `ConnectionRow.js`
are upstream's and were not modified.

The button is disabled while a one-by-one run is in progress, since both write the same
state. **The guard is one-directional and that is a known gap**, not a claim: a per-row test
does not set `oneByOneRunning`, so starting a bulk run while one is in flight lets the single
result land in the loop's map after `setOneByOneResults` has reset it. Cosmetic and
self-correcting once the loop reaches that row — listed under
[Known limitations — conntest](#known-limitations--conntest).

**`handleTestConnection` ends with `await fetchConnections()`, and the badge is not what
needs it.** The route writes four things the row already displays from `connections`:
`testUtils.js` sets `testStatus`, `lastError` and `lastErrorAt`, and the
`refreshProviderCredentials` call inside it stamps `lastRefreshAt`. Without the refetch the
status badge, the red `lastError` text, the Unlock button's visibility and the whole
`tokenstat` line all keep pre-test state. The token line is the one that misleads rather than
merely lagging: a connection with a failed refresh shows a green `success` badge beside a red
"re-authentication needed" that the test just invalidated — the staleness
`isSupersededByLastRefresh` resolves server side and nothing was asking the server about. See
[The two branches](#the-two-branches--most-likely-to-conflict) for that resolution.

Upstream's one-by-one loop does not refetch, and that is upstream's to keep rather than a
precedent to copy: the fork's other new button in this row, Unlock, refetches for the same
reason, and the `tokenstat` correctness argument assumes a refetch happens.

**`handleRunOneByOneTest` is deliberately not refactored.** Routing that loop through the
same helper would remove upstream's duplicate `fetch`, and it was left in place anyway:
the duplication is upstream's and upstream maintains it, whereas rewriting that function
would put it on the merge-conflict surface for no visible gain.

### The timeout is the only new behaviour

`TEST_TIMEOUT_MS` in `connectionTest.js` is one deadline covering every provider, on the
client, without touching upstream. That trade is the reason the helper exists at all rather
than the fetch being inlined into the handler.

**`v0.5.59` added a server-side deadline, and it does not replace this one.**
`fetchWithConnectionProxy` in `testUtils.js` now defaults `options.signal` to
`AbortSignal.timeout(15000)`, and no call site overrides it, so every individual
server-side fetch is bounded. The bound is **per fetch, not per request** — one test can
make several in sequence, and neither `testUtils.js` nor `route.js` races a deadline for
the response as a whole, so the row can still spin past 15s without this deadline.

**`TEST_TIMEOUT_MS` has to stay above 15000**, and the ordering is the point rather than
the values. A stalled provider trips upstream's per-fetch bound first, which returns
`{ valid: false, error }` with the provider's own failure, and the row shows that. Set
`TEST_TIMEOUT_MS` below 15000 and it pre-empts upstream every time, replacing each of
those real errors with `No response within Ns` — no error anywhere, just a less useful
message on exactly the failures the feature exists to diagnose.

### Known limitations — conntest

- **The timeout is client-side only.** Aborting the fetch does not stop the server-side
  probe. What it bounds is the spinner, not the work. Since `v0.5.59` the work is bounded
  too, but by upstream and per fetch rather than per request — see
  [The timeout](#the-timeout-is-the-only-new-behaviour).
- **For six providers a green result does not mean the provider was contacted.**
  `claude`, `kiro`, `kimi` and `kimi-coding` are `checkExpiry` in `OAUTH_TEST_CONFIG`, and
  `cursor` and `codebuddy-cn` are `tokenExists`, so the test reads a stored expiry or the
  presence of a token and nothing leaves the machine. No per-provider handling was added
  for this on purpose — it would mean fork code tracking upstream's probe table.
- **A failing test can mean a broken proxy.** `testSingleConnection` probes the connection
  proxy first and short-circuits without contacting the provider if it is dead.
- **`lastError` being set does not imply a failure.** A soft success, such as Grok CLI's
  402 spending limit, keeps `testStatus: "active"` and puts the warning text in
  `lastError`. The row does show the new value, because the handler refetches.
- **A bulk run started during a row test can show one stale badge.** The guard runs one way
  only: `testBusy` disables every row button during a one-by-one run, but
  `handleRunOneByOneTest` gates on `oneByOneRunning`, which a row test does not set. The
  single result then lands after `setOneByOneResults` has reset the map, so that row's badge
  describes a different test from the summary counters until the loop reaches it. Cosmetic,
  and not worth a second piece of shared state to close.
- **No button on media-provider connections**, same divergent-copy reason as the Unlock
  button.

## Feature: tokenstat

What each connection's token is doing — when it last refreshed, whether that worked, and
when the next refresh is due — as one line inside its row on the Connections list.

### Why it exists

Two of those three questions had no answer anywhere in the UI, and the third had a
misleading one.

**A failed refresh wrote nothing.** `checkAndRefreshToken` in
`src/sse/services/tokenRefresh.js` guards its persistence with
`if (newCreds?.accessToken || newCreds?.apiKey || newCreds?.copilotToken)` and has no
`else`: the result was discarded, the stale credentials were returned, and the only trace
was a log line. The same swallowing happens in `backgroundTokenRefresh.js`
(`"Connection refresh failed (swallowed)"`) and in `chatCore.js`'s 401 block. So a
connection whose refresh token had been revoked kept reporting `testStatus: "active"`
indefinitely — until somebody pressed Test or a real request happened to reach it.

That is not hypothetical. On the install this was built against, the first sweep after the
change recorded an attempt on 365 of 645 connections: 364 succeeded and one failed, and
that one's due time had passed three days earlier. It had been failing every sweep since,
showing green the whole time. Measure your own rather than trusting those numbers:

```
curl -s localhost:20127/api/token-status | grep -o '"ok":[a-z]*' | sort | uniq -c
```

**Upstream's `lastRefreshAt` cannot fill the gap**, for two independent reasons. It is
stamped only on success, so it is silent about exactly the case that matters. And it is
stamped only on the paths that pass through `mergeRefreshedCredentials`, which the two
uncovered paths mostly do not reach: the reactive 401 refresh hands
`executor.refreshCredentials`'s raw result to `onCredentialsRefreshed`, and the Test
button's `refreshOAuthToken` in `testUtils.js` is a per-provider switch whose branches
hand-roll the token POST and return raw `{ accessToken, expiresIn, refreshToken }`. It can
therefore be arbitrarily older than the truth.

**Three of those branches are the exception, and the read side depends on them.** `codex`,
`grok-cli` and `xai` delegate to `refreshProviderCredentials`, so for those the Test button
does stamp `lastRefreshAt` — as do `/api/translator/send`, `/api/usage/[connectionId]`, and
codex login and bulk import. That partial stamping is the only evidence the fork has that
something refreshed a token behind its back, and `isSupersededByLastRefresh` reads it to
retire a record that events have overtaken. See the first known limitation for what it
covers and what it cannot.

### Design

Three values, three different origins, and only one of them is new data:

| | Source |
| --- | --- |
| Last attempt, and its outcome | `tokenRefreshAttempt`, a new field written at the one point every proactive refresh converges on |
| Next refresh due | Derived at read time from `expiresAt` and upstream's own lead formula. Nothing stored |
| Eligibility | `authType` plus the presence of a refresh token — the scheduler's own first two conditions |

**The convergence point is app side, so `open-sse/` is untouched.** Every proactive
refresh in the codebase reaches the network through `checkAndRefreshToken`: the background
sweep calls it with `{ force: true }` from `refreshOne`, and all six modality handlers call
it at the top of a request. Writing the outcome there covers both with one edit in one file
the fork already had reason to own. This is the `locks` move — find the app-side point
where every path already meets, rather than teaching the engine something new.

Coverage is therefore two of four refresh paths, deliberately:

| Path | Recorded | Why |
| --- | --- | --- |
| Background sweep | yes | goes through `checkAndRefreshToken` |
| Lazy per-request check | yes | same |
| Reactive 401 retry | **no** | lives in `open-sse/handlers/chatCore.js`, bypasses the app layer entirely |
| Test button | **no** | `testUtils.js` runs its own refresh and writes `testStatus` / `lastError` instead |

Neither uncovered path is invisible: a 401 refresh failure fails the request, which reaches
`markAccountUnavailable` and puts red text on the row, and the Test button writes its own
result to the badge. What they do not do is get labelled as a refresh outcome. Closing
either would mean editing `open-sse/`, or editing all six modality handlers rather than the
one place they meet — see
[Known limitations — tokenstat](#known-limitations--tokenstat).

**So the read side cannot treat the stored record as automatically current, and
`isSupersededByLastRefresh` is what stops it from doing so.** An uncovered path that leaves
`lastRefreshAt` behind proves a refresh succeeded after `attempt.at`; when it does, the
record is dropped and the row falls through to that stamp. Without it a *failed* attempt
outlives its cause and the row contradicts itself — Test succeeds, sets `testStatus` back to
`active`, and the line under the now-green badge still asks for re-authentication.
Re-authenticating does not clear it either, because `updateProviderConnection` merges and
the record survives. The rule is "the newer stamp wins", and the strictness of that
comparison is load-bearing: on the covered path both stamps describe one event from two
`Date.now()` calls, with `buildRefreshAttempt` taking the later, so the attempt keeps
precedence there by 1 to 2 ms. Never soften it to an equality test.

**Nothing in the feature branches on a provider id.** That is the constraint to preserve
across a merge, and it holds by construction: eligibility reads `authType`, the schedule
reads upstream's lead table, and the failure reason is whatever upstream's generic layer
returned. A provider-specific case anywhere here means the fork has started maintaining a
copy of a table upstream owns.

### The record field

```
tokenRefreshAttempt: { at, ok, code, detail }
```

Lands in the existing `data` JSON blob: **no migration, no `SCHEMA_VERSION` bump**, and no
entry needed in `OPTIONAL_FIELDS` — that list is a whitelist in `createProviderConnection`
only, while `updateProviderConnection` merges `{ ...existing, ...data }` freely. Checklist
23 is what pins that.

One nested field rather than four flat ones, for three reasons. `updateProviderConnection`
merges shallowly, so each write replaces the object wholesale and every record is a
complete snapshot of one attempt with no stale halves. It cannot collide with upstream's
flat `lastError` / `errorCode` / `lastErrorAt` / `lastRefreshAt`, which are written by
entirely different code for entirely different events. And one grep returns the feature's
whole footprint on the record.

**`ok` is decided by the branch, never recomputed.** `buildRefreshAttempt` takes it as an
argument and each call site passes a literal, so the recorded outcome cannot disagree with
the condition that decided whether to persist credentials. The alternative — hoisting
upstream's condition into a `const` — would have put a second copy of it in fork code and
changed the line most likely to be retuned upstream.

**`code` and `detail` record what upstream handed back, and nothing more.** Three failure
shapes exist in `open-sse/services/tokenRefresh/providers.js`:

| Shape | Stored as |
| --- | --- |
| `null` | `code: null, detail: null` |
| `{ error: "unrecoverable_refresh_error", code }` | `code` is upstream's classification, `detail` the provider's own code |
| `{ error: "invalid_grant" }` | `code` only |

**The first is by far the most common, and the feature has to be honest about it.** Most
providers return a bare `null` on failure, so for most rows the answer is "failed, at this
time, reason unavailable". Digging a reason out per provider is exactly the per-provider
code this feature exists without.

**`permanent` is resolved at read time, not stored.** `resolveTokenRefreshStatus` asks
upstream's own `isUnrecoverableRefreshError` about the stored `code`. Storing the flag
would be a derived value that goes wrong the moment upstream retunes which codes count —
and goes wrong plausibly, since a boolean still reads as a boolean. Resolving on read
cannot drift from upstream at all, and upstream adding a permanent code upgrades every
existing record for free.

**`detail` is bounded by `REFRESH_ERROR_DETAIL_MAX` at the write point.** Load-bearing,
not tidiness: `GET /api/providers` publishes this field, and that route is not
loopback-only. Every shape upstream produces today is a short code, so the cap only fires
if upstream starts returning prose — which is precisely the case where an unbounded copy
could carry a URL or a token fragment onto a public route. See the record-fields entry in
[Rules that outlive a feature](#rules-that-outlive-a-feature).

### The two branches — most likely to conflict

`recordRefreshAttempt` is called once from each branch of the `if` in
`checkAndRefreshToken`, and both properties of that arrangement are worth recognising in a
diff:

- **Symmetric.** One writer, two call sites, identical shape. Recording only failures
  would leave a stale error on screen after a later success; recording only successes
  would make "never attempted" and "attempted and failed" indistinguishable.
- **After the credential write, never before.** The success branch persists credentials
  first and records the attempt last. The reverse order can leave a record claiming
  success while the credentials that justify it were never stored.

It is fail-open and quiet by design: a write error is logged at debug and swallowed,
because a dashboard detail must not be the reason a token refresh reports failure. The
visible cost is a status line that stops updating; the cost of the alternative is a working
refresh that looks broken.

There is no throttle. A connection that is past expiry attempts a refresh on every request
that touches it, so a failing one under load writes this field repeatedly. Upstream already
makes a network call per request in that situation, which dominates a local write, and a
throttle would mean module state and a second opinion about time.

**That argument covers the request path and not the sweep**, which is the one place the write
is not dominated by anything — see
[Known limitations — tokenstat](#known-limitations--tokenstat).

### Eligibility, and the three things a row can say

`isRefreshEligible` mirrors three of the sweep's four conditions: `isActive`, `authType`
(including its `.toLowerCase().replace(/_/g, "")` normalisation) and a truthy
`refreshToken`. The fourth — a non-null expiry — becomes the `scheduled` flag instead of
part of eligibility, because those two states need different words:

| | Row shows |
| --- | --- |
| Not eligible | nothing at all. API-key and cookie connections are untouched, and so are disabled ones |
| Eligible, no expiry on the record | the last attempt and its outcome, and "refreshes on demand" — the sweep never selects it, but a request still can |
| Eligible, expiry present | all three values |

A due time already in the past is not an error and is not styled as one: the sweep fires on
its next tick, so the line reads "refresh due".

**`isActive` is why this is three conditions and not two, and it was missed on the first
pass.** It is not in `selectConnectionsNeedingRefresh` — it is the filter on the list handed
to that function, `getProviderConnections({ isActive: true })` in `loadActiveConnections`.
A mirror built by reading the selector alone showed a disabled OAuth connection a due time
for a refresh that could not happen. It belongs in eligibility rather than in `scheduled`
because the request path filters on `isActive` as well
(`src/sse/services/auth.js`), so **neither** path refreshes a disabled connection and
"refreshes on demand" would have been just as untrue as naming a time.

Excluding it outright also matches the row's own convention: `ConnectionRow` already hides
`CooldownTimer` and `lastError` behind `connection.isActive !== false`, and the `disabled`
badge already says what the row's state is. Nothing is lost — `tokenRefreshAttempt` stays on
the record, so re-enabling the connection brings the line back with its history.

### The read route

`GET /api/token-status`, no parameters, answering `{ statuses: { <connectionId>: status } }`
with an entry for every connection — ineligible ones included, as a bare
`{ eligible: false }`, so the UI can tell "no token to refresh" apart from "not in the
response".

**A route was unavoidable, and for a different reason than `locks` needed one.** Two of the
three inputs cannot reach the browser. The per-provider lead comes from `getRefreshLeadMs`,
whose `REFRESH_LEAD_MS` table is derived from `PROVIDER_OAUTH` and so drags the provider
registry in; and eligibility needs `refreshToken`, which `GET /api/providers` blanks. The
alternative — writing upstream's lead numbers down in client-safe code — is what the
fork-wide rule against copying upstream constants forbids.

It names every field it emits instead of spreading the record. That, not a filter applied
afterwards, is what keeps credentials out: `GET /api/providers` takes the other approach and
has to remember four keys to blank.

**No `LOCAL_ONLY_PATHS` entry, unlike `/api/logs` and `/api/locks`.** Every value it returns
is derived from fields `GET /api/providers` already publishes, `proxy()` applies
deny-by-default to `/api/*`, so this path inherits exactly that route's posture with no
entry at all. A loopback entry would not change what is reachable — the record publishes
`tokenRefreshAttempt` regardless — and a guard that protects nothing invites relying on it.
The control that does work is the write-point reduction.

Worth knowing while reading `dashboardGuard.js`: `PROTECTED_API_PATHS` is declared and
never read. It looks like the thing protecting `/api/providers`; the deny-by-default branch
in `proxy()` is what actually does.

### Settings

**None.** `locks` added settings because a behaviour needed tuning; there is no behaviour
here, only a display. The one number the feature owns, `REFRESH_ERROR_DETAIL_MAX`, is a
safety bound rather than a preference. So `settingsRepo.js` and
`src/app/api/settings/route.js` are both outside this feature, and checklist 8 stays a
`logs` and `locks` item.

### Deliberately untouched

- **`open-sse/` in its entirety.** No edit anywhere, including the 401 block that would
  have closed the coverage gap.
- **Upstream's `lastRefreshAt`.** Stamping it on failure was the obvious shortcut and would
  have been a real behaviour change: `isCodexRefreshStale` reads it to decide whether to
  refresh codex proactively, so a failure-stamp would reset a staleness clock that nothing
  had actually reset. It stays success-only, and the fork only ever reads it — as the
  fallback the row falls through to, and as the supersede signal in
  `isSupersededByLastRefresh`.
- **`updateProviderCredentials`'s whitelist.** Routing the attempt through it would have
  meant widening an upstream function for a field only the fork reads — and a failed
  refresh has no credentials to hand it anyway.
- **Section 2 of `checkAndRefreshToken`**, the GitHub Copilot second-hop refresh. A
  different credential with its own expiry; recording it in the same field would make a
  Copilot failure read as an OAuth failure on a connection whose OAuth refresh had just
  succeeded.
- **`CooldownTimer`.** Not reused. Its orange clock means cooldown, and a per-second tick
  would claim a precision the sweep interval does not have.
- **`ConnectionsCard.js`**, the divergent copy — same reason as the Unlock and Test buttons.
- **`src/dashboardGuard.js`.** The only fork feature that adds a route and does not touch
  it. Reasoning under [The read route](#the-read-route).

### Known limitations — tokenstat

- **Two of the four refresh paths are not observed** — the reactive 401 retry and the Test
  button. Both leave their own traces (`markAccountUnavailable`'s red text, the test badge)
  so neither is invisible, but a refresh that happened on one of them does not move
  `attempt.at`. `isSupersededByLastRefresh` recovers the cases that leave `lastRefreshAt`
  behind, which is the Test button on `codex`, `grok-cli` and `xai` plus
  `/api/translator/send`, `/api/usage/[connectionId]` and codex login. **What it cannot
  recover is every other provider's Test branch and the whole 401 path**, because those
  return raw provider tokens and leave no timestamp anywhere for the comparison to read.
  There a recorded failure keeps its red line until the sweep next refreshes that connection
  for real, which for a long-lived token is days. The failure direction is a false alarm, not
  a false green: the record is never *newer* than reality, so the line can overstate a
  problem and never hide one. Closing the rest means a signal in `open-sse/` or in
  `testUtils.js`, and both are outside what this feature edits.
- **Most failures have no reason.** See the shape table above. `code` and `detail` are
  populated for the classified permanent cases and empty for everything else. **That is why
  `TokenStatus.js` has no branch for a non-permanent `code`**, and the absence is structural
  rather than an omission: `mergeRefreshedCredentials` passes an `error` field through only
  when `isUnrecoverableRefreshError` accepts it, so a non-null `code` has already been
  classified permanent by the same function that resolves the flag. A failed attempt with no
  code renders the failure and no reason. If upstream ever starts returning an `error` shape
  that classifier rejects, that combination becomes reachable and the branch has to come
  back — checklist 22 is what notices the classifier changing.
- **The next refresh is a due time, not a schedule.** The sweep runs on its own interval,
  so the refresh happens on the first tick after the moment shown. No interval is quoted
  here because `DEFAULT_INTERVAL_MS` in `backgroundTokenRefresh.js` is not exported — read
  it there. The line is coarse (`in ~35m`) for the same reason.
- **A connection with no stored expiry is never refreshed proactively at all**, so its line
  says "refreshes on demand". That is upstream's behaviour, not a gap in the display:
  `selectConnectionsNeedingRefresh` skips such records outright.
- **A disabled connection shows no line**, even though its token and its recorded attempt
  are both still there. Neither refresh path touches a disabled connection, so every
  phrasing available would have been false. Re-enable it and the line returns with its
  history. The trap to know: **the absence of a line is not evidence of anything** — it
  means API-key, cookie, disabled, or no refresh token, and the row does not distinguish
  them. Read `/api/token-status` if you need to know which.
- **The scheduler's real next-tick time is not knowable from the data.** Its interval handle
  is process-local, and a restart resets the cycle, so what is shown is computed from
  `expiresAt` rather than read from anything.
- **No history.** One attempt is stored, overwritten by the next. No counter, no streak, no
  ring buffer — enough to answer "is this connection healthy right now?" and nothing more.
- **The status is fetched with the connection list and does not poll.** It refreshes when
  the page does. A row that started failing a minute ago still shows its previous state
  until something refetches.
- **A failed `/api/token-status` fetch hides every line** rather than showing an error. The
  state stays an empty map, which renders identically to a list where nothing is eligible.
  Diagnose it from the network tab, not the row.
- **The sweep pays one extra database write per refreshed connection, and this is the one
  cost with no upstream work to hide behind.** `recordRefreshAttempt` is `await`ed inside
  `checkAndRefreshToken`, so `refreshOne` in `backgroundTokenRefresh.js` now performs a
  transactional `updateProviderConnection` for every connection it refreshes, in a loop that
  upstream runs with none. On the request path the refresh's own network call dominates it;
  in the sweep there is nothing to dominate it, and the loop's width is the whole eligible
  set rather than one connection.

  **Measure it rather than trusting a figure, and measure it on your own install.** The
  stored `at` values are the instrument: one is written per refreshed connection, so the
  range across a batch is the wall time that fan-out took, and the gaps between consecutive
  values are what a slow write would widen. The upper bound on writes per sweep is the
  eligible count, which `/api/token-status` gives directly. Measured once at 498 eligible of
  645 connections: a batch of 81 landed inside 3004 ms with consecutive writes a median of
  1 ms apart, the only two gaps over 100 ms being the network refreshes — so on that install
  the write was not the cost that mattered.

  **What makes the width worth watching is upstream's, not the write.**
  `runBackgroundTokenRefreshTick` maps every due connection through `Promise.allSettled` with
  no concurrency limit, and expiries cluster because a sweep gives everything it refreshes the
  same lifetime, so one tick fans out to a whole cluster rather than to one connection. Same
  install: 281 connections shared a single expiry second. That is the number to re-derive
  before assuming this write is what a struggling sweep is struggling with.
- **Nothing on media-provider connections**, same divergent-copy reason as the two buttons.
- **The field is carried into safety backups**, unlike the `logs` feature's data.
  `src/lib/db/backup.js` copies every table except `requestDetails`, and
  `providerConnections` is copied whole including its `data` blob — so a restored backup
  brings back whatever attempt was recorded when it was taken. Harmless, and worth knowing
  before reading an old timestamp as current.

## Upstream merge checklist

Runs once for the whole fork. Feature tags are there so an entry can be dropped along
with its feature, not so the list can be split up.

**`node scripts/fork-check.mjs` runs items 1 to 24 and prints pass/fail for each**, so use
that rather than typing twenty-four greps. What it cannot do is repair anything, or settle
the four items that need a human reading code rather than counting lines — items 4, 7, 17
and 23, which it reports as *to read* rather than passing. The commands stay quoted below
because they are the readable form of each assertion, and because a failing item is easier
to understand by running its own grep than by reading the script.

**When a check fails, the fork follows the writer, not the other way round.** Items 4,
5, 6 and 10 all watch a value that upstream owns — a directory layout, a filename, a
placeholder string, a logs root. If upstream changed one deliberately, update the
matching constant in `src/lib/requestLogsFs.js` to agree with it. Reverting upstream to
suit the reader is the wrong repair: it survives exactly until the next merge, and the
reader is the cheaper side to move.

1. **[logs] `open-sse/handlers/chatCore*`** is where conflicts land. Afterwards confirm
   `logDir` survives in all six files:
   - `sharedCtx` in `chatCore.js`, plus both error-path `saveRequestDetail` calls
   - `buildRequestDetail` in `requestDetail.js`
   - both signatures and both record calls in `streamingHandler.js`
   - the signature and record call in `nonStreamingHandler.js`
   - the signature and `ctx` in `sseToJsonHandler.js`
   - the stored field in `requestDetailsRepo.js`, reduced to a bare directory name

   ```
   git grep -n logDir -- open-sse/handlers src/lib/db/repos/requestDetailsRepo.js
   ```

   Expect 17 hits across 6 files. Scope the path as shown — a wider `-- open-sse`
   also matches an unrelated local variable in `transformer/responsesTransformer.js`.

2. **[logs] `maskSensitiveHeaders`** in `open-sse/utils/requestLogger.js` must still be
   applied at every write site: `logClientRawRequest`, `logRawRequest`,
   `logTargetRequest`, `logProviderResponse`. A new stage that writes headers without
   it reintroduces the leak silently.

   ```
   git grep -c maskSensitiveHeaders -- open-sse/utils/requestLogger.js   # expect 5
   ```

   Five is one definition plus four call sites. **Do not skip this one.** The reader
   does not mask, so this is the only thing standing between a live OAuth token and a
   file on disk — and once written, the token stays there until retention removes the
   directory. Count the write sites too: five hits with only three call sites means a
   stage lost its call.

3. **[logs] `LOCAL_ONLY_PATHS`** in `src/dashboardGuard.js` still contains `/api/logs`.

   ```
   git grep -c "/api/logs" -- src/dashboardGuard.js   # expect 2
   ```

   Two is the array entry plus the comment above it. **Not sufficient on its own** —
   this only proves the path is listed, not that `proxy()` still checks the list before
   the deny-by-default branch. Post-merge step 5 is the check that would notice a
   reordering.

4. **[logs] Session directory naming** in `requestLogger.createLogSession`. If the
   layout changes, `parseSessionName` breaks and every row silently loses its dump.
   The parser assumes:
   - `{sourceFormat}_{targetFormat}_{safeModel}_{YYYYMMDD}_{HHmmss}_{SSS}`
   - format ids never contain `_` (they use hyphens — `open-sse/translator/formats.js`)
   - the stamp comes from **local**-time getters

   The name screen is a **deny-list** — path separators, bare `.` / `..`, NUL — with
   `path.resolve` containment as the real guard. Do not tighten it into an allow-list
   of permitted characters. The writer sanitises only `/` and `:` in the model id, so
   an allow-list rejects a directory containing `@` or `+`, and fails twice over in
   silence: the row reports no dump although the directory is there, and
   `pruneSessions` never reclaims it, because it only deletes names it can identify.

5. **[logs] Stage filenames** `1_req_client.json` … `7_res_client.txt`. `STAGE_FILES`
   in `requestLogsFs.js` lists them explicitly; a rename means a silently missing
   stage.

   ```
   git grep -oh --untracked "[0-9]_[a-z_]*\.\(json\|txt\)" -- open-sse/utils/requestLogger.js src/lib/requestLogsFs.js | sort -u
   ```

   Expect exactly ten names. Because this is the union of writer and reader, a rename
   on one side alone pushes the count to eleven and shows both spellings side by side.

6. **[logs] `STREAMING_PLACEHOLDER`** in `requestLogsFs.js` must stay identical to the
   `response.content` that `streamingHandler.js` writes when a stream opens, currently
   `"[Streaming in progress...]"`. If they drift, every stream reads as complete the
   instant it starts.

   ```
   git grep -n --untracked "Streaming in progress" -- open-sse src   # expect 2
   ```

   One hit per file, and the two strings must read the same.

7. **[logs] `truncateField`** in `requestDetailsRepo.js` must keep returning a new
   value instead of mutating its argument, or the top-level `stream` copy taken
   alongside it breaks and the streaming badge disappears.

8. **[logs, locks] New settings keys** survived, if `DEFAULT_SETTINGS` was reorganised.
   `requestLogsMaxSessions` and `enableObservability` are declared there; the six
   `lock*Ms` keys deliberately are not, so for those the check is only the route.

   Confirm that `PATCH` in `src/app/api/settings/route.js` is still a blocklist — it
   deletes `PROTECTED_SETTING_KEYS` and passes the rest through, which is the only
   reason any of these needs no route change. An allowlist there drops them without an
   error: the logs key silently reverts to its default, and every lock field on the
   Settings card silently stops saving while still reporting success.

   ```
   git grep -l --untracked "lockBackoffBaseMs" -- src
   ```

   Expect exactly one file, `src/lib/lockPolicy.js`. The Settings card renders from
   `LOCK_SETTING_KEYS` rather than naming any key itself, so a second file here means a
   key name was hardcoded somewhere and the table has stopped being the single source.

9. **[logs] Nothing new writes into `logs/`.** Retention only deletes directories it
   can parse as a session, so any other writer accumulates unmanaged. Today the two
   exceptions are inert or harmless: `createResponsesLogger` in
   `open-sse/transformer/responsesTransformer.js` has no callers, and `logError` writes
   flat `<provider>-<date>.log` files. If upstream wires up the former, either teach
   `pruneSessions` its naming or accept unbounded growth knowingly.

   ```
   git grep -n "createResponsesLogger" -- open-sse
   ```

   Expect the definition only. A second hit means it gained a caller.

10. **[logs] The `logs/` root is still `process.cwd()`.** `requestLogger.js` builds
    `LOGS_DIR` from `process.cwd()`, and `resolveLogsDir()` mirrors that deliberately
    rather than following `DATA_DIR`. If upstream moves the writer, point the reader at
    the same place — otherwise every row reports no dump while the files sit somewhere
    else.

    ```
    git grep -n --untracked "cwd()" -- open-sse/utils/requestLogger.js src/lib/requestLogsFs.js
    ```

    Expect three hits: `LOGS_DIR` in the writer, and `resolveLogsDir()` plus the
    docblock above it in the reader. Both must join `"logs"` to the same base.

11. **[locks] The rules table still holds exactly two distinct fixed durations.**
    `lockPolicy.js` maps three categories: `COOLDOWN.long`, `COOLDOWN.short` and the
    unmatched default `TRANSIENT_COOLDOWN_MS`. A rule carrying a fourth distinct value is
    a category no configured field reaches — that rule silently keeps upstream's duration,
    with no error and a plausible-looking lock.

    ```
    git grep -oh "cooldownMs: COOLDOWN\.[a-z]*" -- open-sse/config/errorConfig.js | sort -u
    ```

    Expect two lines, `COOLDOWN.long` and `COOLDOWN.short`.

    Then confirm the three values are still **different from each other**, which no grep
    can compute:

    ```
    git grep -n "long:\|short:\|export const TRANSIENT_COOLDOWN_MS" -- open-sse/config/errorConfig.js
    ```

    Expect three lines holding three different expressions. If two ever agree,
    `buildFixedCooldownMap` drops the colliding entry and both categories fall back to
    upstream's duration — safe, but the configured fields for them stop working.

12. **[locks] `COOLDOWN_MS` is still exported** from `open-sse/config/errorConfig.js`. It
    is the only route to `COOLDOWN.long` and `COOLDOWN.short`, which are module-private.

    **Treat this as the fork's most fragile upstream dependency, and know why.** Upstream
    labels the object "Backward compat: COOLDOWN_MS object (used by index.js re-export)",
    and that label is the whole consumer list:

    ```
    git grep -n "\bCOOLDOWN_MS\b" -- open-sse
    ```

    Expect four lines across three files: the comment and the definition in
    `errorConfig.js`, a re-export in `open-sse/config/runtimeConfig.js` marked "backward
    compat", and `open-sse/index.js` re-exporting that. **No real code in `open-sse` reads
    it** — so `src/lib/lockPolicy.js` is its only genuine consumer, at the end of a
    two-layer legacy chain upstream has already flagged as removable. Upstream's own
    comment is stale as well: the path runs through `runtimeConfig.js`, not `index.js`
    directly.

    **Use the word boundaries.** A bare `COOLDOWN_MS` also matches
    `TRANSIENT_COOLDOWN_MS`, `MAX_RATE_LIMIT_COOLDOWN_MS` and `OAUTH_429_COOLDOWN_MS`, so
    a count without them silently sums three unrelated constants and still looks plausible.

    Deletion is a build failure rather than a silent fault, which is the good direction.
    The repair is to read the two values off `ERROR_RULES` instead of reintroducing the
    export.

13. **[locks] `getQuotaCooldown`'s formula is unchanged.** `resolveBackoffCooldownMs`
    mirrors `base * 2^(backoffLevel - 1)` capped at a ceiling, including the `- 1` offset.
    Upstream stores the level, so both formulas have to agree on what a stored level
    means. Jitter, a different offset or a different multiplier all need mirroring here.

    ```
    git grep -c "getQuotaCooldown" -- open-sse/services/accountFallback.js   # expect 3
    ```

    Three: the definition plus the two `backoff: true` call sites. Note the docblock above
    the definition has always described a different ladder than the code implements — it
    names 1s/2s/4s and a 4-minute ceiling, the code does 2s/4s/8s and 5 minutes. Trust the
    code, and do not "fix" the fork to match the comment.

14. **[locks] `checkFallbackError` sets `newBackoffLevel` only on backoff rules.** This is
    the single signal separating a ladder duration from a fixed one. If it starts coming
    back on every rule, every fixed cooldown gets recomputed from the ladder.

    ```
    git grep -n "newBackoffLevel" -- open-sse/services/accountFallback.js   # expect 5
    ```

    Five: the `@returns` docblock, the two `backoff: true` returns, and two lines in the
    dead `applyErrorState`. The two fixed-rule returns and the final default return must
    still omit it.

15. **[locks] `MAX_RATE_LIMIT_COOLDOWN_MS` has no code reader outside the resolver.**

    ```
    git grep -n --untracked "MAX_RATE_LIMIT_COOLDOWN_MS" -- open-sse src
    ```

    Expect three files: the definition in `errorConfig.js`, the import and use in
    `src/lib/lockPolicy.js`, and **one comment line only** in
    `src/sse/services/auth.js`. A real reference in `auth.js`, or any new reader
    elsewhere, is a call site that bypasses the configured cap.

16. **[locks] `/api/locks` is in `LOCAL_ONLY_PATHS`** in `src/dashboardGuard.js`.

    ```
    git grep -c "/api/locks" -- src/dashboardGuard.js   # expect 2
    ```

    Two is the array entry plus the comment above it. Same caveat as item 3: this proves
    the path is listed, not that `proxy()` still consults the list before the
    deny-by-default branch. Post-merge step 5 is what catches a reordering, and it now
    covers both prefixes.

17. **[locks] The reset route still uses upstream's lock-key helper.**
    `buildClearModelLocksUpdate` must keep enumerating `modelLock_*` by prefix off the
    record rather than from a fixed list. A fixed list means the reset misses any lock key
    upstream adds later, and the row keeps a cooldown the button claims to have cleared.
    This helper is the route's only import from `accountFallback.js` — `MODEL_LOCK_PREFIX`
    is deliberately not imported, so no lock-key string appears in fork code at all.

    ```
    git grep -n --untracked "buildClearModelLocksUpdate" -- open-sse src
    ```

    Expect three hits: the definition in `accountFallback.js`, and the import plus the
    call in `src/app/api/locks/reset/route.js`. Read the definition, not just the count —
    the count cannot tell a prefix scan from a fixed list.

    Do not widen this grep to `MODEL_LOCK_PREFIX`: no fork file references it, and
    upstream's `src/app/api/models/availability/route.js` declares its own local copy of
    that string rather than importing it, so the results would be entirely upstream's and
    would mix two independent definitions.

18. **[conntest] `POST /api/providers/[id]/test` still answers `{ valid, error }`**, and
    the page's `oneByOneResults` entries are still shaped `{ state, error }`. The row
    button and upstream's one-by-one run both write that state and the badge reads it, so
    a shape change empties the badge with no error anywhere.

    ```
    git grep -n "valid: result.valid" -- src/app/api/providers/[id]/test/route.js
    ```

    Expect one hit. If upstream renames the field, `runConnectionTest` reports every test
    as failed.

19. **[tokenstat] `checkAndRefreshToken` is still the one point every proactive refresh
    passes through.** The whole feature records outcomes there and nowhere else, so a path
    that stops going through it stops being reported — silently, and looking exactly like a
    connection that is no longer being refreshed.

    ```
    git grep -nF --untracked "checkAndRefreshToken(" -- src
    ```

    Expect 9 hits across 8 files: the definition in `src/sse/services/tokenRefresh.js`, the
    `{ force: true }` call in `backgroundTokenRefresh.js`'s `refreshOne`, and seven lazy
    call sites across the six modality handlers (`videoGeneration.js` has two).

    **Include the opening parenthesis.** A bare name matches nineteen lines: these 9, plus
    six static `import` lines, the dynamic destructure in `backgroundTokenRefresh.js`, two
    prose mentions in fork comments and one in `src/lib/oauth/providers/grok-cli.js`. Ten of
    those move whenever anyone edits a comment or reorders an import. With the parenthesis
    the count is call sites and the definition, which is what the item is about.

    A drop to 8 means a modality handler stopped refreshing on the request path. Losing the
    `backgroundTokenRefresh.js` line specifically is the expensive one: proactive refresh is
    where nearly every recorded attempt comes from.

20. **[tokenstat] The due-time formula still agrees with `selectConnectionsNeedingRefresh`.**
    `resolveRefreshLeadMs` mirrors that function's
    `Math.max(getRefreshLeadMs(provider), BACKGROUND_REFRESH_LEAD_MS)`, and
    `resolveNextRefreshDueAt` inverts its `expiresAtMs - nowMs < leadMs` test. Both operands
    are imported rather than written down, so upstream retuning the floor needs no edit here
    and removing the export is a build failure.

    ```
    git grep -n --untracked "BACKGROUND_REFRESH_LEAD_MS" -- src
    ```

    Expect 7 hits across 2 files: four in `backgroundTokenRefresh.js` (the definition, the
    docblock, the `Math.max`, the startup log line) and three in `tokenRefreshStatus.js`
    (a docblock mention, the import, the use).

    Then confirm the sweep still applies **exactly four** conditions, and note that they
    live at **two levels** — this is the part that is easy to read wrongly, and the fork
    got it wrong first time round:

    | Condition | Where |
    | --- | --- |
    | `authType` normalised to `oauth` | inside `selectConnectionsNeedingRefresh` |
    | truthy `refreshToken` | inside `selectConnectionsNeedingRefresh` |
    | non-null `getCredentialExpiryMs` | inside `selectConnectionsNeedingRefresh` |
    | `isActive` | **not in that function** — it is the filter on the list handed to it, `getProviderConnections({ isActive: true })` in `loadActiveConnections` |

    A fifth condition anywhere in that path is the quiet failure: the sweep skips
    connections the fork still shows a due time for, so the row promises a refresh that
    never arrives, and no count above can see it. Read the caller as well as the function —
    reading only `selectConnectionsNeedingRefresh` is exactly how the `isActive` condition
    was missed.

    `isActive` is worth extra care because **the request path filters on it too**
    (`getProviderConnections({ provider, isActive: true })` in `src/sse/services/auth.js`).
    A disabled connection is refreshed by neither path, which is why `isRefreshEligible`
    excludes it outright instead of reporting it as merely unscheduled.

21. **[tokenstat] `getRefreshLeadMs` is still exported, and `REFRESH_LEAD_MS` still derived
    from the registry rather than written down.** The derivation is what makes a provider's
    declared lead reach the fork with no edit — and also why this module can never move
    client side.

    ```
    git grep -nE "\bREFRESH_LEAD_MS\b" -- open-sse
    ```

    Expect 4 hits across 2 files: the definition in `open-sse/config/appConstants.js` and
    three in `open-sse/services/tokenRefresh.js` (the import and two reads inside
    `getRefreshLeadMs`). Confirm the definition is still built from `PROVIDER_OAUTH`; a
    hand-written table there would still work, but a provider added without an
    `oauth.refreshLeadMs` would then quietly fall back to the background floor.

    **Use the word boundaries.** Without them this also matches
    `BACKGROUND_REFRESH_LEAD_MS`, which is a different constant in a different layer.

22. **[tokenstat] `isUnrecoverableRefreshError` is still the single source of the
    "re-authenticate" distinction.** The fork stores upstream's classification code and asks
    this function about it at read time, so upstream adding a permanent code upgrades every
    stored record for free and removing the export is a build failure.

    ```
    git grep -n "isUnrecoverableRefreshError" -- open-sse
    ```

    Expect 3 hits across 2 files: the definition in `open-sse/services/tokenRefresh.js`, and
    the import plus the early return in `oauthCredentialManager.js`. Scope it to `open-sse`
    — widening to `src` adds fork comment mentions that move with any edit.

    Then confirm the four codes are still listed: `unrecoverable_refresh_error`,
    `refresh_token_reused`, `invalid_request`, `invalid_grant`. A code dropped from that list
    turns a permanent failure into a generic one, and the row stops telling you to log in
    again.

23. **[tokenstat] `updateProviderConnection` still merges the whole object, and the stored
    detail is still reduced.** Two independent things, both about the field surviving
    correctly rather than plausibly.

    ```
    git grep -n "OPTIONAL_FIELDS" -- src/lib/db/repos/connectionsRepo.js
    ```

    Expect 2 hits: the declaration and the one loop inside `createProviderConnection`. A
    third use means it became a whitelist on the update path too, which drops
    `tokenRefreshAttempt` without an error — the status line then falls back to upstream's
    `lastRefreshAt` with no outcome, which looks like a working display.

    The half that needs reading: `buildRefreshAttempt` must keep passing both `code` and
    `detail` through `reduceDetail`, bounded by `REFRESH_ERROR_DETAIL_MAX`. `GET
    /api/providers` publishes this field to anyone who can reach the dashboard, so an
    unbounded copy of a provider error body is a leak that no count here can detect.

24. **All features:** both tables still match reality — the inventory for edited files,
    and "What upstream can break" for the ones the fork only depends on. The grep
    covers the first; the second needs reading, so check it whenever a new import or
    `fetch` is added to fork code.

    ```
    git grep -l --untracked "FORK(" -- open-sse src
    ```

    Expect twenty-six files. Use the bare prefix, not one feature's tag — three files
    carry more than one tag, so per-feature greps overlap and none of them is the whole
    fork. The per-feature counts sum to thirty-one, not twenty-six: one file carries two
    tags and two carry three. The two untagged added files are outside this count by
    design; see the inventory.

25. **Update the expected counts in items 1 to 23 if upstream legitimately changed
    them — in this file *and* in `scripts/fork-check.mjs`.** Those numbers are assertions
    about upstream's code, so they go stale by design: a mismatch is an invitation to look,
    not proof of breakage. Once you have confirmed the new shape is correct, write the new
    count into both places. Nobody else owns them: item 24 covers the two tables and item
    26 covers the tests, so a stale count here silently degrades into a check that always
    fails and gets skipped.

    **The script is a second copy of every number in items 1 to 24, and nothing compares
    the two.** That is the price of having one command instead of twenty-four greps; the
    failure mode is a script that passes while this document says something else, so update
    them in the same commit. If they ever disagree, the document is the source — the script
    is only its executable form.

    **Renumbering is part of the job.** New feature items go before the all-features and
    procedural ones, so adding a feature shifts the tail. When it does, the numbers to chase
    are: this document's "items 1 to N" phrases in the merge steps at the top, the checklist
    intro, and items 24 and 25; and in `scripts/fork-check.mjs`, the item count in the header
    comment, the `MANUAL_ITEMS` ids, and the per-feature array inside item 24's check.

26. Re-run lint, build, the test comparison and the post-merge check below.

## Verifying

```
npx eslint .
npm run build          # /api/logs/records, /api/logs/session/[name], /api/locks/reset
                       # and /api/token-status in the route list
```

A plain checkout is not clean, so `npx eslint .` cannot answer whether the fork is. On this
tree at `v0.5.59` it reports 333 problems, 135 errors and 198 warnings, all inherited from
upstream, led by `import/no-anonymous-default-export` and `react-hooks/set-state-in-effect`.

**Treat that whole-repo total as a property of one working tree, not of `v0.5.59`, and never
diff it across two runs** — a build between them changes it. `eslint.config.mjs` ignores only
`.next/**`, `out/**`, `build/**` and `next-env.d.ts`, so **any other build-output directory
present gets linted**, and `.gitignore` hides exactly those from `git status`. The case that
happened: `next build` with a different `distDir` leaves a full copy of `src` under
`.next-analyze/standalone/`, and while it was there this total read 348 problems and 150
errors — fifteen of them the fork's own files counted twice. Confirmed by dropping a known
violation into `.next-analyze/` and watching the count move. Either add such a directory to
`globalIgnores` before quoting a number, or skip the whole-repo run and lint the fork's own
files, which is the only signal that means anything.

**Lint the added files and the modified ones separately.** The added files must come back
completely clean; the modified ones carry upstream's pre-existing errors, so the only
useful question there is whether the count changed. Stash the fork's edits to those files
and lint them again to get the before number — `src/app/(dashboard)/dashboard/providers/[id]/page.js`
and `ConnectionRow.js` together report three errors and one warning either way: the three
errors are `react-hooks/set-state-in-effect` in `page.js`, and the **warning is in
`ConnectionRow.js`**, `react-hooks/exhaustive-deps`. Expect both line numbers to move
rather than the counts — the fork adds lines above each. Adding
`src/sse/services/tokenRefresh.js` to the same command changes nothing because that file
is clean, and so are the other twelve modified files.

`react-hooks/set-state-in-effect` is the rule a new component will trip. The shape that
passes is an async IIFE inside the effect guarded by a `cancelled` flag, never a
`useCallback` that contains `setState` called from the effect body; `LogsTab.js` and
`LockDurationsCard.js` both use it.

Tests need care. `tests/` is an independent package:

```
npm install            # repo root first — tests import from src/
cd tests && npm install
npx vitest run
```

**Neither shipped baseline tool works here.** `tests/__baseline__/verify-no-regression.mjs`
keys failures on `f.name.split("/app/")[1]`, a Docker path absent from any local checkout, so
every existing failure registers as a regression; and `known-fails.txt` is stale, because the
local Vitest discovers considerably more tests than it was recorded with. Compare the suite
against itself instead.

**Use a worktree, and link `node_modules` in *two* places.** `tests/` is an independent
package, so a worktree borrowing only the root one leaves Vitest unresolvable: every file
reports "No test suite found", which lands in the JSON as all-suites-failed with zero
assertions and reads as a total regression.

```
git worktree add --detach /tmp/9r-base v0.5.59
# link BOTH, from the fork checkout:
#   <worktree>/node_modules        →  ./node_modules
#   <worktree>/tests/node_modules  →  ./tests/node_modules
# Windows: New-Item -ItemType Junction -Path <link> -Target <target>
cd tests && npx vitest run --reporter=json --outputFile=fork.json   # in the fork
                                                                    # then the same in the worktree → base.json
```

**Removing those links afterwards is the dangerous step on Windows.** `Remove-Item -Recurse`
on a junction prompts and, if answered, deletes *through* it into the real `node_modules`.
Delete the reparse point alone — `[System.IO.Directory]::Delete($link, $false)` or
`cmd /c rmdir <link>` — then confirm `node_modules` still has its contents before
`git worktree remove`.

<details>
<summary>In-place alternative, if a worktree is impractical</summary>

Check out upstream's copies of the modified files and restore from `HEAD`:

```
cd .. && git checkout upstream/master -- <the modified files from the inventory>
cd tests && npx vitest run --reporter=json --outputFile=base.json
cd .. && git reset -q HEAD -- . && git checkout -- .
```

`git checkout <tree> -- <paths>` stages what it writes, so the restore needs the `reset` as
well as the `checkout` — and `git status` looks *clean* rather than dirty while the base run
is in progress, which is why an interrupted run can leave upstream's copies sitting in a
checkout that looks fine. Confirm `src/sse/services/auth.js` actually reverted before
trusting the base numbers; it is the file the comparison is most about. The worktree is
preferred precisely because it never writes to the fork's own tree.

</details>

**Check the report size either way — it is the tell that the run was real.** Roughly 770 KB
valid, about 65 KB broken. That catches a silently failed `git checkout` too.

Then read the two JSON files:

- **Diff the `fullName` values of failed assertions.** A regression is a name failing in
  `fork.json` but not `base.json`. Judge only by that — the totals wobble between runs
  because the suite contains live-provider and timing-sensitive tests. Verified at `v0.5.59`:
  216 files, 2084 tests discovered, 1937 passing, and 88 failing assertions across 30 files on
  the upstream side against 86 on the fork's, because of the two it fixes. Both methods give
  the same numbers, which is what makes them mutually confirming.
- **Diff the failed `testResults[].name` paths as well.** A suite can fail with every
  assertion passing: a throw in `beforeAll` or `afterAll` produces no `fullName`, so an entire
  file blowing up is invisible in the comparison above. Not hypothetical on Windows —
  temp-directory cleanup in an `afterAll` raises `EPERM` while a handle is still open.

Two things to control for:

- **Clear `ENABLE_REQUEST_LOGS` before measuring.** Vitest does not load `.env`, but if the
  variable is exported in your shell it overrides `enableObservability` and flips several
  assertions in `unit/request-details-tab.test.js`. Both runs must see the same value.
- Vitest rewrites `tests/translator/__snapshots__/*.snap`, mostly LF → CRLF; check with
  `git diff --ignore-cr-at-eol` and revert the noise. **It also re-creates
  `golden-url-header.test.js.snap`, which upstream deleted in `2203cd8f` while keeping the
  test.** That one arrives *untracked* rather than modified, so a `git checkout --` of the
  snapshot directory misses it and it is one `git add .` from being committed back. Delete it
  explicitly.

The fork should pass exactly two tests upstream fails, both in
`unit/request-details-tab.test.js` and both because recording is on by default: `returns
unique provider list without parsing data blobs` and `oversized field → stored truncated +
reparseable (no circular)`. Confirmed at `v0.5.59`. Anything else on that side of the diff is
worth reading rather than welcoming.

### Post-merge check

Lint, build and tests are all static or unit level; none of them proves the feature
still works end to end. Eleven checks do, against a running instance — substitute your
port, and note that `/api/logs` and `/api/locks` only answer on loopback, which is what
step 5 tests.

Steps 1 to 5 cover `logs`, steps 6 and 7 cover `locks`, step 8 covers `conntest`, steps
9 to 11 cover `tokenstat`.

**Steps 2 to 4 need at least one row in `requestDetails`.** On an empty table they are
not merely uninformative, they read as failures: step 4 counts zero because there is
nothing to redact, not because the guard broke. Send one real request through the
router first, then start at step 1.

These are POSIX shells, like the test commands above. On PowerShell there is no `curl`,
`head` or `grep`: use `Invoke-RestMethod` and inspect the object, and
`[regex]::Matches($body, '"redacted":true').Count` for step 4.

```
# 1. The list endpoint answers, and payload stripping still holds.
curl -s localhost:20127/api/logs/records | head -c 400
```

Expect a `details` array and a `pagination` object. Each row should carry `logDir` — a
bare directory name, never a path — plus `sessionName`, `hasLogs`, `outcome`,
`outcomeSource` and `stream`, and must **not** carry `request`, `providerRequest`,
`providerResponse` or `response`.

**Judge the stripping by those four keys, never by the page size.** A size threshold is
the wrong kind of check here: with the default `pageSize` of 20 and the 5 KB cap the
ceiling is a few hundred kilobytes, so a rule like "a megabyte means the stripping was
lost" can never fire. The key test is exact, costs nothing, and stays true after anyone
retunes `pageSize` or `observabilityMaxJsonSize`.

```
# 2. Rows are finding their dumps.
curl -s localhost:20127/api/logs/records | grep -o '"hasLogs":[a-z]*' | sort | uniq -c
```

At least one recent row with `hasLogs: true`. All of them false points at the `logDir`
thread (checklist 1) or at `ENABLE_REQUEST_LOGS`; a row with `logDir` set but
`hasLogs: false` points at `parseSessionName` (checklist 4) or a moved logs root
(checklist 10).

```
# 3. One session reads back.
curl -s "localhost:20127/api/logs/session/<sessionName from step 2>"
```

Expect `name`, `sourceFormat`, `targetFormat`, `model`, `timestamp` and a `stages`
array: five to seven entries when the provider answered successfully, four when it
answered with an error, fewer still if the request never got that far. Confirm
`4_req_target.json` is present rather than counting entries — that is the stage which
means the provider was reached. Read "Stage count varies per row" in
[Known limitations — logs](#known-limitations--logs) before treating a short array as a
fault. No `outcome` key — that belongs to the list endpoint alone. Confirm a `headers`
object shows `<redacted>` rather than a live token: since
the reader does not mask, this is reading the file itself, so it is the real check on
checklist item 2 and the reason to run it after every merge.

```
# 4. Upstream's own redaction is untouched.
curl -s localhost:20127/api/usage/request-details | grep -c '"redacted":true'
```

Non-zero, given the table has rows. Zero on a populated table means the merge broke
upstream's guard, which the fork depends on staying exactly as upstream wrote it.

```
# 5. The local-only guard actually discriminates. Run from another host on the LAN,
#    or with a non-loopback Host header.
curl -s -o /dev/null -w '%{http_code}\n' http://<lan-ip>:20127/api/logs/records
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://<lan-ip>:20127/api/locks/reset
curl -s -o /dev/null -w '%{http_code}\n' http://<lan-ip>:20127/api/usage/request-details
```

**The Host-header alternative only discriminates under `next dev`.** Under `npm start`
`custom-server.js` stamps the peer address and `isLoopbackPeer` reads that instead, so a
spoofed Host is ignored and a loopback caller gets 200 where this step expects 403 — a
false alarm that sends you hunting a guard that never broke. Use a real non-loopback
address there.

Expect **403, 403, then 200**. All three matter. A 403 on the first two alone could mean
the whole dashboard is unreachable from there, which proves nothing about
`LOCAL_ONLY_PATHS`; the 200 on the third URL is what shows the guard is discriminating by
path rather than blocking everything. A 200 on the first means unredacted conversation
content is reachable from the LAN; a 200 on the second means anyone on the LAN can strip
this install's cooldowns.

Checklists 3 and 16 only grep for the array entries. That proves the paths are *listed*,
not that `proxy()` still consults `LOCAL_ONLY_PATHS` before the deny-by-default branch — if
a merge reorders those blocks the greps still pass. This step is the one that catches it,
and it is the reason not to treat those two items as sufficient on their own.

**Take the loopback readings first, in the same run.** The point of the spoofed pair is the
*difference*, and without the loopback column a 403 could equally mean the route is broken.
Note that `POST /api/locks/reset` with no body answers 500 on loopback — that is the route
running and rejecting a missing `connectionId`, and it is a perfectly good "not 403".
Verified working this way at `v0.5.59` under `next dev`: 200/500/200 on loopback, then
403/403/200 with `Host: 192.168.1.50:20127`.

```
# 6. Configured durations actually reach the lock. Set a value nothing else would produce.
curl -s -X PATCH localhost:20127/api/settings \
  -H 'Content-Type: application/json' -d '{"lockTransientCooldownMs":123000}'
```

Then make one request fail transiently against a real connection — a provider that is
down, or an account whose key you have just invalidated — and read the row back:

```
curl -s localhost:20127/api/providers | grep -o '"modelLock_[^"]*":"[^"]*"'
```

**Judge this structurally, not by waiting.** Subtract the lock timestamp from the moment
of failure and expect 123 seconds, not "roughly two minutes": upstream's own unmatched
default is 30 seconds and its auth cooldown is 120, so a wall-clock impression cannot tell
123 from 120. If you get upstream's number instead, the resolver is being bypassed
(checklist 15) or the category is unmapped (checklist 11).

Put the setting back afterwards by clearing it, which is what an empty field does:

```
curl -s -X PATCH localhost:20127/api/settings \
  -H 'Content-Type: application/json' -d '{"lockTransientCooldownMs":null}'
```

```
# 7. The reset route clears everything it claims to.
curl -s -X POST localhost:20127/api/locks/reset \
  -H 'Content-Type: application/json' -d '{"connectionId":"<id from step 6>"}'
```

Expect `{"ok":true}`, and nothing else — the route reports no count, because no honest one
exists (see [The reset route](#the-reset-route)). A `200` here proves only that the update
ran.

The assertion is the record. Re-read that connection and confirm **all five** of
`testStatus: "active"`, `lastError: null`, `errorCode: null`, `lastErrorAt: null`,
`backoffLevel: 0`, plus no remaining `modelLock_*` carrying a future timestamp. Clearing
the locks while leaving the error state is the failure this checks for — the row would keep
showing red text the button appeared to have cleared.

```
# 8. The row test still reaches a provider.
curl -s -X POST localhost:20127/api/providers/<id>/test
```

Expect `{"valid":...,"error":...,"refreshed":...}`. Only the first two field names matter
to the fork (checklist 18).

Then open `/dashboard/providers/<provider>` and check the list itself, since none of the
steps above touch the UI:

- Every row has a **Test** button; clicking one turns the badge beside the name to
  `testing` and then `success` or `failed: <message>`. If the badge never appears,
  `oneByOneResults`'s `{ state, error }` shape changed.
- **The rest of that row updates too**, which is the separate assertion: after the test the
  status badge, the red `lastError` text and the `tokenstat` line all reflect what the route
  just wrote. A badge that changes while everything else on the row stays put means
  `handleTestConnection` lost its `await fetchConnections()`.
- A row with an active cooldown or a `lastError` also has an **Unlock** button, and a
  healthy row does not. Present on every row means `isCooldown` or `connection.lastError`
  stopped resolving; absent on a locked row means the same in the other direction. A
  **disabled** row shows none either way — `hasClearableLock` is gated on `isActive`, so
  toggle one off with a lock on it and the button should disappear along with the cooldown
  timer and the error text beside it.
- The Settings page at `/dashboard/profile` shows the Account Lock Durations card with six
  fields, each showing upstream's value as placeholder text when empty.

Then open the logs tab itself at `/dashboard/usage?tab=inspector`, since the steps above say
nothing about the components `LogsTab` borrows from `src/shared/components`. Empty
provider or account columns with rows otherwise present is the signature of a changed
response shape on `/api/usage/providers`, `/api/provider-nodes` or `/api/providers`.

```
# 9. The status endpoint answers, discriminates, and leaks nothing.
curl -s localhost:20127/api/token-status | head -c 400
```

Expect a `statuses` object keyed by connection id. Judge it on three things, structurally:

- **The key set per entry is exactly** `eligible`, `scheduled`, `nextRefreshDueAt`,
  `attempt`, `lastRefreshAt` — and for an ineligible connection, `eligible` alone. An extra
  key means something started spreading the record instead of naming fields.
- **Both kinds of entry are present, and eligibility discriminates on the right things.**
  Cross-check against `/api/providers` rather than eyeballing the totals:

  ```
  # every disabled connection must be eligible:false — the condition that was missed once
  curl -s localhost:20127/api/providers | grep -c '"isActive":false'
  ```

  Then confirm no connection is both `isActive: false` and `eligible: true`, and none with
  a non-`oauth` `authType` is eligible. **The totals alone will not tell you this.** An
  install can have zero API-key connections, in which case `authType` is untestable here;
  and the disabled set can coincide with the no-refresh-token set, in which case adding or
  removing the `isActive` condition does not move the count at all. Both were true of the
  install this was built on, which is why the assertion is per connection and not a
  subtraction. All entries eligible means the predicate stopped discriminating; all
  ineligible means it stopped seeing `refreshToken`, which the route reads from the
  repository precisely because `GET /api/providers` blanks it.
- **No credential appears anywhere in the payload.** Grep it for `accessToken`,
  `refreshToken` and `apiKey` and expect nothing. This is the real check on the route naming
  its fields rather than filtering afterwards.

```
# 10. Attempts are actually being recorded.
curl -s localhost:20127/api/token-status | grep -o '"ok":[a-z]*' | sort | uniq -c
```

**Needs one sweep to have run, and waiting is not enough to get one.** The scheduler starts
from `initializeApp`, which runs from `src/app/layout.js`, so it takes a request to a
**dynamically rendered** dashboard page — `/dashboard/providers/<id>`. A prerendered page such
as `/dashboard` will not do it, because its layout ran at build time, and neither will an API
route. `custom-server.js` has a `server.once("listening")` start hook of its own, but from the
repo root it prints `"next start" does not work with "output: standalone"` and that hook never
fires, so do not count on it. Watch for `BG_TOKEN_REFRESH` `Scheduler started` in the log,
then give it `INITIAL_DELAY_MS` plus a tick.

Expect a non-zero count of `"ok":true`. Zero attempts recorded at all, with eligible
connections present, points at checklist 19 — something stopped going through
`checkAndRefreshToken` — or at the scheduler not running, which
`DISABLE_BACKGROUND_TOKEN_REFRESH` also causes.

**Judge the schedule structurally, not by eye.** Pick one entry with a recorded success and
confirm `attempt.at` and `lastRefreshAt` agree **to within a few milliseconds**, which is
what "the same refresh wrote both" actually looks like. **Do not test them for equality**, and
**do not read the spread as a bound either.** They come from two separate `Date.now()` calls,
so they routinely differ and neither value is wrong: measured twice on the same install over
364 recorded successes, first 217 exactly equal with 147 off by 1 to 2 ms, then 228 equal with
134 off by 1 ms, one by 2 and one by 4. An equality check therefore reports roughly 40% of a
healthy install as broken, and the 4 ms sample the second reading produced but the first did
not is why no ceiling written here would survive the next one — the two calls are ordered, not
spaced. A real fault is a gap of seconds or more, one field missing entirely, or the sign
reversed.

**The sign is the part `isSupersededByLastRefresh` depends on.** `attempt.at` must be the
later of the two on a recorded success, which is what keeps the record from being discarded on
read. An entry with `lastRefreshAt` ahead of it means the ordering inside
`mergeRefreshedCredentials` has moved and every success is now retired the moment it is
written: the row keeps a plausible time and quietly loses the ability to say "failed". A
`"ok":false` count dropping to zero on an install that used to have some is the same symptom
from the other side.

Then confirm `nextRefreshDueAt − attempt.at` equals the token's lifetime minus
`resolveRefreshLeadMs(provider)`. A wall-clock impression cannot check this — the two
plausible answers, a provider's own lead and `BACKGROUND_REFRESH_LEAD_MS`, are close enough
to look alike. Do it per provider and the mirror proves itself: providers whose declared
`refreshLeadMs` is below the background floor should all land on exactly
`BACKGROUND_REFRESH_LEAD_MS`, and one whose declared lead is above it should land on its
own. Both halves of the `Math.max` need to appear, or the check only exercised one branch.

A failing entry is worth reading rather than treating as a fault: `ok: false` with
`code: null` is the normal shape, because most providers return a bare `null`. An overdue
`nextRefreshDueAt` alongside it is the exact condition this feature was built to surface.

Then open `/dashboard/providers/<provider>` and check the list:

- An OAuth row shows a `Token:` line; an API-key or cookie row shows none. Present on every
  row means eligibility stopped discriminating; absent everywhere means the fifth fetch in
  `fetchConnections` is failing, which is silent by design — read the network tab.
- The line names a time, not `Invalid Date` or `NaN`. That is what a changed `expiresAt`
  format would produce, and `getCredentialExpiryMs` is the only thing normalising it.
- A row with a recorded failure shows the failure half in red, and a permanent one says
  re-authentication rather than a code.

```
# 11. Upstream's own stamp is still intact, since the fork reads it as a fallback.
curl -s localhost:20127/api/providers | grep -c '"lastRefreshAt"'
```

Non-zero on an install with OAuth connections. This is not a `tokenstat` field — it is
upstream's, and the fork deliberately does not write it. Zero means upstream stopped
stamping it, which costs the fallback for connections with no recorded attempt but nothing
else; a row would then read "no refresh recorded yet" until the next sweep.
