# Fork changes

Everything this fork changed relative to upstream, organised so that an upstream merge can
be resolved file by file.

- **Upstream:** [`decolua/9router`](https://github.com/decolua/9router) — remote `upstream`,
  default branch `master` (there is no `main`)
- **Fork point:** `699edac3` (`v0.5.55`) · **last merged:** `v0.5.65`
- **Why each feature exists, and what the user asked for:** `Specs.md`. This file does not
  repeat it.

## Merging: do this

1. `git diff HEAD..upstream/master --stat`, then look up every file it lists in
   [Modified upstream files](#modified-upstream-files) and
   [Depended on, never edited](#depended-on-never-edited). The second table is the one
   nothing else can tell you — those files carry no fork code, so no grep finds them.
2. Merge. Resolve conflicts using the **Kind** column: it says whether fork code sits
   *beside* upstream's or *replaces* it, which is the whole question in a conflict hunk.
3. `node scripts/fork-check.mjs` — runs every mechanical assertion and prints one line per
   item. It names what moved; this file says what to do about it.
4. Read [Cross-file threads](#cross-file-threads). Those are the breakages a per-file
   review cannot see, and the script only covers some of them.
5. `npx next build --webpack`, then `npx eslint <changed files>` — **scoped, not `.`**; see
   [Verifying a merge](#verifying-a-merge) for why, and for the test suite, which is its own
   npm project under `tests/` rather than a root script.

**Find fork code:** `git grep -l --untracked "FORK(" -- open-sse src`. Keep `--untracked` —
a file added by uncommitted work is otherwise absent from the results, which reads as a
missing tag.

## Feature tags

Seven tags over the eleven requirements in `Specs.md`. A hunk's tag is the way from a conflict
to the behaviour that has to survive it.

| Tag | `Specs.md` |
|---|---|
| `locks` | 1.1, 1.2 |
| `conntest` | 2.1 |
| `tokenstat` | 2.2 |
| `smartrouting` | 3.1, 3.2 |
| `attempts` | 4.1, 4.2, 4.3 |
| `logs` | 5.1 |
| `smartlogs` | 5.2 |

`logs` is the log itself and `smartlogs` the page that shows it — the one pair the names do not
separate. Many files carry more than one tag, so no single tag is the whole of a feature.

## Kind legend

| Kind | Meaning in a conflict hunk |
|---|---|
| `+ beside` | Pure addition. Upstream's lines are untouched — keep both sides. |
| `~ replaced` | Fork code stands **in place of** upstream's. Keep the fork side; re-applying upstream's version restores the old behaviour silently. |
| `= retuned` | Same upstream code, different value. Keep the fork's number. |
| `↔ extracted` | Upstream code moved into a fork module; the upstream file now imports it. Do **not** keep both — see the file's note. |
| `− reverted` | The fork used to edit this and no longer does. Take upstream verbatim. |
| `− removed` | A file the fork added and has since deleted. Upstream has no version, so there is nothing to restore and nothing to resolve. |

---

## Modified upstream files

### `open-sse/` — request engine

| File | Tags | Kind | What the fork did | Watch for |
|---|---|---|---|---|
| `handlers/chatCore.js` | logs, smartrouting, smartlogs | `+ beside` | `logDir` and `sessionTag` into `sharedCtx` and into the two early-error `saveRequestDetail` calls; `reqLogger` passed to `handleForcedSSEToJson`; `errorSignals` destructured from `parseUpstreamError` and handed to `createErrorResult`. | The `reqLogger` argument. Dropping it is silent — see [thread 2](#2-reqlogger-on-the-third-response-path). |
| `handlers/chatCore/requestDetail.js` | logs, smartlogs | `+ beside` | `buildRequestDetail` forwards `logDir` and `sessionTag`. Both opaque here. | Nothing specific. |
| `handlers/chatCore/streamingHandler.js` | logs, smartlogs | `+ beside` | Both fields destructured and forwarded in **both** record calls. | A streaming row is upserted twice under one id; a field on only one write disappears on the second. Also owns the placeholder text the outcome logic compares against. |
| `handlers/chatCore/nonStreamingHandler.js` | logs, smartlogs | `+ beside` | Same, one call site. | Nothing specific. |
| `handlers/chatCore/sseToJsonHandler.js` | logs, smartlogs | `+ beside` | Dump field and `sessionTag` on the local `ctx` (spread into both record calls); `reqLogger` in the signature and five stage writes. | Same as `chatCore.js`: this handler only logs because it is *given* the logger. |
| `utils/requestLogger.js` | logs | `~ replaced` | Upstream's `maskSensitiveHeaders` was a deliberate no-op with the real masking commented out. The fork replaced the body and additionally routes the **provider response headers** through it — a write site upstream never wired up at all. | • Any resolution that restores upstream's `return { ...headers }` writes live tokens to disk.<br>• A new stage that skips the helper reintroduces the leak with no error. |
| `utils/error.js` | smartrouting | `+ beside` | `captureRateLimitHeaders` and its header allow-list; `parseUpstreamError` returns `errorSignals` on **both** branches; `createErrorResult` gained a fourth parameter. | • The only place in the request path still holding the upstream `Response`, so the only place headers can be captured.<br>• `createErrorResult` is now positional to four and every value is an object or `undefined` — an inserted parameter shifts it silently.<br>• If upstream reads `response.text()` earlier and passes a string, capture fails **open** (empty object) and classification quietly loses the header signal. |
| `utils/sessionManager.js` | smartrouting | `+ beside` | `resolveConversationKey` added. Nothing existing touched. | It calls two **file-local** functions, so a rename is a build failure (safe). The silent direction is retuning the assistant-text length bounds — that changes which conversations get an identity and how stable it stays. |
| `handlers/embeddingsCore.js` | smartrouting | `+ beside` | `errorSignals` forwarded; `undefined` in the reset slot. | Nothing specific. |
| `handlers/imageGenerationCore.js` | smartrouting | `+ beside` | Same, one call site. | Nothing specific. |

### `src/sse/` — account selection and the attempt loop

| File | Tags | Kind | What the fork did | Watch for |
|---|---|---|---|---|
| `services/auth.js` | locks, smartrouting, smartlogs | `+ beside`, `~ replaced` | **Three features live here; the largest single edit.**<br>• `getProviderCredentials`: an `options.sessionKey`, a third strategy branch, and the inline strategy precedence extracted to `resolveProviderStrategy`.<br>• `markAccountUnavailable`: an optional `errorSignals` parameter; reads settings once; routes two of its three cooldown branches through the lock resolver; computes a `lockScope` shared by lock and score; folds the error-score update into its single write; logs a demotion separately.<br>• `clearAccountError`: computes the score clear **before** its two early returns. | • The `resetsAtMs` branch is where `v0.5.59` conflicted; its antigravity carve-out skips the *cap*, not the resolver.<br>• The settings read stays in `try`/`catch`, never `.catch()` — an upstream test mocks the db module and the throw is **synchronous**, so no promise exists to catch.<br>• A refactor of `markAccountUnavailable` lands here and nowhere else. |
| `services/tokenRefresh.js` | tokenstat | `+ beside` | `recordRefreshAttempt` called from both branches of `checkAndRefreshToken`. Upstream's `if` condition line is untouched. | Two silent risks:<br>• Upstream retuning the success condition reclassifies attempts — the recorded outcome is decided by *which branch ran*.<br>• An early `return` inside the refresh block skips both calls, which reads as a connection that stopped being refreshed rather than one that stopped being recorded. |
| `handlers/chat.js` | smartrouting, smartlogs, attempts | `~ replaced` | • `while (true)` walk replaced by one `runAccountAttempts` call whose `attempt` is the old loop body.<br>• The only call site with an `onAttemptFailed` hook — Antigravity's quota API is consulted for an exact reset before any lock is written.<br>• **Where the raw conversation id lives and stops**: split into a binding key and a fingerprint, and never forwarded.<br>• Carries `clearAntigravityStrikes` in its `onRequestSuccess`, and `allLockedStatus`. | • Keeps its own `noCredentialsStatus` (404) and message — both differ from the other eight and both are client-visible.<br>• Its account walk is why log rows are per attempt, and why some failures produce no row at all.<br>• **Both values upstream puts inside its own walk have to be carried by hand here**, and their absence is silent: `clearAntigravityStrikes` (see [thread 6](#6-clearantigravitystrikes-on-the-success-path)) and the 503 (see the loop's row below). |
| `handlers/embeddings.js` | attempts | `~ replaced` | Loop replaced. The usage save stays inside `attempt` because it needs the connection id. | |
| `handlers/fetch.js` | attempts | `~ replaced` | Loop replaced. Supplies `buildFailureResponse` — it answers with its own JSON envelope. | `webfetch:<providerId>` is the lock key, held in one const because the read and both writes must agree. **It used to be `null` and that is now wrong**: `v0.5.65` made Ollama a fetch provider, and Ollama serves chat and fetch from one connection, so the account-wide key took the LLM side offline with it. An upstream test asserts this key and the exact argument list on this path. |
| `handlers/imageGeneration.js` | attempts | `~ replaced` | Loop replaced; `handleSingleModelImage` gained `signal` in its options. | Losing `signal` opts this handler out of the disconnect stop with no error. |
| `handlers/search.js` | attempts | `~ replaced` | Loop replaced. The credential-fallback provider hop moved in as `credentialFallbackProvider`, which also reports which provider owns the connection so the lock is attributed correctly. | `websearch:<id>` stays the lock key. |
| `handlers/stt.js` | attempts | `~ replaced` | Loop replaced. | |
| `handlers/tts.js` | attempts | `~ replaced` | Loop replaced; `handleSingleModelTts` gained a `request` parameter for the signal, threaded from both call sites. | Same signal caveat as `imageGeneration.js`. |
| `handlers/videoGeneration.js` | attempts | `~ replaced` | Create loop replaced, with `shouldRotate` carrying an allow-list — a 5xx may already have created a billable job, so it is returned rather than re-sent. `sanitizeSecrets` moved onto the result `attempt` returns. | **`handleVideoGet` is deliberately untouched** and still calls the credential lookup and the failure marker directly: jobs are account-bound upstream, so it is a single attempt by design. |

### `src/app/api/`

| File | Tags | Kind | What the fork did | Watch for |
|---|---|---|---|---|
| `v1beta/models/[...path]/route.js` | smartrouting, attempts | `~ replaced` | The ninth account walk, and the only one outside `src/sse/handlers/`. Replaced by `runAccountAttempts`, with `onExhausted` for its own response shape and its own `errorSignals` (it reads the upstream response directly). | • Its per-attempt `AbortController` and TTS fetch timeout stay **local** — the loop bounds the walk, that bounds one call.<br>• The missing-API-key and client-abort cases return `{ success: true }` carrying an error `Response`. "Correcting" either to `success: false` is a silent behaviour change that burns the account pool on the way out. |

### `src/app/(dashboard)/` — UI

| File | Tags | Kind | What the fork did | Watch for |
|---|---|---|---|---|
| `profile/page.js` | locks, smartrouting, attempts | `+ beside`, `~ replaced` | • One import and one render line each for `LockDurationsCard` and `AttemptLimitsCard`.<br>• Routing Strategy card: Round Robin `Toggle` → `Select` over the shared option list; hint line read from the same list; sticky-limit condition and closing status sentence switched to the strategy constants, with a third branch added. | If upstream restructures Settings into tabs, both cards need a home — they are self-contained, so that is a move, not a rewrite. |
| `providers/[id]/ConnectionRow.js` | locks, conntest, tokenstat | `+ beside` | Unlock (conditional) and Test buttons, `onResetLock` / `onTest` / `testBusy` props and local reset state; one `tokenStatus` prop and one status line in the info column. | Upstream renaming the cooldown or last-error field costs the Unlock button's visibility condition, which then either never appears or never hides. |
| `providers/[id]/page.js` | locks, conntest, tokenstat, smartrouting | `+ beside`, `~ replaced` | • `handleResetConnectionLock` and `handleTestConnection` — both end in a connection refetch; the reset also surfaces a non-2xx.<br>• `tokenStatuses` state, a fifth entry in the `fetchConnections` `Promise.all`, three new props.<br>• `handleRoundRobinToggle` → `handleStrategyChange` with a `Select`; **`Toggle` removed from the shared-components import** — that switch was its only use on the page. | • The `Promise.all`: a botched resolution loses `tokenStatuses` with no error; the status line just stops appearing.<br>• `oneByOneResults` is now shared between upstream's batch run and the fork's per-row test, so its `{ state, error }` shape is a contract.<br>• Upstream re-adding a `Toggle` needs the import back.<br>• `handleRunOneByOneTest` is untouched. |
| `providers/components/ConnectionsCard.js` | smartrouting, smartlogs | `~ replaced` | Media providers' only strategy control.<br>• Boolean Round Robin toggle → `Select`. The toggle tested for one string, so a stored `smart-routing` rendered **unchecked** — the card misreported its own state and the first touch overwrote the setting.<br>• Its inner countdown delegates to the shared hook. | • This card and `providers/[id]/page.js` write the **same** per-provider strategy entry, and provider ids overlap between them.<br>• Smart Routing is deliberately *shown but not offered* here — only surfaced, first and labelled, when it is already the stored value.<br>• Everything else about this card is still a divergent copy: no Test button, no Unlock button. |
| `usage/components/RequestDetailsTab.js` | logs | `↔ extracted` | Three local token helpers deleted; imported from `src/shared/utils/usageTokens.js` instead. **The only upstream file the fork edits without adding behaviour.** | • Re-adding upstream's local copies **alongside** the import is a `SyntaxError` — an ES module cannot redeclare an imported binding.<br>• Dropping the import leaves three undefined calls.<br>• **The one resolution that builds and is still wrong:** delete the import, keep upstream's copies. That re-opens the drift the extraction closed. |

### `src/lib/`, `src/shared/`, guard

| File | Tags | Kind | What the fork did | Watch for |
|---|---|---|---|---|
| `src/lib/db/repos/requestDetailsRepo.js` | logs, smartlogs | `+ beside` | Stores the dump directory **name** as `logDir`, copies `stream` to the record's top level, stores `sessionTag`. All three sit outside the truncated payload fields. | The read path does `SELECT data` and parses the whole blob, which is the only reason these arrive with no reader-side code. A projection onto named fields drops all three in silence. |
| `src/lib/db/repos/settingsRepo.js` | logs, attempts | `= retuned`, `+ beside` | `enableObservability` default `false` → `true`. New keys: `requestLogsMaxSessions`, `maxAccountAttempts`, `accountAttemptWindowMs` — the last two **imported** from `src/lib/attemptPolicy.js` rather than written here. | Keep the import. The resolver, the Settings card and this default must be one number. |
| `src/dashboardGuard.js` | logs, locks | `+ beside` | `/api/logs` and `/api/locks` added to `LOCAL_ONLY_PATHS`. | Deny-by-default is not enough on its own: the auth check passes everyone through when login is not required. `/api/settings` is deliberately **not** on the list — see the comment in the file for what that does and does not buy. |
| `src/shared/components/Sidebar.js` | smartlogs | `+ beside` | One nav entry for Smart Logs, after Usage. | • `isActive` matches with `startsWith`, which keeps the entry lit on the provider detail route. Tightening it to equality unlights it.<br>• Nothing counts this — a missing link is visible immediately. |
| `src/shared/components/Header.js` | smartlogs | `+ beside` | Two branches in `getPageInfo`: a regex match for the provider detail route with breadcrumbs, plus the page title. | • **They must stay first in the chain.** Everything below matches with `pathname.includes(...)`, so a later branch can capture a provider id from the detail URL — an id containing `endpoint` or `quota` is enough.<br>• Upstream inserting a branch above them re-opens it, and the only symptom is a wrong page title. |

---

## Cross-file threads

Six things that a single-file review cannot see. Each is a value that must survive every
hop, or a shape that must hold across files.

### 1. `logDir` — the log record's link to its dump

`requestLogger` → `chatCore.js` (`sharedCtx`) → `requestDetail.js` → the three response
handlers → `requestDetailsRepo.js`. **What is stored is the directory name, never the
path** — the record is published by a route that blanks only the payload fields and is not
loopback-only, so a full path would hand out the install directory and the OS username.
The read side rejects anything path-shaped, so removing the reduction does not fail: every
row silently becomes "no dump on disk". Covered by fork-check item 1.

### 2. `reqLogger` on the third response path

`chatCore.js` picks one of three response handlers and upstream passes `reqLogger` to only
two. The fork passes it to the third by name. **No count covers this**: drop the argument
in a conflict and that path answers requests normally while writing no stages at all.

### 3. `sessionTag` — which conversation a log row belongs to

`chat.js` (fingerprint, derived once) → `chatCore.js` → `requestDetail.js` → the three
response handlers → `requestDetailsRepo.js`. Two rules: the fingerprint is computed in
**one** place (the session cards and the log rows are matched by eye — a second
transformation gives one conversation two tags and the matching silently stops working),
and the raw conversation id never crosses into `open-sse`. Covered by items 33 and 34.

### 4. `errorSignals` — the response headers behind heavy/light classification

`open-sse/utils/error.js` (the only place still holding the upstream `Response`) →
`createErrorResult` → the modality cores → `markAccountUnavailable`. Additive throughout:
without it, classification falls back to status code and message. Covered by item 24.

### 5. The nine account walks

Eight handlers under `src/sse/handlers/` plus the Gemini-native route, all delegating to
`runAccountAttempts`. **The resolution to avoid is reinstating a local `while (true)` walk
beside the shared call** — it works, which is exactly why nothing flags it. Item 29 counts
loops for that reason. Separately, the client abort signal has to be threaded from each of
the nine call sites; a site that skips it opts out of the disconnect stop with no error.

The direction no check covers at all: because nine near-identical loop bodies were hoisted
into one file, **an upstream one-line fix inside any of those bodies lands in a file upstream
does not have.** Git raises no conflict, the build passes, and `fork-check.mjs` asserts
nothing about it — the fix is simply absent. `v0.5.65` did this twice, and both had to be
carried by hand: the all-locked 503 and `clearAntigravityStrikes`. So reading
`git log -p upstream/master -- src/sse/handlers/` for one-line changes inside the old loop
bodies is part of a merge, not an optional extra. Worth noting upstream retuned **only**
chat both times, so the answer is usually an override at one call site rather than an edit
to the shared expression.

### 6. `clearAntigravityStrikes` on the success path

`antigravityQuota.js` counts a connection+model pair's 429s and, at three inside a minute,
cache-blocks the pair for fifteen minutes regardless of what the quota API claims. Upstream
clears that counter from an `onRequestSuccess` inside its own account walk — the walk this
fork replaced — so **the call exists only because `chat.js` carries it by hand.** Dropping it
leaves the import as the sole trace, and "consecutive" stops meaning consecutive: a pair that
has recovered stays blocked the full fifteen minutes while answering normally. Nothing counts
this, and the block is invisible in the dashboard because this path writes no `modelLock_*`.

---

## Files the fork added

No conflict surface — upstream has no version of these. Listed so a merge knows what
exists and what each file owns.

| File | Tags | Owns |
|---|---|---|
| `src/lib/lockPolicy.js` | locks | The six settings keys, the fork's default for five of them, and the resolver that remaps upstream's computed cooldown. Pure; imported by server **and** client. |
| `src/lib/errorPolicy.js` | smartrouting | The fork's classification and the **only** place a matched error phrase lives. Two entry points over one phrase table: heavy/light weight, and "is the request itself at fault". Also the provider-reported wait parser. Pure. |
| `src/lib/smartRouting.js` | smartrouting, smartlogs | The comparator and the counter arithmetic, the demote threshold and weights, and the two flat-field key builders plus their reverse. No db import — `auth.js` owns the writes. |
| `src/lib/routingStrategy.js` | smartrouting, smartlogs | The three strategy values, their labels, the inherit sentinel, and `resolveProviderStrategy`. **Zero imports on purpose** — both Settings surfaces need the option list, and reaching the classification chain from a client component would ship the whole phrase table to the browser for three labels. |
| `src/lib/attemptPolicy.js` | attempts | The two limit defaults, their field metadata and the resolver. Its defaults are imported into `DEFAULT_SETTINGS` rather than duplicated there. Pure. |
| `src/lib/requestLogsFs.js` | logs | Read-only accessor for the dump tree: name parsing, stage reading, outcome resolution, retention. **The only fork-added code that deletes files.** Rewrites nothing it reads. |
| `src/sse/services/accountAttemptLoop.js` | attempts | The single account walk. Owns credential selection, the three exhaustion exits, both ceilings, the abort check, the malformed-request stop, failure marking and the session unbind. Exactly three named hooks; a fourth is how the loop redistributes. **Because nine handlers' identical lines were hoisted in here, an upstream one-line fix to any of them lands in a file upstream has no version of — so no conflict is raised and nothing fails.** `allLockedStatus` exists for exactly that: `v0.5.65` pinned chat's all-locked answer to 503 and left the other seven deriving it, so the status is a per-call-site override rather than one shared expression. Both optional-argument shapers (`markAttemptFailure`, and selection's fourth argument) append only when they carry something, so a call with nothing extra keeps upstream's shape and upstream's tests keep passing. |
| `src/sse/services/sessionAffinity.js` | smartrouting, smartlogs | The in-memory conversation→account map and its idle window, the fingerprint, and a display-only snapshot that refreshes nothing. Every export synchronous by design. |
| `src/sse/services/tokenRefreshStatus.js` | tokenstat | Both halves of the token-status policy — the written shape and the read-side resolution — in one file so they cannot drift. No db import. Nothing branches on a provider id. |
| `src/shared/utils/connectionTest.js` | conntest | Client wrapper around the existing test route, plus the timeout that route has no server-side equivalent for. |
| `src/shared/utils/usageTokens.js` | logs | The three token helpers shared by both views that render request-detail rows. Exists to delete duplication, not to add behaviour. |
| `src/shared/hooks/useCountdown.js` | smartlogs | Tick, format, stop at zero. **Counts from an absolute instant, never a duration** — a duration is stale the moment it is serialised, so a page left open freezes. |
| `src/app/api/locks/reset/route.js` | locks | Clears every model lock on one connection plus the error state. The only fork route that mutates a connection. |
| `src/app/api/token-status/route.js` | tokenstat | One entry per connection. Names every field it emits instead of spreading the record — that is what keeps tokens out. The only fork route with no loopback restriction, for the reason in its header. |
| `src/app/api/logs/records/route.js` | logs | The list endpoint, and the only one the list view calls — so retention is driven from here. Metadata only. |
| `src/app/api/logs/session/[name]/route.js` | logs | One session's stages, read lazily per opened row. |
| `src/app/api/logs/sessions/route.js` | smartlogs | Live conversation→account bindings, through the snapshot read. Echoes the idle window so the page need not restate it. |
| `src/app/api/logs/smart-routing/route.js` | smartlogs | Provider tiles: every provider whose effective strategy is Smart Routing, resolved through the shared precedence helper. |
| `src/app/api/logs/smart-routing/[providerId]/route.js` | smartlogs | The order, and its reason, for one provider. **Calls the real comparator directly.** Returns two groups: ranked pool, and excluded (a locked account is removed, not ranked last). |
| `src/app/(dashboard)/dashboard/profile/components/LockDurationsCard.js` | locks | The six duration fields. Rendered from the keys list, so a new duration needs no edit here. Placeholder is the value an empty field actually produces, not upstream's number. |
| `src/app/(dashboard)/dashboard/profile/components/AttemptLimitsCard.js` | attempts | The two limit fields. Value fields only. |
| `src/app/(dashboard)/dashboard/providers/[id]/TokenStatus.js` | tokenstat | The status line inside a connection row. Display only — no state, no interval. |
| `src/app/(dashboard)/dashboard/smart-logs/page.js` | smartlogs | Server shell over the three client sections. Forced dynamic so the standalone build emits the server file. |
| `.../smart-logs/components/ActiveSessionsSection.js` | smartlogs | One card per live binding. Carries the copy for the two states that would otherwise read as breakage: empty after a restart, and the localhost-only failure. |
| `.../smart-logs/components/RequestLogSection.js` | logs, smartlogs | Filters, table, and a side panel with the summary and the raw dump. **Was `usage/components/LogsTab.js`** — relocated, not rewritten. |
| `.../smart-logs/components/SmartRoutingSection.js` | smartlogs | The provider tiles. Holds no opinion about precedence; the route filters. Its empty state names the two settings that produce it. |
| `.../smart-logs/[providerId]/page.js` | smartlogs | Server shell for the detail route. Its own route rather than page state so it can be linked, refreshed and opened in a second tab. |
| `.../smart-logs/[providerId]/SmartRoutingDetail.js` | smartlogs | The detail screen. Renders, never computes. Shows the demotion as an absolute timestamp — reading the clock in render is a lint error, and a relative age would freeze on an open page. |
| `scripts/fork-check.mjs` | — | Runs every mechanical assertion and prints pass/fail per item. Node, so one copy works on Windows and POSIX. Asserts nothing about lint, build or behaviour. Carries no tag: it belongs to no feature. |
| `FORK-CHANGES.md`, `Specs.md` | — | This file, and the feature requirements. |

---

## Upstream files the fork no longer carries code in

Nothing to carry forward either way. Listed because earlier fork revisions did touch them, so
a merge that finds them in the history should not go looking for fork code.

| File | Kind | Note |
|---|---|---|
| `src/app/(dashboard)/dashboard/usage/page.js` | `− reverted` | Once registered the request-log view as a fourth tab. The view moved to its own page; this file is byte-identical to upstream again — take it verbatim. |
| `src/app/(dashboard)/dashboard/usage/components/LogsTab.js` | `− removed` | **Never an upstream file.** The fork added it here, then deleted it; the view is now `smart-logs/components/RequestLogSection.js`. There is no upstream version to restore. |

---

## Depended on, never edited

**No tag points at these** — there is no fork code in them to hang one on. This table is
their only record, and it is the reason step 1 of a merge is reading upstream's file list
rather than the fork's.

| Upstream file | What the fork takes from it | If it changes |
|---|---|---|
| `open-sse/config/errorConfig.js` | The lock resolver imports four duration constants and uses their **values as the keys** of its remapping. | **The most consequential file for `locks`.**<br>• Retuning a number is handled automatically; removing or renaming an export is a build failure.<br>• The quiet case: a new rule with a new distinct duration keeps upstream's value and no configured field reaches it.<br>• `COOLDOWN_MS` is the weak link — upstream marks it backward-compat, nothing in `open-sse` reads it, and the fork is its only real consumer. |
| `open-sse/services/accountFallback.js` | Four things:<br>• the quota-cooldown formula the resolver mirrors;<br>• the classifier whose returned backoff-level field is the **only** thing distinguishing a ladder duration from a fixed one;<br>• the lock-clearing helper the reset route uses;<br>• the model-lock check that keeps locked accounts out of the selection pool. | If locked accounts stopped being filtered, a demoted-and-locked account would be retried on every request instead of once per lock cycle — the two-layer design rests entirely on that filter. |
| `src/app/api/providers/[id]/test/route.js` and `test/testUtils.js` | The row button reads the result and error from this route's JSON. The fork adds no test logic, so every provider quirk shows through. | • Six providers only check a stored expiry or a token's existence, so a green result reaches no machine.<br>• **The route's own fetch timeout: the fork's client deadline must stay above it.**<br>• Upstream raising that number past the fork's makes the fork's deadline fire first, replacing real provider errors with a generic "no response" — on exactly the failures the button exists to diagnose. No count can see a number. |
| `src/sse/services/backgroundTokenRefresh.js` | The token-status module mirrors it twice: its four eligibility conditions, and its lead-time formula. Both operands imported. | **The most consequential file for `tokenstat`.**<br>• Read the connection loader as well as the selector — the active filter lives there, and the fork's first version of the mirror missed it for that reason.<br>• A fifth condition anywhere in the path is the quiet failure: the sweep skips connections the fork still shows a due time for. |
| `open-sse/services/oauthCredentialManager.js` | The expiry reader, the last-refresh reader, and the credential merge whose three possible returns the attempt record is written against. | • A fourth return shape lands in the record as a reasonless failure.<br>• **The stamping order:** the merge takes its timestamp before the attempt record takes its own, which is what lets a fresh attempt win on read.<br>• Reverse that order and every successful attempt is discarded on read — the row loses its outcome while still showing a plausible time. |
| `open-sse/services/tokenRefresh.js`, `open-sse/config/appConstants.js` | The per-provider refresh lead, and the sole source of the "re-authenticate" distinction. | Upstream adding a permanent error code upgrades the fork's message for free; removing an export is a build failure. The lead table is registry-derived, which is also why that module can never be imported client-side. |
| `src/lib/db/repos/connectionsRepo.js` | The connection update merges the whole object with no whitelist — the only reason the token-attempt field round-trips without being declared anywhere. | Extending the create-path whitelist to the update path drops the field silently, and the status line reverts to reporting the raw last-refresh time with no outcome. A plausible display, not an error. |
| `src/app/api/providers/route.js` | Publishes the connection record — including the fork's added fields — and blanks the refresh token. | Two consequences:<br>• **Every field the fork adds to a record is public**, which is why the record-field reductions are load-bearing.<br>• Blanking the refresh token is why eligibility cannot be decided in the browser, and why the status route exists at all. |
| `src/app/api/usage/request-details/route.js` | Deliberately untouched — upstream's redaction stays as written. | Also the reason record fields count as public: it forwards everything except the four payloads and is not loopback-only. |
| `src/app/api/settings/route.js` | `PATCH` deletes protected keys and lets everything else through. | Turning that into an allowlist silently drops all nine fork settings keys; the Settings cards would keep reporting a successful save while every value reverted. |
| `src/proxy.js` | Where the guard is actually called. | The loopback list protects nothing if a request never reaches the guard. Narrow the routing here and every static check still passes while both fork route prefixes answer the world. |
| `open-sse/utils/stream.js` | Two separate dependencies:<br>• it owns all three terminal-marker append sites;<br>• it decides when stream completion fires — the basis for treating a non-placeholder body as proof a stream finished. | • The translate path uses none of the append sites, which is why the terminal-marker list cannot be narrowed to one string.<br>• Losing the finish field from the final chunk breaks the other signal.<br>• `v0.5.59` already moved completion from flush-only to a deduplicated finalise call. |
| `open-sse/translator/formats.js` | Format ids become part of dump directory names. | An id containing `_` splits every directory name wrongly. Read the **values**, not the keys — the keys do use underscores and never reach a name. |
| `open-sse/transformer/responsesTransformer.js` | Has a logger factory with no callers. | Wiring it up puts directories in the dump tree that retention will not touch. |
| `open-sse/handlers/chatCore.js` 401 block, `open-sse/executors/base.js` | The refresh path `tokenstat` deliberately does not observe — it calls the executor directly, so the result never passes the credential merge and a failure is a log line and nothing else. | If upstream ever routes it through the shared refresh entry point, the gap closes for free. Check whether it did. |
| `src/sse/services/antigravityQuota.js` | Two things `chat.js` reaches into: `handleAntigravityQuotaError`, whose return is fed straight to the lock as `resetsAtMs`, and `clearAntigravityStrikes`, which the fork must call itself. Its strike breaker also writes 0% entries into the quota cache that `auth.js` pre-filters on. | • **The return value is no longer only "the provider reported a reset"** — since `v0.5.65` it can also be a synthesized 15-minute circuit-break deadline. Both are legal lock instants, so nothing breaks, but the antigravity carve-out skips the cap and this now rides it too.<br>• The cache write is why a strike-blocked pair is *removed* from the pool rather than ranked last: the pre-filter runs before the strategy branches. Moving the pre-filter below them would let Smart Routing rank a pair upstream has circuit-broken.<br>• 409s count as strikes, so these blocks reach the `smartrouting` error score as well. |
| `tests/unit/github-monthly-usage-lock.test.js` | One of two upstream tests whose mocks constrain fork code, and **the only one expected to fail.** It mocks the db module with two exports, and the test runner throws on reading an undeclared export — so the settings read the `locks` feature added must survive a **synchronous** throw. | Its two cases take different branches.<br>• One never consults settings and passes.<br>• The other reaches the resolver and **fails by design**: it pins upstream's two minutes by reading it through this feature's own fallback. Expect that failure.<br>• Only the test comparison catches a real regression here. |
| `tests/unit/fetch-success-clears-account.test.js` | The second such test, and it **passes** — keep it that way. It asserts the web-fetch lock key *and the exact argument list* of all three `auth.js` calls, so it is the one upstream test that pins the fork's optional-argument shaping rather than just its behaviour. | • A trailing argument added unconditionally to selection or marking fails it on arity alone, with the behaviour still correct — which reads as a broken test rather than a broken call.<br>• It is also the only automated check that the `webfetch:` key survives; nothing else reads it back. |
| `src/lib/db/index.js`, `src/lib/localDb.js` | How fork code reaches the database. All fork-added routes use the former; `auth.js` is the only fork-touched file on the latter, through upstream's own import line. | Renaming an export either side is a build failure — the good direction. |
| `src/lib/db/backup.js` | Excludes request details from backups. | Explains a known limitation, nothing more. |
| `.gitignore` | One line keeps the raw dump tree out of version control. **Neither that line nor the docs line was added by the fork.** | Lose it and every dump — full prompts, replies, headers — shows up in `git status`, one `git add .` from being published. |
| `.env.example` | Ships the dump switch off. | Copying it over `.env` turns the whole feature off in the quietest way available: no dumps, and no records either, because the variable overrides the recording default rather than only gating the dump. |
| `src/shared/components/Select.js` | Unconditionally renders an empty-value placeholder before the supplied options. | **No fork option may use the empty string as a value** — it would be shadowed and the control would read "Select an option" whenever no override is set. This is why the inherit sentinel is a word. |
| `src/shared/components/Input` and the barrel | The lock card passes `inputClassName`, plus number/min/placeholder props. | Dropping `Input` from the barrel is a build failure. `inputClassName` is the fragile one — it exists only to reach the inner element, and removing it loses the six fields' centring with no error. |
| `src/shared/components/{Badge,Button,Card,Drawer,Pagination}` | The request log section is built from them, imported by **direct path** rather than the barrel (two of them are not in the barrel at all). | A changed prop contract breaks that one screen. |
| `src/shared/components/Tooltip` | Wraps the Unlock button. | A changed text prop drops the button's only explanation of what it does. |
| `src/shared/utils/index.js`, `src/shared/utils/cn`, `src/shared/constants/providers` | Relative-time formatting for past stamps; class merging; provider labels. | The forward-looking half of the token status line is formatted locally because no shared helper does it. |
| `/api/usage/providers`, `/api/provider-nodes`, `/api/providers` | The request log section fetches all three for provider and account labels. | A changed response shape empties those columns with no error anywhere. |
| Lock durations, wherever they end up configured | **A dependency on a value, not a file.** Several `smartrouting` justifications assume a lock lasts long enough that a quota window has plausibly rolled over by the time it expires. | • Configured down to seconds, the error counter stops measuring "still broken after a recovery period" and starts measuring "failed a few times quickly".<br>• The mechanism still runs; it stops meaning what it was designed to mean.<br>• No check can see this — the values stay legal. |

---

## Settings the fork added

All nine reach the database through upstream's `PATCH` route, which passes through anything
not explicitly protected. All are optional; an unset key falls back to the resolver's
default. Values and user-facing meaning are in `Specs.md` 1.1 and 4.1.

| Key | Feature | Default | Surface |
|---|---|---|---|
| `lockBackoffBaseMs` | locks | 90 s | Lock durations card |
| `lockBackoffMaxMs` | locks | 90 min | Lock durations card |
| `lockAuthCooldownMs` | locks | 5 min | Lock durations card |
| `lockShortCooldownMs` | locks | 30 s | Lock durations card |
| `lockTransientCooldownMs` | locks | *upstream's, deliberately no fork default* | Lock durations card |
| `lockProviderResetCapMs` | locks | 90 min | Lock durations card |
| `maxAccountAttempts` | attempts | 30 | Attempt limits card |
| `accountAttemptWindowMs` | attempts | 60 s | Attempt limits card |
| `requestLogsMaxSessions` | logs | 1000 | No control — edit the default |

One upstream default is retuned rather than added: `enableObservability`, `false` → `true`.

---

## Verifying a merge

| Step | Command | Covers |
|---|---|---|
| Mechanical assertions | `node scripts/fork-check.mjs` | Every thread, count and ordering that a grep can see. Reports per item; a `FAIL` names the item, this file says what to do. |
| Build | `npx next build --webpack` | The build-failure class of bad resolution — which is most of them, by design. |
| Lint | `npx eslint <changed files>` | • React-hooks purity and set-state rules, which two fork components depend on.<br>• No `lint` script in `package.json`, hence the direct call.<br>• **Scope it to the files you touched:** a repo-wide run reports several hundred pre-existing problems in upstream code, so a total is not a signal. |
| Tests | `npm install --prefix tests`, then `npm test --prefix tests` | • **The suite is its own npm project under `tests/`** — that `package.json` declares the `test` script and pins `vitest`, its config sits beside it, and `tests/README.md` documents the setup. The ROOT `package.json` declares none of it, which is what makes it easy to conclude nothing does.<br>• One upstream test **fails by design** (see the `github-monthly-usage-lock` row above). The suite also carries failures that predate the fork, listed in `tests/__baseline__/known-fails.txt` — compare against that, never against zero. The gate beside it splits paths on `/app/`, so confirm it works outside a container before trusting its verdict.<br>• **A full run writes snapshots**, leaving tracked files under `tests/translator/__snapshots__/` modified and sometimes adding one. Restore them afterwards or the merge commit carries snapshot churn nothing asked for. |
| Behaviour | by hand | Nothing above proves a feature still works end to end. The load-bearing ones: a lock actually released by the Unlock button, a dump directory found for a log row, a status line showing a real refresh outcome, and a conversation staying on one account across two turns. |

**`scripts/fork-check.mjs` owns every expected number; this document quotes none.** That is
deliberate — two copies of a count cannot be kept in agreement, and nothing detects the
disagreement. When upstream legitimately moves a number, the script is the only place to
update. Same reason there is no line-delta column in the tables above: it would rot on every
edit and tell a merge nothing it can act on.

Note that a few checks count identifiers in comments as well as code, so editing prose near
one of them can move a count. Item 1 shows the alternative — it strips comments first.

---

## Code comment convention

The third place fork knowledge lives is `FORK(<feature>)` comments next to the code they
constrain. They are footnotes, not documentation, and they carry only three things:

- why this differs from upstream, in one or two sentences;
- a constraint or assumption that must hold (marked in bold, so it survives skimming);
- what a merge can break here, especially where the breakage is silent.

Not in them: design alternatives that were considered, general explanations of what the code
does, restatements of `Specs.md`, or references to section numbers in either document — a
number in a comment is a cross-reference that rots. A reader should be able to tell from the
comment alone why the line is not upstream's.

**Files the fork added are the exception to the length rule.** They have no upstream line to
differ from, so their header states what the module owns and the constraints that hold across it
— that runs longer than a footnote by design, and shortening one loses a constraint rather than
prose. The exclusions above still apply.

---

## Merge log

| Upstream | Merged | Conflicts | Resolution |
|---|---|---|---|
| `v0.5.65` (`4eda76e2`) | 2026-09-04 | `src/sse/handlers/chat.js` (3 hunks), `src/sse/handlers/fetch.js` (2 hunks) — both the `~ replaced` walk against upstream's `while (true)` | Kept the fork's loop in both; took upstream's `webfetch:<providerId>` lock key, which **retired the `lockKey: null` justification** rather than surviving it. **The two changes git could not show were the ones that mattered:** upstream's all-locked 503 and `clearAntigravityStrikes` both sit inside the walk this fork replaced, so they were carried by hand — the 503 as a per-call-site `allLockedStatus` because upstream retuned chat only. Selection's fourth argument became conditional so an upstream test that pins the argument list keeps passing. Four files auto-merged into fork code (`requestDetail.js`, `dashboardGuard.js`, `ConnectionsCard.js`, `providers/[id]/page.js`) and all four were verified by hand rather than trusted. |
| `v0.5.59` (`5920eec4`) | 2026-08-29 | `src/sse/services/auth.js`, in the provider-reported-reset branch of `markAccountUnavailable` | Kept upstream's antigravity carve-out with the fork's resolver as the cap on the other side; commented in place. The review that followed found four defects, **none of them caught by a mechanical check** — each blind spot is now noted where the code lives rather than retold here. |
| `v0.5.55` (`699edac3`) | — | — | Fork point. No merges before this. |
