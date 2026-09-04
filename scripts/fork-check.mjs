#!/usr/bin/env node
// Fork tooling: asserts that every fork mechanism upstream could quietly break is still intact,
// one line per item. Run it after resolving an upstream merge.
//
// Carries no FORK(<feature>) tag: it belongs to no feature, and it sits outside the tag grep's
// `open-sse src` scope anyway. FORK-CHANGES.md's Added table is its record.
//
// **This script owns the expected numbers — FORK-CHANGES.md deliberately quotes none.** When
// upstream legitimately moves a count, this file is the only place to update.
//
// Six items assert an ORDERING or an ABSENCE rather than a count and cannot be satisfied by
// editing a number: 25, 29, 30, 31, 32 and 34. A failure there means something behavioural moved.
// Read item 32 first if it ever fails — it is the only assertion whose breakage is both silent and
// behavioural: nothing errors, no count moves, the page keeps rendering, and the session idle
// window simply stops expiring.
//
// **Some checks count identifiers in comments as well as code** (items 20, 24 and 33 among them),
// so editing prose near those identifiers can move a count. Item 1 shows the alternative: it runs
// its source through stripComments first.
//
// Not covered here, because none of it is a grep: lint, build, the test comparison, and any
// behavioural check against a running instance. A clean run is necessary, not sufficient.
//
// Usage:
//   node scripts/fork-check.mjs            one line per item
//   node scripts/fork-check.mjs --verbose  plus the matched lines for anything failing
//
// Exit code: 0 when every automated item passes, 1 otherwise.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERBOSE = process.argv.includes("--verbose");

const PASS = "PASS";
const FAIL = "FAIL";
const MANUAL = "MANUAL";

/**
 * Run `git grep` and return the matching lines.
 *
 * git grep exits 1 when there is no match, which is a legitimate result here rather
 * than an error — several checks expect a specific non-zero count and "zero" is just
 * a failing count. Any other non-zero exit is a real problem and is surfaced.
 */
function gitGrep(args) {
  const res = spawnSync("git", ["grep", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (res.error) throw new Error(`git grep failed to start: ${res.error.message}`);
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`git grep exited ${res.status}: ${(res.stderr || "").trim()}`);
  }
  return (res.stdout || "").split(/\r?\n/).filter(Boolean);
}

function readRepoFile(relPath) {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

/**
 * Strip comments so a structural check reads code rather than prose.
 *
 * Required, not defensive: the comment above the Smart Routing branch explains why there is no
 * `await` in it — using the word `await` — and a raw count reported the branch as broken while the
 * code was correct. **Any structural assertion added here has the same exposure.**
 *
 * Not a parser. A `//` inside a string literal is over-removed, which cannot produce a false PASS:
 * every caller asserts on the presence of code, so losing text only makes a check stricter.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/**
 * Evaluate the millisecond expressions in errorConfig.js without eval.
 *
 * They are all plain integer products (`30 * 1000`, `2 * 60 * 1000`). Anything else
 * returns null so the caller can report MANUAL rather than guess — a silently wrong
 * number here would defeat the one check in the list that no grep can compute.
 */
function evalMsProduct(expr) {
  const cleaned = String(expr).trim().replace(/;$/, "").trim();
  if (!/^\d+(\s*\*\s*\d+)*$/.test(cleaned)) return null;
  return cleaned.split("*").reduce((acc, part) => acc * Number(part.trim()), 1);
}

const check = (id, tag, title, fn) => ({ id, tag, title, fn });

// Each item is self-describing: its title says what is asserted and the comment above it says what
// breaks if the assertion stops holding. Grouped by feature tag, in the order the features landed.
const CHECKS = [
  check(1, "logs", "logDir survives the whole thread", () => {
    const scope = ["--", "open-sse/handlers", "src/lib/db/repos/requestDetailsRepo.js"];
    const lines = gitGrep(["-n", "logDir", ...scope]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    // CODE hits only. The prose is excluded because this fork documents its reasoning beside
    // the code it constrains, so `logDir` is named in comments too — including one belonging to
    // another feature, where the sessionTag docblock explains that the field rides along the
    // same way. Counting raw hits made an unrelated comment edit look like a lost field.
    const code = lines.filter((l) => !/^[^:]+:\d+:\s*(\/\/|\*|\/\*)/.test(l));
    // Scope is narrow on purpose: a wider `-- open-sse` also matches an unrelated
    // local variable in transformer/responsesTransformer.js.
    const ok = code.length === 13 && files.size === 6;
    return {
      ok,
      detail: `${code.length} code hits / ${files.size} files (expect 13 / 6); ${lines.length - code.length} comment mentions ignored`,
      lines,
    };
  }),

  check(2, "logs", "maskSensitiveHeaders applied at every write site", () => {
    const lines = gitGrep(["-n", "maskSensitiveHeaders", "--", "open-sse/utils/requestLogger.js"]);
    // 1 definition + 4 call sites. Count the call sites too: five hits with only three
    // calls means a stage lost its masking, which is the leak this item exists for.
    const calls = lines.filter((l) => /maskSensitiveHeaders\(/.test(l) && !/^.*function\s/.test(l));
    const ok = lines.length === 5 && calls.length === 4;
    return {
      ok,
      detail: `${lines.length} hits, ${calls.length} call sites (expect 5 / 4)`,
      lines,
    };
  }),

  check(3, "logs", "/api/logs is in LOCAL_ONLY_PATHS", () => {
    const lines = gitGrep(["-n", "/api/logs", "--", "src/dashboardGuard.js"]);
    const ok = lines.length === 2;
    return { ok, detail: `${lines.length} hits (expect 2: entry + comment)`, lines };
  }),

  check(4, "logs", "format ids still safe for parseSessionName", () => {
    // The naming contract itself needs reading (deny-list vs allow-list, local-time
    // stamp) — that is the MANUAL half below. What IS checkable is the assumption the
    // parser rests on: no format id may contain "_", or every directory name splits
    // wrongly. Read the values, not the keys; the keys use underscores by convention.
    const src = readRepoFile("open-sse/translator/formats.js");
    const block = src.match(/export const FORMATS\s*=\s*\{([\s\S]*?)\}/);
    if (!block) return { ok: false, detail: "could not locate the FORMATS object" };
    const ids = [...block[1].matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]);
    const withUnderscore = ids.filter((id) => id.includes("_"));
    const ok = ids.length === 13 && withUnderscore.length === 0;
    return {
      ok,
      detail: withUnderscore.length
        ? `${withUnderscore.length} id(s) contain "_": ${withUnderscore.join(", ")}`
        : `${ids.length} ids, none containing "_" (expect 13)`,
    };
  }),

  check(5, "logs", "stage filenames agree across writer and reader", () => {
    const names = new Set(
      gitGrep([
        "-oh", "--untracked", "-E", "[0-9]_[a-z_]*\\.(json|txt)",
        "--", "open-sse/utils/requestLogger.js", "src/lib/requestLogsFs.js",
      ])
    );
    // This is the UNION of writer and reader, so a rename on one side alone pushes the
    // count to eleven and both spellings show up side by side.
    const ok = names.size === 10;
    return {
      ok,
      detail: `${names.size} distinct names (expect 10)`,
      lines: [...names].sort(),
    };
  }),

  check(6, "logs", "STREAMING_PLACEHOLDER matches what streamingHandler writes", () => {
    // -F on the exact string, so this asserts equality and not merely presence: if
    // upstream retunes the text, only the reader's copy still matches and the count
    // drops to 1.
    const lines = gitGrep([
      "-nF", "--untracked", "[Streaming in progress...]", "--", "open-sse", "src",
    ]);
    const ok = lines.length === 2;
    return {
      ok,
      detail: `${lines.length} hits of the exact string (expect 2, one per file)`,
      lines,
    };
  }),

  check(7, "logs", "the stream copy still reads the pre-truncation object", () => {
    // truncateField staying non-mutating is the real assertion and needs reading — the
    // MANUAL half. What is checkable is the other end of the dependency: the copy must
    // read item.request, never the clipped result.
    const src = readRepoFile("src/lib/db/repos/requestDetailsRepo.js");
    const ok = /stream:\s*item\.request\?\.stream/.test(src);
    return {
      ok,
      detail: ok
        ? "stream reads item.request?.stream"
        : "the top-level stream copy no longer reads item.request — badge will go null",
    };
  }),

  check(8, "logs, locks", "settings keys reach the store", () => {
    const owners = gitGrep(["-l", "--untracked", "lockBackoffBaseMs", "--", "src"]);
    // The Settings card renders from LOCK_SETTING_KEYS rather than naming any key, so a
    // second file here means a key name was hardcoded and the table stopped being the
    // single source.
    const singleOwner = owners.length === 1 && owners[0] === "src/lib/lockPolicy.js";
    const route = readRepoFile("src/app/api/settings/route.js");
    // A blocklist is the only reason none of these keys needs a route change. An
    // allowlist drops them while still reporting a successful save.
    const isBlocklist = /for\s*\(const key of PROTECTED_SETTING_KEYS\)\s*delete/.test(route);
    const repo = readRepoFile("src/lib/db/repos/settingsRepo.js");
    const declared = /requestLogsMaxSessions:/.test(repo) && /enableObservability:\s*true/.test(repo);
    const ok = singleOwner && isBlocklist && declared;
    return {
      ok,
      detail: [
        singleOwner ? "lockBackoffBaseMs in lockPolicy.js only" : `lockBackoffBaseMs in ${owners.length} files`,
        isBlocklist ? "PATCH is a blocklist" : "PATCH is NO LONGER a blocklist",
        declared ? "both logs keys declared" : "a logs key is missing from DEFAULT_SETTINGS",
      ].join("; "),
      lines: owners,
    };
  }),

  check(9, "logs", "nothing new writes into logs/", () => {
    const lines = gitGrep(["-n", "createResponsesLogger", "--", "open-sse"]);
    // Retention only deletes directories it can parse as a session, so a second writer
    // accumulates unmanaged. A second hit means this one gained a caller.
    const ok = lines.length === 1;
    return { ok, detail: `${lines.length} hits (expect 1: the definition only)`, lines };
  }),

  check(10, "logs", "reader and writer agree on the logs/ root", () => {
    const lines = gitGrep([
      "-n", "--untracked", "cwd()",
      "--", "open-sse/utils/requestLogger.js", "src/lib/requestLogsFs.js",
    ]);
    const ok = lines.length === 3;
    return {
      ok,
      detail: `${lines.length} hits (expect 3: LOGS_DIR, resolveLogsDir, its docblock)`,
      lines,
    };
  }),

  check(11, "locks", "the rules table still holds two distinct fixed durations", () => {
    const mapped = new Set(
      gitGrep(["-oh", "-E", "cooldownMs: COOLDOWN\\.[a-z]*", "--", "open-sse/config/errorConfig.js"])
    );
    // A rule carrying a third distinct value would be a category no configured field
    // reaches — it keeps upstream's duration silently.
    const twoCategories = mapped.size === 2;

    // The part no grep can compute: the three mapped constants must hold three
    // different numbers. If two collide, buildFixedCooldownMap drops the ambiguous
    // entry and both categories fall back to upstream's duration.
    const src = readRepoFile("open-sse/config/errorConfig.js");
    const transient = src.match(/export const TRANSIENT_COOLDOWN_MS\s*=\s*([^;]+);/);
    const long = src.match(/\blong:\s*([^,\n]+)/);
    const short = src.match(/\bshort:\s*([^,\n]+)/);
    if (!transient || !long || !short) {
      return { ok: false, detail: "could not locate all three duration expressions" };
    }
    const values = [long[1], short[1], transient[1]].map(evalMsProduct);
    if (values.some((v) => v === null)) {
      return {
        ok: false,
        detail: "a duration is no longer a plain integer product — read them by hand",
        lines: [long[1], short[1], transient[1]].map((e) => e.trim()),
      };
    }
    const distinct = new Set(values).size === 3;
    return {
      ok: twoCategories && distinct,
      detail: `${mapped.size} mapped categories (expect 2); long=${values[0]} short=${values[1]} transient=${values[2]} ${distinct ? "all distinct" : "COLLIDE"}`,
      lines: [...mapped].sort(),
    };
  }),

  check(12, "locks", "COOLDOWN_MS is still exported", () => {
    // Word boundaries matter: a bare COOLDOWN_MS also matches TRANSIENT_COOLDOWN_MS,
    // MAX_RATE_LIMIT_COOLDOWN_MS and OAUTH_429_COOLDOWN_MS.
    const lines = gitGrep(["-n", "-E", "\\bCOOLDOWN_MS\\b", "--", "open-sse"]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    const ok = lines.length === 4 && files.size === 3;
    return {
      ok,
      detail: `${lines.length} hits / ${files.size} files (expect 4 / 3 — the fork is its only real consumer)`,
      lines,
    };
  }),

  check(13, "locks", "getQuotaCooldown's formula is unchanged", () => {
    const lines = gitGrep(["-n", "getQuotaCooldown", "--", "open-sse/services/accountFallback.js"]);
    // 1 definition + 2 backoff:true call sites. resolveBackoffCooldownMs mirrors the
    // formula including its level - 1 offset, so a change needs mirroring by hand.
    const ok = lines.length === 3;
    return { ok, detail: `${lines.length} hits (expect 3)`, lines };
  }),

  check(14, "locks", "newBackoffLevel is set only on backoff rules", () => {
    const lines = gitGrep(["-n", "newBackoffLevel", "--", "open-sse/services/accountFallback.js"]);
    // 5: the @returns docblock, the two backoff:true returns, and two lines in the dead
    // applyErrorState. If it starts coming back on every rule, every fixed cooldown gets
    // recomputed from the ladder.
    const ok = lines.length === 5;
    return { ok, detail: `${lines.length} hits (expect 5)`, lines };
  }),

  check(15, "locks", "MAX_RATE_LIMIT_COOLDOWN_MS has no reader outside the resolver", () => {
    const lines = gitGrep(["-n", "--untracked", "MAX_RATE_LIMIT_COOLDOWN_MS", "--", "open-sse", "src"]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    // auth.js must carry a comment mention and nothing else — a real reference there is
    // a call site that bypasses the configured cap.
    const authLines = lines.filter((l) => l.startsWith("src/sse/services/auth.js"));
    const authCommentOnly = authLines.length === 1 && /:\s*\/\//.test(authLines[0]);
    const ok = files.size === 3 && authCommentOnly;
    return {
      ok,
      detail: `${files.size} files (expect 3); auth.js ${authCommentOnly ? "comment only" : "HAS A REAL REFERENCE"}`,
      lines,
    };
  }),

  check(16, "locks", "/api/locks is in LOCAL_ONLY_PATHS", () => {
    const lines = gitGrep(["-n", "/api/locks", "--", "src/dashboardGuard.js"]);
    const ok = lines.length === 2;
    return { ok, detail: `${lines.length} hits (expect 2: entry + comment)`, lines };
  }),

  check(17, "locks", "the reset route uses upstream's lock-key helper", () => {
    const lines = gitGrep(["-n", "--untracked", "buildClearModelLocksUpdate", "--", "open-sse", "src"]);
    // Do not widen to MODEL_LOCK_PREFIX: models/availability/route.js declares its own
    // local copy of that string, so the results would mix two definitions.
    const ok = lines.length === 3;
    return {
      ok,
      detail: `${lines.length} hits (expect 3: definition, import, call) — the count cannot tell a prefix scan from a fixed list, read the definition`,
      lines,
    };
  }),

  check(18, "conntest", "the test route still answers { valid, error }", () => {
    const lines = gitGrep(["-n", "valid: result.valid", "--", "src/app/api/providers/[id]/test/route.js"]);
    const ok = lines.length === 1;
    return { ok, detail: `${lines.length} hits (expect 1)`, lines };
  }),

  check(19, "tokenstat", "checkAndRefreshToken is still the one convergence point", () => {
    // -F with the opening paren on purpose. A bare name matches nineteen lines: these 9,
    // six static imports, the dynamic destructure in backgroundTokenRefresh.js, two fork
    // comments and one unrelated comment in src/lib/oauth/providers/grok-cli.js. Ten of
    // those move whenever anyone edits prose or reorders an import. With the paren the
    // count is call sites plus the definition, which is what the item asserts.
    const lines = gitGrep(["-nF", "--untracked", "checkAndRefreshToken(", "--", "src"]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    // The scheduler's call is the expensive one to lose: proactive refresh is where
    // nearly every recorded attempt comes from. Assert it by name, not just by count.
    const scheduler = lines.some(
      (l) => l.startsWith("src/sse/services/backgroundTokenRefresh.js") && /force:\s*true/.test(l)
    );
    const ok = lines.length === 9 && files.size === 8 && scheduler;
    return {
      ok,
      detail: `${lines.length} hits / ${files.size} files (expect 9 / 8); scheduler call ${scheduler ? "present" : "MISSING"}`,
      lines,
    };
  }),

  check(20, "tokenstat", "the due-time formula still agrees with the scheduler", () => {
    const lines = gitGrep(["-n", "--untracked", "BACKGROUND_REFRESH_LEAD_MS", "--", "src"]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    const counted = lines.length === 7 && files.size === 2;

    // The quiet failure no count can see: a FOURTH eligibility condition in
    // selectConnectionsNeedingRefresh makes the sweep skip connections the fork still
    // shows a due time for, so the row promises a refresh that never arrives. Assert the
    // three the fork mirrors are all still there.
    const src = readRepoFile("src/sse/services/backgroundTokenRefresh.js");
    const body = src.match(/export function selectConnectionsNeedingRefresh[\s\S]*?\n}/);
    if (!body) return { ok: false, detail: "could not locate selectConnectionsNeedingRefresh" };
    const guards = {
      authType: /authType !== "oauth"/.test(body[0]),
      refreshToken: /!conn\.refreshToken/.test(body[0]),
      // Two halves, so a renamed local does not read as a removed guard: the expiry has
      // to be resolved through upstream's helper, and a null one has to skip.
      expiry:
        /getCredentialExpiryMs\(conn\)/.test(body[0]) &&
        /=== null\)\s*continue/.test(body[0]),
      // The fourth condition, and the one that is NOT in the selector. It is the filter on
      // the list handed to it, one level up. Reading only the selector misses it, which is
      // how the fork first shipped a due time for connections nothing would ever refresh.
      isActiveSource: /getProviderConnections\(\{\s*isActive:\s*true\s*\}\)/.test(src),
    };
    const missing = Object.entries(guards).filter(([, v]) => !v).map(([k]) => k);
    return {
      ok: counted && missing.length === 0,
      detail: `${lines.length} hits / ${files.size} files (expect 7 / 2); guards ${missing.length ? `MISSING: ${missing.join(", ")}` : "all four present"} — a fifth one is invisible here, read the function and its caller`,
      lines,
    };
  }),

  check(21, "tokenstat", "REFRESH_LEAD_MS is still registry-derived", () => {
    // Word boundaries: without them this also matches BACKGROUND_REFRESH_LEAD_MS, a
    // different constant in a different layer.
    const lines = gitGrep(["-nE", "\\bREFRESH_LEAD_MS\\b", "--", "open-sse"]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    const src = readRepoFile("open-sse/config/appConstants.js");
    // A hand-written table would still work, but a provider added without an
    // oauth.refreshLeadMs would then silently fall back to the background floor.
    const derived = /export const REFRESH_LEAD_MS[\s\S]{0,200}PROVIDER_OAUTH/.test(src);
    const ok = lines.length === 4 && files.size === 2 && derived;
    return {
      ok,
      detail: `${lines.length} hits / ${files.size} files (expect 4 / 2); ${derived ? "derived from PROVIDER_OAUTH" : "NO LONGER derived from PROVIDER_OAUTH"}`,
      lines,
    };
  }),

  check(22, "tokenstat", "isUnrecoverableRefreshError still classifies the same codes", () => {
    // Scoped to open-sse: widening to src adds fork comment mentions that move with any
    // edit. The fork resolves `permanent` through this function at read time, so a code
    // dropped here turns a permanent failure into a generic one and the row stops
    // telling you to log in again.
    const lines = gitGrep(["-n", "isUnrecoverableRefreshError", "--", "open-sse"]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    const src = readRepoFile("open-sse/services/tokenRefresh.js");
    const body = src.match(/export function isUnrecoverableRefreshError[\s\S]*?\n}/);
    const codes = [
      "unrecoverable_refresh_error",
      "refresh_token_reused",
      "invalid_request",
      "invalid_grant",
    ];
    const absent = body ? codes.filter((c) => !body[0].includes(c)) : codes;
    const ok = lines.length === 3 && files.size === 2 && absent.length === 0;
    return {
      ok,
      detail: `${lines.length} hits / ${files.size} files (expect 3 / 2); ${absent.length ? `codes MISSING: ${absent.join(", ")}` : "all four codes listed"}`,
      lines,
    };
  }),

  check(23, "tokenstat", "the connection update still merges the whole object", () => {
    // OPTIONAL_FIELDS is a whitelist in createProviderConnection only. A third use means
    // it became one on the update path too, which drops tokenRefreshAttempt with no
    // error — the row then falls back to upstream's lastRefreshAt with no outcome, which
    // looks like a working display.
    const lines = gitGrep(["-n", "OPTIONAL_FIELDS", "--", "src/lib/db/repos/connectionsRepo.js"]);
    const src = readRepoFile("src/lib/db/repos/connectionsRepo.js");
    const body = src.match(/export async function updateProviderConnection[\s\S]*?\n}/);
    const freeMerge = body ? /\{ \.\.\.existing, \.\.\.data,/.test(body[0]) : false;
    const ok = lines.length === 2 && freeMerge;
    return {
      ok,
      detail: `${lines.length} OPTIONAL_FIELDS uses (expect 2: declaration + createProviderConnection); updateProviderConnection ${freeMerge ? "still merges freely" : "NO LONGER merges the whole object"} — the reduction half needs reading`,
      lines,
    };
  }),

  check(24, "smartrouting", "the errorSignals thread survives end to end", () => {
    // parseUpstreamError is the last place in the request path holding the upstream
    // Response, so it is the only place a header can be captured. A break anywhere along
    // the thread is silent: classification degrades to status + message, still returns a
    // plausible weight, and nothing reports the header signal went missing. Every value on
    // the thread is an object or undefined, so a dropped forward is not a type error.
    const lines = gitGrep(["-n", "--untracked", "errorSignals", "--", "open-sse", "src"]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    const ok = lines.length === 28 && files.size === 8;
    return {
      ok,
      detail: `${lines.length} hits / ${files.size} files (expect 28 / 8)`,
      lines,
    };
  }),

  check(25, "smartrouting", "the Smart Routing branch is await-free and inside the mutex", () => {
    // The concurrency argument is that there is no asynchronous wait between reading
    // shared state and writing it — which holds only because the runtime is
    // single-threaded. One await inside the branch reintroduces the race with no symptom
    // beyond load distribution degrading under concurrency, so this is asserted
    // structurally rather than by counting anything.
    const src = readRepoFile("src/sse/services/auth.js");

    const start = src.indexOf("} else if (strategy === ROUTING_STRATEGY.SMART) {");
    if (start === -1) {
      return { ok: false, detail: "SMART branch NOT FOUND — the strategy chain was restructured", lines: [] };
    }

    // Walk braces from the branch's opening `{` to find its matching close, rather than
    // regexing to the next `}` — the body contains nested blocks.
    const open = src.indexOf("{", start);
    let depth = 0;
    let end = -1;
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === "{") depth += 1;
      else if (src[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    // Comments stripped first: the branch's own docblock explains why there is no await by
    // using the word, so a raw count reports a correct branch as broken.
    const body = end === -1 ? "" : stripComments(src.slice(open, end));
    const awaits = (body.match(/\bawait\b/g) || []).length;

    // Position: upstream's round-robin branch must come before it and the fill-first
    // `else` after it, which is what keeps the branch inside selectionMutex.
    const roundRobin = src.indexOf('} else if (strategy === "round-robin") {');
    const fillFirst = src.indexOf("// Default: fill-first");
    const positioned = roundRobin !== -1 && fillFirst !== -1 && roundRobin < start && start < fillFirst;

    const ok = awaits === 0 && positioned;
    return {
      ok,
      detail: `${awaits} await(s) in the branch (expect 0); ${positioned ? "positioned between round-robin and fill-first" : "NO LONGER between round-robin and fill-first — check it is still inside selectionMutex"}`,
      lines: awaits ? [body.split("\n").find((l) => /\bawait\b/.test(l))?.trim() ?? ""] : [],
    };
  }),

  check(26, "smartrouting", "the two persisted field prefixes have one home", () => {
    // A second literal is how a reader and a writer end up disagreeing about a field name
    // that looks right in both. auth.js logs a demotion by testing
    // `demotedAtKey(lockScope) in scoreUpdate`, which is why it contributes nothing here.
    const lines = gitGrep(["-n", "--untracked", "smartErrorScore_\\|smartDemotedAt_", "--", "open-sse", "src"]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    const onlyHome = files.size === 1 && files.has("src/lib/smartRouting.js");
    const ok = lines.length === 2 && onlyHome;
    return {
      ok,
      detail: `${lines.length} hits / ${files.size} files (expect 2 / 1, in src/lib/smartRouting.js)`,
      lines,
    };
  }),

  check(27, "smartrouting", "resolveConversationKey still stops after two tiers", () => {
    // If it ever falls through to workspaceId or deriveSessionId(connectionId) the answer
    // becomes keyed on the ACCOUNT — and asking "which conversation is this?" in order to
    // decide which account to use would then be answered with the account.
    const src = readRepoFile("open-sse/utils/sessionManager.js");
    const body = src.match(/export function resolveConversationKey[\s\S]*?\n}/);
    if (!body) {
      return { ok: false, detail: "resolveConversationKey NOT FOUND", lines: [] };
    }
    const required = ["extractClientSessionId", "assistantTextSessionId"];
    const forbidden = ["workspaceId", "deriveSessionId"];
    const missing = required.filter((n) => !body[0].includes(n));
    const leaked = forbidden.filter((n) => body[0].includes(n));
    const ok = missing.length === 0 && leaked.length === 0;
    return {
      ok,
      detail: `${missing.length ? `MISSING: ${missing.join(", ")}` : "both tiers present"}; ${leaked.length ? `ACCOUNT-KEYED FALLBACK PRESENT: ${leaked.join(", ")}` : "no account-keyed fallback"} — ASSISTANT_MIN_LEN/ASSISTANT_CAP_LEN still need reading`,
      lines: [],
    };
  }),

  check(28, "smartrouting", "the smart-routing value is written once", () => {
    // Upstream compares `strategy === "round-robin"` and treats everything else as
    // fill-first, so a typo'd or duplicated third value does not error — it silently
    // selects fill-first and Smart Routing appears to do nothing.
    //
    // Counted in CODE only. Comments name the value on purpose — several explain what a
    // stored `smart-routing` does to a control that cannot represent it — and a raw grep
    // counts those, which reported three hits while there was still exactly one literal.
    // Same trap as item 25, and it fired here for the same reason.
    //
    // Matched as a COMPLETE quoted string, not as a substring. The Smart Logs routes live at
    // `/api/logs/smart-routing`, so the same characters now appear inside URL strings that have
    // nothing to do with the stored value. A substring count read those as duplicate literals
    // and turned a passing item into four phantom failures. The strategy value is always the
    // whole string; a path never is.
    const candidates = gitGrep(["-l", "--untracked", "-F", "smart-routing", "--", "open-sse", "src"]);
    const inCode = [];
    for (const file of candidates) {
      const code = stripComments(readRepoFile(file));
      const n = (code.match(/(["'`])smart-routing\1/g) || []).length;
      for (let i = 0; i < n; i += 1) inCode.push(file);
    }
    const files = new Set(inCode);
    const ok = inCode.length === 1 && files.has("src/lib/routingStrategy.js");
    return {
      ok,
      detail: `${inCode.length} literal(s) in code across ${files.size} file(s) (expect 1, in src/lib/routingStrategy.js); ${candidates.length} file(s) mention it including comments`,
      lines: inCode,
    };
  }),

  check(29, "attempts", "all nine account walks go through the shared loop", () => {
    // A handler that reinstates a local `while (true)` walk works perfectly and silently
    // opts out of the ceilings, the malformed-request stop and the disconnect stop. This is
    // the only thing that would notice.
    const walks = gitGrep(["-n", "--untracked", "-F", "while (true)", "--", "src/sse/handlers", "src/app/api"]);
    const callers = gitGrep(["-l", "--untracked", "runAccountAttempts", "--", "open-sse", "src"]);

    // getProviderCredentials must have exactly one CALL outside the loop — handleVideoGet,
    // deliberately a single attempt because video jobs are account-bound upstream. Comment
    // mentions are excluded by requiring the open paren after an await.
    const selectHits = gitGrep(["-n", "--untracked", "getProviderCredentials", "--", "src/sse/handlers", "src/app/api"]);
    const realCalls = selectHits.filter((l) => /await getProviderCredentials\(/.test(l));

    const ok = walks.length === 0 && callers.length === 10 && realCalls.length === 1;
    return {
      ok,
      detail: `${walks.length} local while(true) walks (expect 0); ${callers.length} files reference runAccountAttempts (expect 10 — nine callers plus the loop); ${realCalls.length} direct getProviderCredentials call outside the loop (expect 1 — handleVideoGet)`,
      lines: [...walks, ...realCalls],
    };
  }),

  check(30, "attempts", "markAttemptFailure still appends optional arguments conditionally", () => {
    // Upstream tests assert markAccountUnavailable with toHaveBeenCalledWith and FIVE
    // arguments, and that matcher compares the whole list — a trailing null makes it six
    // and fails them even though the value is equivalent. The fork edits no upstream test
    // file, so the caller is the side that moves. Nothing static sees this failure: the
    // code is correct, the values are equivalent, and the build passes.
    const src = readRepoFile("src/sse/services/accountAttemptLoop.js");
    const body = src.match(/export function markAttemptFailure[\s\S]*?\n}/);
    if (!body) {
      return { ok: false, detail: "markAttemptFailure NOT FOUND", lines: [] };
    }
    // A five-element array first, then conditional pushes.
    const buildsFive = /const args = \[connectionId, status, errorText, provider, lockKey\]/.test(body[0]);
    const conditional = /if \(resetsAtMs != null \|\| errorSignals != null\)/.test(body[0])
      && /if \(errorSignals != null\) args\.push\(errorSignals\)/.test(body[0]);
    const spread = /markAccountUnavailable\(\.\.\.args\)/.test(body[0]);

    // And it must stay the only route to markAccountUnavailable outside auth.js itself.
    //
    // Matched WITH the open paren, so a bare mention in prose does not register — several
    // handlers explain in comments why their lock key is what it is and name the function
    // while doing it. Import lines have no paren either, which is the same result for the
    // same reason.
    const callSites = gitGrep(["-n", "--untracked", "markAccountUnavailable(", "--", "src/sse", "src/app/api"]);
    const expected = [
      "src/sse/services/auth.js",              // the definition
      "src/sse/services/accountAttemptLoop.js", // markAttemptFailure's single call
      "src/sse/handlers/videoGeneration.js",    // handleVideoGet, deliberately one attempt
    ];
    const unexpected = [...new Set(callSites.map((l) => l.split(":")[0]))].filter((f) => !expected.includes(f));

    const ok = buildsFive && conditional && spread && unexpected.length === 0;
    return {
      ok,
      detail: `${buildsFive && conditional && spread ? "five-arg base with conditional pushes intact" : "SHAPING CHANGED — upstream's 5-arg assertions will fail"}; ${unexpected.length ? `unexpected callers: ${unexpected.join(", ")}` : "no caller outside auth.js, the loop and handleVideoGet"}`,
      lines: unexpected,
    };
  }),

  check(31, "attempts", "the malformed-request check runs before the account is marked", () => {
    // Both halves matter. Classify first and the failure is already labelled transient, too
    // late to act on. Mark first and the request stops correctly but an account has been
    // locked for a fault that was never its own. Positional because it is an ordering claim
    // and no count can express one.
    const src = readRepoFile("src/sse/services/accountAttemptLoop.js");
    const loop = src.slice(src.indexOf("while (true) {"));
    const badRequestAt = loop.indexOf("isBadRequest(");
    const hookAt = loop.indexOf("onAttemptFailed");
    const markAt = loop.indexOf("markAttemptFailure({");
    const ordered = badRequestAt !== -1 && badRequestAt < hookAt && badRequestAt < markAt;

    // And the detection must stay POSITIVE: an unrecognised 400 returns false. Inverted,
    // every situation not yet on the list disables failover.
    const policy = readRepoFile("src/lib/errorPolicy.js");
    const fn = policy.match(/export function isBadRequest[\s\S]*?\n}/);
    const positive = fn
      ? /return \(\s*matchesAny/.test(fn[0]) && !/return true;/.test(fn[0])
      : false;

    // No provider's generic error TYPE may appear in the phrase lists. One of these was in
    // INVALID_PARAMETER_PHRASES and turned positive detection into "every 400 is broken":
    // six real bodies classified as bad requests, model-access denial and
    // organization-verification among them, both of which another connection may serve. A type
    // name says nothing about whether the request is malformed, so it can never belong.
    // Scoped to the phrase-list region so the explanatory comments above it, which name the
    // offender on purpose, do not trip the check.
    const listsRegion = stripComments(
      policy.slice(policy.indexOf("const CREDIT_PHRASES"), policy.indexOf("const STRUCTURED_HEAVY"))
    );
    const typeNames = ["invalid_request_error", "invalid_request", "api_error"];
    const leaked = typeNames.filter((name) => listsRegion.includes(`"${name}"`));

    const ok = ordered && positive && leaked.length === 0;
    return {
      ok,
      detail: `${ordered ? "isBadRequest precedes both marking paths" : "ORDERING BROKEN — a malformed request will lock an account"}; ${positive ? "detection still positive" : "detection NO LONGER positive — an unrecognised 400 now disables failover"}; ${leaked.length ? `GENERIC TYPE NAME IN A PHRASE LIST: ${leaked.join(", ")} — remove it, do not add a carve-out` : "no generic type name in the phrase lists"}`,
      lines: leaked,
    };
  }),

  check(32, "smartlogs", "the display read still never refreshes a binding", () => {
    // The only assertion in this list whose failure is both SILENT and BEHAVIOURAL. Nothing
    // errors, no count moves, the page keeps rendering — the thirty-minute idle window simply
    // stops expiring for anyone who leaves the tab open, because the display read starts
    // extending the bindings it reports.
    const src = readRepoFile("src/sse/services/sessionAffinity.js");

    const snapshot = src.match(/export function snapshotBindings[\s\S]*?\n}/);
    if (!snapshot) {
      return { ok: false, detail: "snapshotBindings NOT FOUND", lines: [] };
    }
    // Comments stripped: the docblock explains at length what it must not do, naming the field.
    const snapshotBody = stripComments(snapshot[0]);
    const writes = /\blastSeen\s*=/.test(snapshotBody) || /entry\.lastSeen\s*=/.test(snapshotBody);

    // The contrast is half the assertion. The routing read MUST still refresh — the idle window
    // is measured from the last request, and that is the read which measures it. If both stop
    // refreshing, sessions expire while still in use.
    const routing = src.match(/export function getBoundConnectionId[\s\S]*?\n}/);
    const routingRefreshes = routing ? /lastSeen\s*=\s*now/.test(stripComments(routing[0])) : false;

    const ok = !writes && routingRefreshes;
    return {
      ok,
      detail: `${writes ? "snapshotBindings WRITES lastSeen — the window will stop expiring" : "snapshotBindings does not write lastSeen"}; ${routingRefreshes ? "getBoundConnectionId still refreshes" : "getBoundConnectionId NO LONGER refreshes — sessions will expire while in use"}`,
      lines: [],
    };
  }),

  check(33, "smartlogs", "the sessionTag thread survives end to end", () => {
    // Same shape and same silence as item 1: every value on the thread is a string or
    // undefined, so a dropped forward is not a type error — the session column just empties.
    //
    // The streaming count is the subtle one. A streaming row is upserted twice under one id, so
    // a field on only the first write is erased by the second, and the symptom is a column that
    // populates and then blanks a few seconds later.
    // Scoped to the THREAD — producer, carriers, store — and deliberately not to `src/app`.
    // The page and the sessions route read the field by name too, and counting them would mean
    // every new consumer had to come back and edit this number, which is how a count stops
    // being an assertion and becomes a chore. The thread is what has to stay intact; the
    // consumers are free to multiply.
    const scope = ["--", "open-sse", "src/sse", "src/lib/db"];
    const lines = gitGrep(["-n", "--untracked", "sessionTag", ...scope]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    const streaming = lines.filter((l) => l.startsWith("open-sse/handlers/chatCore/streamingHandler.js"));
    const ok = lines.length === 20 && files.size === 8 && streaming.length === 4;
    return {
      ok,
      detail: `${lines.length} hits / ${files.size} files on the thread (expect 20 / 8); ${streaming.length} in streamingHandler (expect 4 — two signatures and two record calls)`,
      lines,
    };
  }),

  check(34, "smartlogs", "no raw session id leaves the process", () => {
    // Tier-1 session ids come from the client, and isAuthenticated() passes everyone once
    // requireLogin is off, so a raw value on a screen or in a stored record publishes whatever
    // the client sent. Only sessionFingerprint's output may travel.
    const affinity = readRepoFile("src/sse/services/sessionAffinity.js");

    // One hashing site, and it is the fingerprint. A second one is a second transformation,
    // which gives one conversation two tags and silently breaks the card-to-row matching.
    const hashSites = (stripComments(affinity).match(/createHash\(/g) || []).length;

    // The snapshot must expose the tag, never the map key it derived it from.
    const snapshot = affinity.match(/export function snapshotBindings[\s\S]*?\n}/);
    const exposesTag = snapshot ? /sessionTag:\s*sessionFingerprint\(/.test(snapshot[0]) : false;

    // bindingKey is file-local on purpose. A route or component reaching for it would be
    // reaching for the raw id.
    const keyLeak = gitGrep(["-l", "--untracked", "bindingKey", "--", "src/app", "open-sse"]);

    const ok = hashSites === 1 && exposesTag && keyLeak.length === 0;
    return {
      ok,
      detail: `${hashSites} hashing site(s) in sessionAffinity (expect 1, in sessionFingerprint); snapshot ${exposesTag ? "exposes the fingerprint" : "NO LONGER exposes sessionFingerprint's output"}; ${keyLeak.length ? `bindingKey referenced outside the module: ${keyLeak.join(", ")}` : "bindingKey stays file-local"} — the "one definition" half still needs reading`,
      lines: keyLeak,
    };
  }),

  check(35, "smartlogs", "the strategy precedence has one home", () => {
    // Three readers now: the selection path, the provider tiles and the detail endpoint. A
    // second copy of a two-branch precedence drifts — the day it changes, the page lists the
    // wrong providers and nothing fails.
    //
    // Structural rather than a bare grep, because the obvious pattern does not work: `combos`
    // owns an unrelated field also called `fallbackStrategy`, so matching the `||` chain finds
    // four files that have nothing to do with account selection. What identifies a re-inlined
    // copy is chaining the field to ITSELF — override first, then the global — so that is what
    // is counted, inside the selection and API scope where such a copy would matter.
    const src = readRepoFile("src/lib/routingStrategy.js");
    const fn = src.match(/export function resolveProviderStrategy[\s\S]*?\n}/);
    const holdsPrecedence = fn
      ? /override\.fallbackStrategy\s*\|\|\s*settings\?\.fallbackStrategy\s*\|\|/.test(stripComments(fn[0]))
      : false;

    const scope = ["--", "open-sse", "src/sse", "src/lib", "src/app/api"];
    const chains = gitGrep(["-n", "--untracked", "fallbackStrategy.*fallbackStrategy", ...scope]);
    const files = new Set(chains.map((l) => l.split(":")[0]));

    const ok = holdsPrecedence && chains.length === 1 && files.has("src/lib/routingStrategy.js");
    return {
      ok,
      detail: `${holdsPrecedence ? "resolveProviderStrategy still holds the override-then-global chain" : "resolveProviderStrategy NO LONGER holds the precedence — it moved or was rewritten"}; ${chains.length} chain(s) in the selection scope (expect 1, in src/lib/routingStrategy.js)`,
      lines: chains,
    };
  }),

  check(36, "all", "the fork inventory is complete", () => {
    // The bare prefix, not one feature's tag: nineteen files carry more than one tag, so
    // per-feature greps overlap and none of them is the whole fork. DERIVE the sum from the
    // tag counts, never from the number of shared files — the excess is TWENTY-SIX across
    // nineteen files, because thirteen carry two tags, five carry three and one carries four.
    const files = gitGrep(["-l", "--untracked", "FORK(", "--", "open-sse", "src"]);
    const perFeature = Object.fromEntries(
      ["logs", "locks", "conntest", "tokenstat", "smartrouting", "attempts", "smartlogs"].map((f) => [
        f,
        gitGrep(["-l", "--untracked", `FORK(${f})`, "--", "open-sse", "src"]).length,
      ])
    );
    const sum = Object.values(perFeature).reduce((a, b) => a + b, 0);
    const ok = files.length === 59 && sum === 85;
    const counts = Object.entries(perFeature).map(([f, n]) => `${f}=${n}`).join(" ");
    return {
      ok,
      detail: `${files.length} tagged files (expect 59); ${counts}, sum=${sum} (expect 85 — nineteen files carry more than one tag)`,
      lines: files,
    };
  }),
];

// Items the document deliberately settles by reading rather than counting. Listed so a
// clean run cannot be mistaken for a complete one.
//
// Item 27 is here as well as in CHECKS: its structural half is automated, but the part that
// actually decides behaviour — upstream's ASSISTANT_MIN_LEN and ASSISTANT_CAP_LEN, which
// govern which conversations get a fingerprint and how stable it stays — is a pair of numbers
// no assertion here can judge.
const MANUAL_ITEMS = [
  [4, "logs", "parseSessionName vs createLogSession: the name screen must stay a deny-list, and the stamp local-time"],
  [7, "logs", "truncateField must keep returning a new value instead of mutating its argument"],
  [17, "locks", "buildClearModelLocksUpdate must still enumerate modelLock_* by prefix, not from a fixed list"],
  [23, "tokenstat", "buildRefreshAttempt must keep bounding classification and providerCode through reduceDetail — GET /api/providers publishes both"],
  [27, "smartrouting", "ASSISTANT_MIN_LEN and ASSISTANT_CAP_LEN in sessionManager.js still decide which conversations get a fingerprint — retuning either silently changes affinity coverage"],
  [34, "smartlogs", "sessionFingerprint must stay the ONE transformation — the session cards and the log rows are matched by eye, so a second one gives a conversation two tags and breaks the matching with nothing failing"],
];

function main() {
  const results = CHECKS.map((c) => {
    try {
      return { ...c, ...c.fn() };
    } catch (error) {
      return { ...c, ok: false, detail: `check threw: ${error.message}` };
    }
  });

  const width = Math.max(...CHECKS.map((c) => c.tag.length));
  console.log(`\n9router fork check — ${CHECKS.length} automated items, ${MANUAL_ITEMS.length} to read\n`);

  for (const r of results) {
    const id = String(r.id).padStart(2);
    console.log(`  [${id}] ${r.tag.padEnd(width)}  ${r.ok ? PASS : FAIL}  ${r.title}`);
    console.log(`       ${" ".repeat(width)}        ${r.detail}`);
    if (!r.ok && VERBOSE && r.lines?.length) {
      for (const line of r.lines) console.log(`       ${" ".repeat(width)}        | ${line}`);
    }
  }

  console.log(`\n  ${MANUAL} — these cannot be counted, only read:`);
  for (const [id, tag, what] of MANUAL_ITEMS) {
    console.log(`  [${String(id).padStart(2)}] ${tag.padEnd(width)}          ${what}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} pass, ${failed.length} fail, ${MANUAL_ITEMS.length} to read`);

  if (failed.length) {
    console.log(`\nRead the comment above each failed item in this file: ${failed.map((r) => r.id).join(", ")}.`);
    console.log("A count that moved for a legitimate upstream change is not a failure — confirm the");
    console.log("new shape, then update the number here. This script is the only place it lives.");
    console.log("Re-run with --verbose to see the matched lines.");
    console.log("Items 25, 29, 30, 31, 32 and 34 are the exception — they assert an ordering or an");
    console.log("absence, so a failure there means behaviour moved, not that a number is stale.");
  } else {
    console.log(`\nStill to do by hand: the ${MANUAL_ITEMS.length} items above, then build, lint and the`);
    console.log("test comparison — see \"Verifying a merge\" in FORK-CHANGES.md. None of those is a grep.");
  }

  process.exit(failed.length ? 1 : 0);
}

main();
