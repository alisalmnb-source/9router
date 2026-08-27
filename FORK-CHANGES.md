# Fork changes

What this fork adds on top of upstream, and what to check when merging upstream
into it.

- Upstream: [`decolua/9router`](https://github.com/decolua/9router) (remote `upstream`,
  default branch `master` — there is no `main`)
- Fork point: `699edac3`, tag `v0.5.55`
- Last merged from upstream: nothing yet, still sitting on the fork point

**Merging right now?** In order:

1. Before merging, read `git diff HEAD..upstream/master --stat` against
   [What upstream can break](#what-upstream-can-break). That turns upstream's file list
   into a shortlist of what to watch, and it is the only step that catches trouble in
   files the fork never edits.
2. Merge, resolve conflicts.
3. Work the [checklist](#upstream-merge-checklist) top to bottom, then
   [Verifying](#verifying) and the [post-merge check](#post-merge-check).

The feature sections explain why an item exists; read one when its check fails.

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
- **Record what the fork depends on but does not edit.** Those files carry no tag, by
  definition, so "What upstream can break" is their only record. A dependency added
  without an entry there is invisible at merge time.
- **Append to the merge log at the top.** After a merge, the fork point alone stops
  being the useful fact.

Kept at the repo root rather than under `docs/`: `.gitignore` line 52 ignores
`docs/*`, so a copy there would be silently left out of every commit. The neighbouring
line 49, `logs/*`, is what keeps raw dumps out of version control — see the entry for
`.gitignore` in [What upstream can break](#what-upstream-can-break).

## Fork inventory

Every file the fork touches, across all features. Ten modified, five added,
**+95 −26** in the modified ones.

```
git grep -l --untracked "FORK(logs)" -- open-sse src
```

That returns all fourteen code files listed below, everything except this document.
The tag is exhaustive for **edits**: an untagged file is one the fork does not modify.

It says nothing about risk. The fork also leans on upstream files it never edits, and
those carry no tag precisely because there is no fork code in them to hang it on. Read
the next section before concluding that an untagged file in upstream's diff is
harmless.

### Added

| File | Feature | Purpose |
| --- | --- | --- |
| `FORK-CHANGES.md` | — | This file. |
| `src/lib/requestLogsFs.js` | logs | Read-only accessor for the `logs/` tree: name parsing, stage reading, outcome resolution, retention. Rewrites nothing it reads. **The only code in the fork that deletes files.** |
| `src/app/api/logs/records/route.js` | logs | List endpoint, and the only one the list view calls — so retention is triggered from here. Metadata only. |
| `src/app/api/logs/session/[name]/route.js` | logs | Reads one session's stages, lazily, per opened row. |
| `src/app/(dashboard)/dashboard/usage/components/LogsTab.js` | logs | The tab: filters, table, and a side panel with the summary and the raw dump. |

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
| `src/dashboardGuard.js` | logs | +7 | `/api/logs` added to `LOCAL_ONLY_PATHS`. |
| `src/app/(dashboard)/dashboard/usage/page.js` | logs | +7 −1 | Registers the tab under the key `inspector`. |

## Rules that outlive a feature

Constraints that apply to anything this fork adds next, not just to the logs tab. Read
these before designing a feature, not while merging one.

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
| `src/dashboardGuard.js` | Checklist 3 |
| `src/app/(dashboard)/dashboard/usage/page.js` | Tab registration — the `inspector` key must not collide with upstream's `logs` |

### Files the fork depends on but never edits

**No tag points at these.** This table is their only record.

| Upstream file | Threatens |
| --- | --- |
| `open-sse/translator/formats.js` | Checklist 4 — a format id containing `_` splits every directory name wrongly. Thirteen ids today, all hyphenated. |
| `open-sse/utils/stream.js` | "How outcome is decided", step 3 — it decides whether a stream ends with `[DONE]`, which is why the terminal-marker list cannot be narrowed to that one string |
| `open-sse/transformer/responsesTransformer.js` | Checklist 9 — `createResponsesLogger` has no callers today; wiring it up puts directories in `logs/` that retention will not touch |
| `src/sse/handlers/chat.js` | Known limitations — its account loop is why rows are per attempt, and why some failures produce no row at all |
| `src/app/api/settings/route.js` | Checklist 8 — `PATCH` deletes `PROTECTED_SETTING_KEYS` and lets everything else through. Turning that into an allowlist silently drops `requestLogsMaxSessions`. |
| `src/app/api/usage/request-details/route.js` | Deliberately untouched — upstream's redaction has to stay as written. Also the reason record fields are treated as public: it forwards everything except the four payloads, and it is not local-only. |
| `src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js` | `LogsTab` carries byte-identical copies of `getInputTokens`, `getCachedTokens` and `getCacheCreationTokens` from it, on purpose: the two tabs render the same rows, so a different rule in one would show two input-token counts for one request. Change either copy and change both. Nothing in the checklist can detect the drift — the numbers stay plausible, they just disagree. |
| `src/lib/db/backup.js` | Known limitations — `requestDetails` is excluded from backups |
| `.gitignore` | Line 49 `logs/*` is the only thing keeping raw dumps out of version control, and line 52 `docs/*` is why this file sits at the repo root. Lose the first and every dump — full prompts, replies, headers — shows up in `git status`, one `git add .` from being published. Neither line was added by the fork. |
| `src/proxy.js` | Where the guard gets called. `LOCAL_ONLY_PATHS` protects nothing if a request never reaches `dashboardGuard.proxy()` — narrow the routing here and every static check in this file still passes while `/api/logs` answers the world. Only post-merge step 5 catches it. |
| `.env.example` | Ships `ENABLE_REQUEST_LOGS=false`. Copying it over `.env` turns the whole feature off in the quietest way available: no dumps written, and no `requestDetails` rows either, because the variable overrides the `enableObservability` default rather than just gating the dump. The tab goes empty with nothing logged anywhere. See Environment below. |
| `/api/usage/providers`, `/api/provider-nodes`, `/api/providers` | `LogsTab` fetches all three for the provider and account labels. A changed response shape empties those columns with no error anywhere. |
| `src/shared/components/{Badge,Button,Card,Drawer,Pagination}` | `LogsTab` is built from them and depends on their prop contracts |
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
| Payloads | `logs/` directories | Up to eight files across seven numbered stages: the unfiltered client body, the upstream URL and headers, raw SSE frames, stack traces. |

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
`request` yields `undefined` and the badge silently disappears. The copy is taken
before truncation runs. It depends on `truncateField` returning a new value rather
than mutating its argument — if that ever changes, the copy breaks silently.

### Header masking

`maskSensitiveHeaders` in `open-sse/utils/requestLogger.js` is enabled. Upstream had
disabled it deliberately (`"DISABLED - keep full token for testing"`), writing live
OAuth tokens and API keys to disk in plaintext. Values are now dropped entirely
rather than trimmed, and the helper is applied at **all four** write sites.

`logProviderResponse` is worth knowing about specifically: it is the write site that
never went through the masking helper, even before upstream disabled it. Stage 5 holds
the provider's *response* headers, which can carry `set-cookie`. It is masked now.

**The write side is the only side that masks.** `requestLogsFs.js` renders each stage
exactly as stored and does not re-mask on read, so what the panel shows is what is on
disk. An earlier read-time pass existed to make dumps written while masking was off
safe to view; it was removed once no such dumps remained, because a reader that
rewrote files would make this view disagree with them and because a second layer
invites relying on it instead of on the write side.

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

**The settings page is byte-identical to upstream — there is no UI for any of this.**
These values are set once in practice, and a dashboard control for them would have
been the largest single diff in the fork. Change them in `DEFAULT_SETTINGS`, or for a
running install:

```
PATCH /api/settings {"requestLogsMaxSessions":5000}
```

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
   `7_res_client.json` exists, or `7_res_client.txt` ends with a terminal marker.
4. **The stored `status`**, and only `"success"` counts. This is the branch that answers
   when there is no dump to read at all — a row whose directory was pruned, or any row
   written while `ENABLE_REQUEST_LOGS` was off. Anything else resolves to `unknown`.

   Both remaining branches report `source: "record"`, so the badge tooltip cannot tell
   them apart from step 2. That is deliberate: this is the weakest signal in the chain,
   because `streamingHandler.js` writes `status: "success"` at stream open, so a stream
   that died mid-flight and lost its dump reads as `ok` here. Steps 1 to 3 exist to keep
   that case from reaching this branch; it only fires once the dump is gone.

For step 3, a terminal marker is `[DONE]`, `response.completed`, `message_stop`, or a
non-null `finish_reason` / `finishReason` (`FINISH_REASON_RE`). Do not narrow that to
`[DONE]` alone: `open-sse/utils/stream.js` appends it only when
`!streamDoneSent && !isGeminiFamily`, so a complete OpenAI chat-completions stream can
end without one, its last chunk carrying `"finish_reason":"stop"` and a usage block
instead. The probe reads `TAIL_PROBE_BYTES` from the end of the file — 8 KB today, sized
so a large final chunk still fits whole.

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
- **Stage count varies per row**, from four to eight files, because a file exists only
  if that step ran: `3_req_openai.json` when the request goes through the OpenAI pivot
  (`translator/index.js`), `5_res_provider.json` and `7_res_client.json` for
  non-streaming against `5_res_provider.txt` and `7_res_client.txt` for streaming,
  `6_res_openai.txt` for translated streams, `6_error.json` on failure. The panel lists
  what is on disk rather than padding out absent stages.

  Eight is the ceiling, not seven, and it is easy to mis-set an expectation here:
  `appendOpenAIChunk` and `logError` are independent write sites, so a **translated
  stream that fails** leaves both `6_res_openai.txt` and `6_error.json` behind. With
  the four request copies, one stage-5 variant and one stage-7 variant that is eight
  files under seven numbered stages. `STAGE_FILES` in `requestLogsFs.js` lists all ten
  possible names; no row gets all ten, because the `.json` and `.txt` variants of
  stages 5 and 7 are mutually exclusive.
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

## Upstream merge checklist

Runs once for the whole fork. Feature tags are there so an entry can be dropped along
with its feature, not so the list can be split up.

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

8. **[logs] New settings keys** survived, if `DEFAULT_SETTINGS` was reorganised. Also
   check that `PATCH` in `src/app/api/settings/route.js` is still a blocklist — it
   deletes `PROTECTED_SETTING_KEYS` and passes the rest through, which is the only
   reason `requestLogsMaxSessions` needs no route change. An allowlist there drops it
   without an error.

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

11. **All features:** both tables still match reality — the inventory for edited files,
    and "What upstream can break" for the ones the fork only depends on. The grep
    covers the first; the second needs reading, so check it whenever a new import or
    `fetch` is added to fork code.

    ```
    git grep -l --untracked "FORK(logs)" -- open-sse src
    ```

12. **Update the expected counts in items 1 to 10 if upstream legitimately changed
    them.** Those numbers are assertions about upstream's code, so they go stale by
    design — a mismatch is an invitation to look, not proof of breakage. Once you have
    confirmed the new shape is correct, write the new count into this file. Nobody else
    owns them: item 11 covers the two tables and item 13 covers the tests, so a stale
    count here silently degrades into a check that always fails and gets skipped.

13. Re-run lint, build, the test comparison and the post-merge check below.

## Verifying

```
npx eslint .
npm run build          # /api/logs/records and /api/logs/session/[name] in the route list
```

A plain checkout reports around 135 eslint errors, all inherited from upstream
(`react-hooks/set-state-in-effect` in `src/shared/hooks/useModelCaps.js` and friends).
Lint the fork's own files to get a clean signal.

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
still works end to end. Five checks do, against a running instance — substitute your
port, and note that `/api/logs` only answers on loopback, which is what step 5 tests.

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

**Judge the stripping by those four keys, never by the page size.** An earlier version
of this step said "a megabyte means the stripping was lost", which was both wrong and
the wrong kind of check: with the default `pageSize` of 20 and the 5 KB cap the ceiling
is a few hundred kilobytes, so the threshold could never fire. The key test is exact,
costs nothing, and stays true after anyone retunes `pageSize` or
`observabilityMaxJsonSize`.

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
array of four to eight entries. No `outcome` key — that belongs to the list endpoint
alone. Confirm a `headers` object shows `<redacted>` rather than a live token: since
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
curl -s -o /dev/null -w '%{http_code}\n' http://<lan-ip>:20127/api/usage/request-details
```

Expect **403 then 200**. Both numbers matter. 403 alone could mean the whole dashboard
is unreachable from there, which proves nothing about `LOCAL_ONLY_PATHS`; the 200 on the
second URL is what shows the guard is discriminating by path rather than blocking
everything. Two 200s means unredacted conversation content is reachable from the LAN.

Checklist 3 only greps for the array entry. That proves `/api/logs` is *listed*, not
that `proxy()` still consults `LOCAL_ONLY_PATHS` before the deny-by-default branch — if
a merge reorders those blocks the grep still passes. This step is the one that catches
it, and it is the reason not to treat checklist 3 as sufficient on its own.

Then open the tab itself at `/dashboard/usage?tab=inspector`, since the steps above say
nothing about the components `LogsTab` borrows from `src/shared/components`. Empty
provider or account columns with rows otherwise present is the signature of a changed
response shape on `/api/usage/providers`, `/api/provider-nodes` or `/api/providers`.
