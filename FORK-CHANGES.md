# Fork changes

What this fork adds on top of upstream, and what to check when merging upstream
into it.

- Upstream: [`decolua/9router`](https://github.com/decolua/9router) (remote `upstream`,
  default branch `master` — there is no `main`)
- Fork point: `699edac3`, tag `v0.5.55`
- Last merged from upstream: nothing yet, still sitting on the fork point
- Features, oldest first: [`logs`](#feature-logs) (unredacted request inspector),
  [`locks`](#feature-locks) (configurable account cooldowns and a per connection release
  button), [`conntest`](#feature-conntest) (Test on each Connections row)

**Merging right now?** In order:

1. Before merging, read `git diff HEAD..upstream/master --stat` against
   [What upstream can break](#what-upstream-can-break). That turns upstream's file list
   into a shortlist of what to watch, and it is the only step that catches trouble in
   files the fork never edits.
2. Merge, resolve conflicts.
3. Run `node scripts/fork-check.mjs`. It executes every grep in the
   [checklist](#upstream-merge-checklist) and prints one line per item, so a clean run
   answers items 1 to 19 in one command and a failing one names the item to read.
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

  **A file can carry more than one tag, and three do.** Tag every feature whose code is
  in the file rather than picking the dominant one, or dropping a feature leaves its lines
  behind in a file that no longer mentions it. The consequence for greps: per-feature
  counts overlap, so the whole-fork inventory uses the bare `FORK(` prefix and only
  per-feature checks use a full tag.

  **A file that belongs to no feature carries no tag, and the Added table is its only
  record.** Two do: this document and `scripts/fork-check.mjs`. The tag's job is to return
  one feature's footprint, so tagging fork-wide tooling with all three would inflate every
  per-feature count while telling nobody anything. Keep such files out of the tag scheme
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

Every file the fork touches, across all features. Fourteen modified, ten added,
**+250 −30** in the modified ones.

```
git grep -l --untracked "FORK(" -- open-sse src
```

That returns twenty-two code files — every modified one, plus every added one except the
**two that belong to no feature and therefore carry no tag**: this document and
`scripts/fork-check.mjs`. Both are listed in the Added table below, which is their only
record; the scope above also does not reach `scripts/`, so tagging the script would not
change the count either way.

The bare `FORK(` prefix is what makes it whole-fork; a single feature is `FORK(logs)`,
`FORK(locks)` or `FORK(conntest)`, and those three sum to twenty-five rather than
twenty-two because three files carry two tags.

The tag is exhaustive for **edits**: an untagged file is one the fork does not modify.

It says nothing about risk. The fork also leans on upstream files it never edits, and
those carry no tag precisely because there is no fork code in them to hang it on. Read
the next section before concluding that an untagged file in upstream's diff is
harmless.

### Added

| File | Feature | Purpose |
| --- | --- | --- |
| `FORK-CHANGES.md` | — | This file. |
| `scripts/fork-check.mjs` | — | Runs checklist items 1 to 19 and prints pass/fail per item. Holds the same expected numbers as the checklist, so **the two must be updated together** — nothing detects a disagreement between them. Node rather than a shell script so one copy works on Windows and POSIX; asserts nothing about lint, build, tests or the post-merge check. |
| `src/lib/requestLogsFs.js` | logs | Read-only accessor for the `logs/` tree: name parsing, stage reading, outcome resolution, retention. Rewrites nothing it reads. **The only fork-added code that deletes files** — `pruneSessions` is its single `fs.rmSync`. Upstream deletes in several places of its own (`src/mitm/*`, `src/lib/db/backup.js`, `src/lib/tunnel/*`, `open-sse/executors/devin-cli.js`), so this is a claim about the fork's diff, not about the repo. |
| `src/app/api/logs/records/route.js` | logs | List endpoint, and the only one the list view calls — so retention is triggered from here. Metadata only. |
| `src/app/api/logs/session/[name]/route.js` | logs | Reads one session's stages, lazily, per opened row. |
| `src/app/(dashboard)/dashboard/usage/components/LogsTab.js` | logs | The tab: filters, table, and a side panel with the summary and the raw dump. |
| `src/lib/lockPolicy.js` | locks | The settings keys and the resolver that remaps upstream's computed cooldown onto a configured one. Pure, imported by both server and client. |
| `src/app/api/locks/reset/route.js` | locks | Clears every `modelLock_*` on one connection plus the error state. The only fork route that mutates a connection. |
| `src/app/(dashboard)/dashboard/profile/components/LockDurationsCard.js` | locks | The six duration fields on the Settings page. Reads and writes `/api/settings` itself. |
| `src/shared/utils/connectionTest.js` | conntest | Client wrapper around `POST /api/providers/<id>/test`. Adds the timeout that route has no server-side equivalent for. |

### Modified

| File | Feature | Δ | Change |
| --- | --- | --- | --- |
| `open-sse/handlers/chatCore.js` | logs | +5 −1 | `logDir: reqLogger.sessionPath` in `sharedCtx`, plus the two error-path `saveRequestDetail` calls that run before it exists. |
| `open-sse/handlers/chatCore/requestDetail.js` | logs | +4 | `buildRequestDetail` passes `logDir` through. |
| `open-sse/handlers/chatCore/streamingHandler.js` | logs | +5 −2 | `logDir` destructured in `handleStreamingResponse` and `buildOnStreamComplete`, forwarded in both record calls. |
| `open-sse/handlers/chatCore/nonStreamingHandler.js` | logs | +3 −1 | Same, one call site. |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` | logs | +5 −2 | `logDir` added to the local `ctx`, which is spread into both record calls. |
| `open-sse/utils/requestLogger.js` | logs | +26 −18 | `maskSensitiveHeaders` enabled and applied at all four write sites. |
| `src/lib/db/repos/requestDetailsRepo.js` | logs | +24 | Stores the dump directory *name* as `logDir`; copies `stream` to the top level of the record. |
| `src/lib/db/repos/settingsRepo.js` | logs | +9 −1 | `enableObservability` defaults to `true`; new `requestLogsMaxSessions`. |
| `src/dashboardGuard.js` | logs, locks | +29 | `/api/logs` and `/api/locks` added to `LOCAL_ONLY_PATHS`. Mostly comment: the `/api/locks` entry records what the guard does *not* cover. |
| `src/app/(dashboard)/dashboard/usage/page.js` | logs | +7 −1 | Registers the tab under the key `inspector`. |
| `src/sse/services/auth.js` | locks | +26 −3 | `markAccountUnavailable` reads settings once and routes two of its three cooldown branches through the resolver. The whole runtime footprint of configurable durations. |
| `src/app/(dashboard)/dashboard/profile/page.js` | locks | +6 | One import, one render line for `LockDurationsCard`. |
| `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` | locks, conntest | +59 −1 | Two buttons — Unlock (conditional) and Test — plus `onResetLock`, `onTest`, `testBusy` and the local `resettingLock` state. |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | locks, conntest | +42 | `handleResetConnectionLock`, `handleTestConnection`, and the three props. `handleRunOneByOneTest` is untouched. |

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

- **Never copy an upstream numeric constant into `DEFAULT_SETTINGS`.** Store nothing,
  and resolve an absent value to the imported constant instead. A copied number is a
  second source of truth that goes wrong silently the moment upstream retunes the
  original, and no check in this file can catch it — the value stays plausible. This is
  what `src/lib/lockPolicy.js` does for all six of its keys, and it is also why
  `requestLogsMaxSessions` is the exception rather than the pattern: that key has no
  upstream counterpart to disagree with. The useful side effect is that an install which
  never opens the new UI behaves exactly like upstream, and "clear the field" becomes the
  reset-to-default gesture with no extra code.

- **Treat any new field on a `requestDetails` record as public.** Adding one is not a
  private act: `src/app/api/usage/request-details/route.js` spreads the whole record and
  blanks only `request`, `providerRequest`, `providerResponse` and `response`, so
  everything else is served to anyone who can reach the dashboard — that route is not in
  `LOCAL_ONLY_PATHS`, and `isAuthenticated()` passes everyone when `requireLogin` is
  off. `logDir` stores a bare directory name instead of an absolute path for exactly
  this reason. Weigh any new field against that route first, and if it must hold
  something local, reduce it at the single write point in `requestDetailsRepo.js`.

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
| `open-sse/handlers/chatCore.js` and `chatCore/*` | Checklist 1 — the `logDir` thread |
| `open-sse/handlers/chatCore/streamingHandler.js` | Checklist 1, and 6: this file owns the placeholder text the outcome logic compares against |
| `open-sse/utils/requestLogger.js` | Checklist 2 (masking), 4 (session directory naming), 5 (stage filenames), 10 (the `logs/` root) |
| `src/lib/db/repos/requestDetailsRepo.js` | Checklist 7 (`truncateField`) on the write path. Also the read path: `getRequestDetails` does `SELECT data` and parses the whole blob, which is the only reason `logDir` and `stream` arrive with no reader-side code. A projection onto named fields would drop both in silence. |
| `src/lib/db/repos/settingsRepo.js` | Checklist 8 |
| `src/dashboardGuard.js` | Checklist 3 (`/api/logs`) and 16 (`/api/locks`) |
| `src/app/(dashboard)/dashboard/usage/page.js` | Tab registration — the `inspector` key must not collide with upstream's `logs` |
| `src/sse/services/auth.js` | Checklists 11 to 15 — every one of them is about whether the resolver still receives what it expects. This is the one runtime file the `locks` feature edits, so a refactor of `markAccountUnavailable` lands here and nowhere else. |
| `src/app/(dashboard)/dashboard/profile/page.js` | Nothing but the render line for `LockDurationsCard`. If upstream restructures the Settings page into tabs, the card needs a home in the new structure — it is self-contained, so that is a move, not a rewrite. |
| `src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js` | Both buttons live here. Upstream reworking the action cluster costs the two buttons; upstream renaming `isCooldown` or `connection.lastError` costs the Unlock button's visibility condition, which then either never appears or never hides. |
| `src/app/(dashboard)/dashboard/providers/[id]/page.js` | Checklist 18. `oneByOneResults` is shared between upstream's one-by-one run and the fork's per-row test, so its `{ state, error }` shape is a contract between them now. |

### Files the fork depends on but never edits

**No tag points at these.** This table is their only record.

| Upstream file | Threatens |
| --- | --- |
| `open-sse/config/errorConfig.js` | Checklists 11, 12 and 15. **The single most consequential file for the `locks` feature, and the fork does not touch it.** `lockPolicy.js` imports `BACKOFF_CONFIG`, `COOLDOWN_MS`, `TRANSIENT_COOLDOWN_MS` and `MAX_RATE_LIMIT_COOLDOWN_MS` and uses their values as the *keys* of its remapping, so upstream retuning a number is handled automatically while upstream removing or renaming an export is a build failure. Adding a rule with a new distinct duration is the quiet case: that rule keeps upstream's value and no configured field reaches it. **`COOLDOWN_MS` is the weak link:** upstream marks it backward compat, nothing in `open-sse` actually reads it, and the fork is its only real consumer — so it is the export most likely to disappear. Checklist 12 has the consumer list and the repair. |
| `open-sse/services/accountFallback.js` | Checklists 13, 14 and 17. Owns `getQuotaCooldown`, whose formula `resolveBackoffCooldownMs` mirrors; `checkFallbackError`, whose `newBackoffLevel` field is the only thing distinguishing a ladder duration from a fixed one; and `buildClearModelLocksUpdate` plus `MODEL_LOCK_PREFIX`, which the reset route uses so no lock-key naming is duplicated in fork code. |
| `src/app/api/providers/[id]/test/route.js` and `test/testUtils.js` | Checklist 18 — the row button reads `valid` and `error` from this route's JSON. The fork adds no test logic of its own, so every provider quirk in `testUtils.js` shows through unchanged. Worth knowing which: `claude`, `kiro`, `kimi`, `kimi-coding` are `checkExpiry` and `cursor`, `codebuddy-cn` are `tokenExists`, so for those six a green result means "a token exists and has not expired" and nothing reaches the provider. |
| `src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js` | **A divergent copy, deliberately left alone.** It carries its own inner `ConnectionRow` and `CooldownTimer`, duplicated by upstream, and is reached only from `dashboard/media-providers/[kind]/[id]`. Neither the Test nor the Unlock button was added to it, so media-provider connections have neither. Adding them would mean maintaining the same two buttons in two components that already drift. If upstream ever merges the two copies, the buttons come along for free — check that they did. |
| `open-sse/translator/formats.js` | Checklist 4 — a format id containing `_` splits every directory name wrongly. Thirteen ids today and none contains `_`: ten are single lowercase words, three are hyphenated (`openai-responses`, `openai-response`, `gemini-cli`). Read the **values**, not the keys — the keys do use underscores (`OPENAI_RESPONSES`) and never reach a directory name. |
| `open-sse/utils/stream.js` | "How outcome is decided", step 3 — it owns all three `[DONE]` append sites, and the fact that the translate path uses none of them is why the terminal-marker list cannot be narrowed to that one string. A new append site on the translate path would not break anything; losing `finish_reason` from the final chunk would. |
| `open-sse/transformer/responsesTransformer.js` | Checklist 9 — `createResponsesLogger` has no callers today; wiring it up puts directories in `logs/` that retention will not touch |
| `src/sse/handlers/chat.js` | Known limitations — its account loop is why rows are per attempt, and why some failures produce no row at all |
| `src/app/api/settings/route.js` | Checklist 8 — `PATCH` deletes `PROTECTED_SETTING_KEYS` and lets everything else through. Turning that into an allowlist silently drops `requestLogsMaxSessions` and all six `lock*Ms` keys; the Settings card would keep reporting a successful save while every value reverted to upstream's. |
| `src/app/api/usage/request-details/route.js` | Deliberately untouched — upstream's redaction has to stay as written. Also the reason record fields are treated as public: it forwards everything except the four payloads, and it is not local-only. |
| `src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js` | `LogsTab` carries copies of `getInputTokens`, `getCachedTokens` and `getCacheCreationTokens` from it, on purpose: the two tabs render the same rows, so a different rule in one would show two input-token counts for one request. Change either copy and change both. **Identical logic, not identical text** — `getCachedTokens` and `getCacheCreationTokens` are character-for-character copies, while `getInputTokens` matches only in its executable lines and carries a longer comment here explaining that it is a mirror. So a text diff of the three reports a difference that is not one, and nothing in the checklist can detect a real drift — the numbers stay plausible, they just disagree. |
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
   callback runs from the transform stream's flush, which a `TransformStream` invokes
   only on a clean close — never on abort or error. So a body that is no longer the
   placeholder, or a non-zero ttft or completion count, means the stream finished.

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
3. **The transcript tail**, which is what normally answers for a non-streaming row:
   `7_res_client.json` exists, or a terminal marker appears in `7_res_client.txt`'s tail.
   Neither `7_*` file present resolves to `incomplete`.

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

### Known limitations

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
- **Outcome filtering narrows the current page only.** It is derived per row, partly
  from the filesystem, so it cannot be a SQL predicate. The UI says so under the
  control.
- **Stage count varies per row**, from one to seven files, because a file exists only
  if that step ran: `3_req_openai.json` when the request goes through the OpenAI pivot
  (`translator/index.js`), `5_res_provider.json` and `7_res_client.json` for
  non-streaming against `5_res_provider.txt` and `7_res_client.txt` for streaming,
  `6_res_openai.txt` for translated streams, `6_error.json` on failure. The panel lists
  what is on disk rather than padding out absent stages.

  **Seven is the ceiling and one is the floor**, and both ends are easy to get wrong.
  `STAGE_FILES` in `requestLogsFs.js` lists ten possible names, and no row gets close to
  ten, for three separate reasons:

  - The `.json` and `.txt` variants of stages 5 and 7 are mutually exclusive —
    non-streaming writes the pair of `.json` files, streaming appends the pair of `.txt`
    ones.
  - **`6_res_openai.txt` and `6_error.json` cannot coexist**, which is what caps the total
    at seven rather than eight. `reqLogger.logError` has exactly one call site in the whole
    engine: inside `chatCore.js`'s `if (!providerResponse.ok)` block, which `return`s
    immediately after it. `appendOpenAIChunk` is only ever called from
    `open-sse/utils/stream.js`, which runs only once that return has been passed. So a
    translated stream that dies mid-flight leaves `6_res_openai.txt` and **no**
    `6_error.json` — nothing on the streaming path writes one.
  - Three of the four request copies are conditional. Stage 1 is written only
    `if (clientRawRequest)`; stage 3 only on the pivot path, from `translator/index.js`;
    stage 4 only *after* `executor.execute()` returns, from inside the same `try`.

  That last point is where the floor comes from. The `catch` around `executor.execute()`
  saves a `requestDetails` row without ever reaching stage 4 and without calling
  `logError`, so such a row can hold as little as `2_req_source.json` alone — the one
  unconditional stage.

  **Five to seven is the band for a request the provider answered *successfully*, not for
  one that merely reached it.** A non-2xx answer writes four in the common case —
  `1_req_client.json`, `2_req_source.json`, `4_req_target.json`, `6_error.json` — or five
  on the pivot path,
  because `chatCore.js`'s `if (!providerResponse.ok)` block calls `logError` and `return`s
  without ever calling `logProviderResponse`, so stages 5 and 7 never happen. **Read stage
  4 instead of the total**: it is written only after `executor.execute()` returns, so its
  presence means the provider was reached whatever the count. Judging by the count reads
  the most common row in the tab — a failed upstream call — as "never left the router",
  which is the opposite of what happened.

  Checked by reading, not counting: `git grep -n "reqLogger.logError\|appendOpenAIChunk" --
  open-sse` returns the two write sites and their call sites, and the point is whether any
  call site of the second can be reached after the first has run.
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

Instead: **leave `open-sse/` completely alone and remap the computed duration at the one
point where every cooldown path already converges.** `markAccountUnavailable` in
`src/sse/services/auth.js` is that point — it already imported `getSettings`, it already
held the only reader of `MAX_RATE_LIMIT_COOLDOWN_MS`, and it performs the single
`updateProviderConnection` write that stores the lock.

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

The response is `{ ok, cleared }`. **`cleared` counts every `modelLock_*` key that held a
value, expired ones included**, not the number of locks that were still active — expired
keys accumulate on a record until something clears them, and this route does clear them, so
reporting them is correct. It does mean `cleared: 3` can be one live cooldown and two stale
keys, which is why post-merge step 7 checks the five reset fields rather than trusting the
count. Nothing in the app reads `cleared`; the merge check is its only consumer.

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

### Known limitations

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
state.

**`handleRunOneByOneTest` is deliberately not refactored.** Routing that loop through the
same helper would remove upstream's duplicate `fetch`, and it was left in place anyway:
the duplication is upstream's and upstream maintains it, whereas rewriting that function
would put it on the merge-conflict surface for no visible gain.

### The timeout is the only new behaviour

Nothing on the server side of that route sets an `AbortSignal` or races a deadline —
`testUtils.js` calls `fetch` directly — so a provider that accepts the connection and then
stalls leaves the row spinning until the platform gives up. `TEST_TIMEOUT_MS` in
`connectionTest.js` is one deadline covering every provider, on the client, without
touching upstream. That trade is the reason the helper exists at all rather than the fetch
being inlined into the handler.

### Known limitations

- **The timeout is client-side only.** Aborting the fetch does not stop the server-side
  probe, which keeps running to completion. What it bounds is the spinner, not the work.
- **For six providers a green result does not mean the provider was contacted.**
  `claude`, `kiro`, `kimi` and `kimi-coding` are `checkExpiry` in `OAUTH_TEST_CONFIG`, and
  `cursor` and `codebuddy-cn` are `tokenExists`, so the test reads a stored expiry or the
  presence of a token and nothing leaves the machine. No per-provider handling was added
  for this on purpose — it would mean fork code tracking upstream's probe table.
- **A failing test can mean a broken proxy.** `testSingleConnection` probes the connection
  proxy first and short-circuits without contacting the provider if it is dead.
- **`lastError` being set does not imply a failure.** A soft success, such as Grok CLI's
  402 spending limit, keeps `testStatus: "active"` and puts the warning text in
  `lastError`.
- **No button on media-provider connections**, same divergent-copy reason as the Unlock
  button.

## Upstream merge checklist

Runs once for the whole fork. Feature tags are there so an entry can be dropped along
with its feature, not so the list can be split up.

**`node scripts/fork-check.mjs` runs items 1 to 19 and prints pass/fail for each**, so use
that rather than typing nineteen greps. What it cannot do is repair anything, or settle the
three items that need a human reading code rather than counting lines — items 4, 7 and 17,
which it reports as *to read* rather than passing. The commands stay quoted below because
they are the readable form of each assertion, and because a failing item is easier to
understand by running its own grep than by reading the script.

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

17. **[locks] The reset route still uses upstream's lock-key helpers.**
    `buildClearModelLocksUpdate` must keep enumerating `modelLock_*` by prefix off the
    record rather than from a fixed list, and `MODEL_LOCK_PREFIX` must stay exported. A
    fixed list means the reset misses any lock key upstream adds later, and the row keeps
    a cooldown the button claims to have cleared.

    ```
    git grep -n --untracked "buildClearModelLocksUpdate" -- open-sse src
    ```

    Expect three hits: the definition in `accountFallback.js`, and the import plus the
    call in `src/app/api/locks/reset/route.js`. Read the definition, not just the count —
    the count cannot tell a prefix scan from a fixed list.

    Do not widen this grep to `MODEL_LOCK_PREFIX`: upstream's
    `src/app/api/models/availability/route.js` declares its own local copy of that string
    rather than importing it, so the results mix two independent definitions. The reset
    route imports the real one.

18. **[conntest] `POST /api/providers/[id]/test` still answers `{ valid, error }`**, and
    the page's `oneByOneResults` entries are still shaped `{ state, error }`. The row
    button and upstream's one-by-one run both write that state and the badge reads it, so
    a shape change empties the badge with no error anywhere.

    ```
    git grep -n "valid: result.valid" -- src/app/api/providers/[id]/test/route.js
    ```

    Expect one hit. If upstream renames the field, `runConnectionTest` reports every test
    as failed.

19. **All features:** both tables still match reality — the inventory for edited files,
    and "What upstream can break" for the ones the fork only depends on. The grep
    covers the first; the second needs reading, so check it whenever a new import or
    `fetch` is added to fork code.

    ```
    git grep -l --untracked "FORK(" -- open-sse src
    ```

    Expect twenty-two files. Use the bare prefix, not one feature's tag — three files
    carry two tags, so per-feature greps overlap and none of them is the whole fork. The
    two untagged added files are outside this count by design; see the inventory.

20. **Update the expected counts in items 1 to 18 if upstream legitimately changed
    them — in this file *and* in `scripts/fork-check.mjs`.** Those numbers are assertions
    about upstream's code, so they go stale by design: a mismatch is an invitation to look,
    not proof of breakage. Once you have confirmed the new shape is correct, write the new
    count into both places. Nobody else owns them: item 19 covers the two tables and item
    21 covers the tests, so a stale count here silently degrades into a check that always
    fails and gets skipped.

    **The script is a second copy of every number in items 1 to 19, and nothing compares
    the two.** That is the price of having one command instead of nineteen greps; the
    failure mode is a script that passes while this document says something else, so update
    them in the same commit. If they ever disagree, the document is the source — the script
    is only its executable form.

21. Re-run lint, build, the test comparison and the post-merge check below.

## Verifying

```
npx eslint .
npm run build          # /api/logs/records, /api/logs/session/[name] and /api/locks/reset
                       # in the route list
```

A plain checkout reports around 135 eslint errors, all inherited from upstream
(`react-hooks/set-state-in-effect` in `src/shared/hooks/useModelCaps.js` and friends).
Lint the fork's own files to get a clean signal.

**Lint the added files and the modified ones separately.** The added files must come back
completely clean; the modified ones carry upstream's pre-existing errors, so the only
useful question there is whether the count changed. Stash the fork's edits to those files
and lint them again to get the before number — `src/app/(dashboard)/dashboard/providers/[id]/page.js`
and `ConnectionRow.js` together report three errors and one warning either way.

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

**`tests/__baseline__/verify-no-regression.mjs` does not work on Windows.** It keys
failures on `f.name.split("/app/")[1]`, a Docker path absent from any local checkout,
so every existing failure registers as a regression. `known-fails.txt` is stale
against this checkout too — the local Vitest version discovers considerably more tests
than the baseline was recorded with.

Compare the suite against itself instead:

```
cd tests && npx vitest run --reporter=json --outputFile=fork.json
cd .. && git stash push -- <the modified files from the inventory>
cd tests && npx vitest run --reporter=json --outputFile=base.json
cd .. && git stash pop
```

Diff the `fullName` values of failed assertions. A regression is a name failing in
`fork.json` but not in `base.json`. Judge only by that: the totals wobble between runs
because the suite contains live-provider and timing-sensitive tests. Around 90
failures on both sides is normal on this checkout.

**Compare the file-level results too, not only assertion names.** A suite can fail with
every assertion passing — a throw in `beforeAll` or `afterAll` produces no `fullName`,
so an entire file blowing up is invisible in the comparison above. On Windows this is
not hypothetical: temp-directory cleanup in an `afterAll` raises `EPERM` while a handle
is still open. Diff the failed `testResults[].name` paths alongside the assertion names.

Two things to control for:

- **Clear `ENABLE_REQUEST_LOGS` before measuring.** Vitest does not load `.env`, but if
  the variable is exported in your shell it overrides `enableObservability` and several
  assertions in `unit/request-details-tab.test.js` flip. Both runs must see the same
  value or they are not comparable.
- Vitest rewrites `tests/translator/__snapshots__/*.snap`, mostly LF → CRLF. Check with
  `git diff --ignore-cr-at-eol` and revert the noise.

The fork should pass two tests upstream fails, both in `unit/request-details-tab.test.js`
and both because recording is on by default: `returns unique provider list without
parsing data blobs` and `oversized field → stored truncated + reparseable (no circular)`.

### Post-merge check

Lint, build and tests are all static or unit level; none of them proves the feature
still works end to end. Eight checks do, against a running instance — substitute your
port, and note that `/api/logs` and `/api/locks` only answer on loopback, which is what
step 5 tests.

Steps 1 to 5 cover `logs`, steps 6 and 7 cover `locks`, step 8 covers `conntest`.

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
means the provider was reached. See "Stage count varies per row" under
[Known limitations](#known-limitations) before reading a short array as a fault. No
`outcome` key — that belongs to the list endpoint alone. Confirm a `headers` object shows `<redacted>` rather than a live token: since
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

Expect `{"ok":true,"cleared":N}`. **Do not judge by `N`** — it counts every `modelLock_*`
key that held a value, expired ones included, so it can be non-zero with nothing live
released. It is a hint, not the assertion.

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
- A row with an active cooldown or a `lastError` also has an **Unlock** button, and a
  healthy row does not. Present on every row means `isCooldown` or `connection.lastError`
  stopped resolving; absent on a locked row means the same in the other direction.
- The Settings page at `/dashboard/profile` shows the Account Lock Durations card with six
  fields, each showing upstream's value as placeholder text when empty.

Then open the logs tab itself at `/dashboard/usage?tab=inspector`, since the steps above say
nothing about the components `LogsTab` borrows from `src/shared/components`. Empty
provider or account columns with rows otherwise present is the signature of a changed
response shape on `/api/usage/providers`, `/api/provider-nodes` or `/api/providers`.
