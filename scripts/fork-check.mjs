#!/usr/bin/env node
// Fork tooling: runs the greps in the "Upstream merge checklist" section of
// FORK-CHANGES.md and reports one line per item.
//
// Carries no FORK(<feature>) tag on purpose. The tag exists so one grep returns a
// feature's whole footprint, and this file belongs to no feature — same reason
// FORK-CHANGES.md has none. It also sits outside that grep's `open-sse src` scope, so
// tagging it would not change the inventory count either way. It is listed in the
// document's Added table instead, which is the only record of both untagged files.
//
// Why this exists: the checklist is twenty-six items and most of them are a grep with
// an expected count. Running them by hand is twenty-six chances to skip the one that
// mattered, and the quoted commands are POSIX spellings that need translating on
// Windows (`sort -u`, and PowerShell expanding the `[id]` in a path as a character
// class). Node is already a dependency and behaves the same either way.
//
// This script does NOT replace FORK-CHANGES.md. It answers "did anything move?" and
// nothing else — every repair, every reason, and the four items that can only be
// settled by reading code live in the document. A FAIL here is an instruction to go
// read that item, not a diagnosis.
//
// Deliberately NOT covered, because none of it is a grep: the "Verifying" section
// (lint, build, the test comparison) and the eleven-step post-merge check against a
// running instance. A clean run here is necessary and not sufficient.
//
// Maintaining it: the expected numbers below are the same assertions as the ones in
// the document, so the two must move together. Checklist item 25 is the rule — when
// upstream legitimately changes a count, update both. Nothing detects a disagreement
// between this file and the markdown.
//
// Adding a feature shifts the tail: feature items go before the all-features and
// procedural ones, so the ids to fix here are the `MANUAL_ITEMS` entries, the item
// count in the line above, and the per-feature array inside the all-features check.
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

// Item order matches FORK-CHANGES.md's checklist exactly, so a FAIL maps to a section
// by number with nothing to look up.
const CHECKS = [
  check(1, "logs", "logDir survives the whole thread", () => {
    const scope = ["--", "open-sse/handlers", "src/lib/db/repos/requestDetailsRepo.js"];
    const lines = gitGrep(["-n", "logDir", ...scope]);
    const files = new Set(lines.map((l) => l.split(":")[0]));
    // Scope is narrow on purpose: a wider `-- open-sse` also matches an unrelated
    // local variable in transformer/responsesTransformer.js.
    const ok = lines.length === 17 && files.size === 6;
    return { ok, detail: `${lines.length} hits / ${files.size} files (expect 17 / 6)`, lines };
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

  check(24, "all", "the fork inventory is complete", () => {
    // The bare prefix, not one feature's tag: three files carry more than one tag, so
    // per-feature greps overlap and none of them is the whole fork. The sum exceeds the
    // file count by FIVE, not three: a two-tag file adds one and a three-tag file adds
    // two, and there is one of the former and two of the latter.
    const files = gitGrep(["-l", "--untracked", "FORK(", "--", "open-sse", "src"]);
    const perFeature = Object.fromEntries(
      ["logs", "locks", "conntest", "tokenstat"].map((f) => [
        f,
        gitGrep(["-l", "--untracked", `FORK(${f})`, "--", "open-sse", "src"]).length,
      ])
    );
    const sum = Object.values(perFeature).reduce((a, b) => a + b, 0);
    const ok = files.length === 26 && sum === 31;
    const counts = Object.entries(perFeature).map(([f, n]) => `${f}=${n}`).join(" ");
    return {
      ok,
      detail: `${files.length} tagged files (expect 26); ${counts}, sum=${sum} (expect 31 — one file carries two tags, two carry three)`,
      lines: files,
    };
  }),
];

// Items the document deliberately settles by reading rather than counting. Listed so a
// clean run cannot be mistaken for a complete one.
const MANUAL_ITEMS = [
  [4, "logs", "parseSessionName vs createLogSession: the name screen must stay a deny-list, and the stamp local-time"],
  [7, "logs", "truncateField must keep returning a new value instead of mutating its argument"],
  [17, "locks", "buildClearModelLocksUpdate must still enumerate modelLock_* by prefix, not from a fixed list"],
  [23, "tokenstat", "buildRefreshAttempt must keep bounding code and detail through reduceDetail — GET /api/providers publishes both"],
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
    console.log(`\nRead these items in FORK-CHANGES.md: ${failed.map((r) => r.id).join(", ")}.`);
    console.log("A count that moved for a legitimate upstream change is not a failure — confirm");
    console.log("the new shape, then update the number in BOTH this script and the document");
    console.log("(checklist item 25). Re-run with --verbose to see the matched lines.");
  } else {
    console.log(`\nStill to do by hand: the ${MANUAL_ITEMS.length} items above, then Verifying (lint, build,`);
    console.log("the test comparison) and the eleven-step post-merge check. None of those is a grep.");
  }

  process.exit(failed.length ? 1 : 0);
}

main();
