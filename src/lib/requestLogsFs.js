// FORK(logs): read-only accessor for the staged raw payload dump written by
// open-sse/utils/requestLogger.js when ENABLE_REQUEST_LOGS=true.
//
// Layout written by that logger, one directory per upstream attempt:
//   <cwd>/logs/{sourceFormat}_{targetFormat}_{safeModel}_{YYYYMMDD}_{HHmmss}_{SSS}/
//     1_req_client.json    raw client request (endpoint, headers, body)
//     2_req_source.json    after initial source-format normalization
//     3_req_openai.json    OpenAI pivot format
//     4_req_target.json    final upstream request (url, headers, body)
//     5_res_provider.json  provider response (non-streaming)
//     5_res_provider.txt   provider SSE frames, appended (streaming)
//     6_res_openai.txt     OpenAI pivot chunks, appended (streaming)
//     6_error.json         error + stack, when the attempt threw
//     7_res_client.json    final client response (non-streaming)
//     7_res_client.txt     final client SSE frames, appended (streaming)
//
// This module never writes log content. It only reads, and prunes whole
// session directories to keep the tree bounded.
import fs from "node:fs";
import path from "node:path";

// Directory names reach this module from a URL, so they are screened before
// touching the filesystem — as a deny-list, not an allow-list of permitted
// characters.
//
// Do not tighten this into an allow-list. requestLogger.createLogSession
// sanitises only "/" and ":" in the model id, so a model containing "@" or "+"
// produces a directory an allow-list refuses, and that fails silently twice
// over: the row reports no dump although the directory is there, and
// pruneSessions never reclaims it, since it only deletes names it can identify.
//
// Path separators, bare "." / "..", and NUL are the only characters that could
// escape the logs root. path.resolve containment in safeSessionPath is the
// backstop, and parseSessionName's timestamp check filters out everything else.
const UNSAFE_NAME_RE = /[/\\]|\0/;
const DOT_SEGMENT_RE = /^\.{1,2}$/;

function isUnsafeSessionName(name) {
  const value = String(name || "");
  if (!value) return true;
  return UNSAFE_NAME_RE.test(value) || DOT_SEGMENT_RE.test(value);
}

// Guards against a single multi-MB SSE transcript blowing up an API response.
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Markers that prove a streamed response finished, rather than the transcript
// merely having received its first chunk.
//
// Do not reduce this to `[DONE]`. open-sse/utils/stream.js appends that only when
// `!streamDoneSent && !isGeminiFamily`, so a complete OpenAI chat-completions
// stream can end without one — its last chunk carries `"finish_reason":"stop"`
// and a usage block instead.
const STREAM_TERMINATORS = ["[DONE]", "response.completed", "message_stop"];

// A non-null finish reason in any format: OpenAI's `finish_reason` (stop, length,
// tool_calls, content_filter) and Gemini's `finishReason`. Requiring a quoted,
// non-empty value is what excludes the bare `null` every non-final chunk carries.
const FINISH_REASON_RE = /"finish_?[Rr]eason"\s*:\s*"[^"]+"/;

// Large enough that a final chunk carrying a usage block or a long tool_calls
// payload still lands inside the probe.
const TAIL_PROBE_BYTES = 8192;

// Placeholder content written by streamingHandler.js when the stream opens. It
// is replaced when buildOnStreamComplete's callback runs, so its presence means
// the stream never reached a clean end.
const STREAMING_PLACEHOLDER = "[Streaming in progress...]";

const PRUNE_THROTTLE_MS = 5 * 60 * 1000;
let lastPruneAt = 0;

const STAGE_FILES = [
  { key: "clientRequest", file: "1_req_client.json", kind: "json", label: "1. Client Request (raw)" },
  { key: "sourceRequest", file: "2_req_source.json", kind: "json", label: "2. Source Request (normalized)" },
  { key: "openaiRequest", file: "3_req_openai.json", kind: "json", label: "3. OpenAI Pivot Request" },
  { key: "targetRequest", file: "4_req_target.json", kind: "json", label: "4. Provider Request (final)" },
  { key: "providerResponse", file: "5_res_provider.json", kind: "json", label: "5. Provider Response" },
  { key: "providerStream", file: "5_res_provider.txt", kind: "text", label: "5. Provider Response (SSE frames)" },
  { key: "openaiStream", file: "6_res_openai.txt", kind: "text", label: "6. OpenAI Pivot (SSE frames)" },
  { key: "error", file: "6_error.json", kind: "json", label: "6. Error" },
  { key: "clientResponse", file: "7_res_client.json", kind: "json", label: "7. Client Response" },
  { key: "clientStream", file: "7_res_client.txt", kind: "text", label: "7. Client Response (SSE frames)" },
];

/**
 * Root of the dump tree. Mirrors requestLogger.js exactly (process.cwd()/logs);
 * it deliberately does NOT follow DATA_DIR, because the writer does not either.
 */
function resolveLogsDir() {
  return path.join(process.cwd(), "logs");
}

/**
 * Split a session directory name back into its parts.
 *
 * The name is ambiguous at first glance: the trailing timestamp is itself three
 * underscore-separated groups, and a model id may contain underscores. Format
 * ids never do (see open-sse/translator/formats.js — they use hyphens), so the
 * name is parsed from BOTH ends and whatever remains in the middle is the model.
 *
 * @returns {{name:string, sourceFormat:string, targetFormat:string, model:string, timestamp:string}|null}
 */
function parseSessionName(name) {
  if (typeof name !== "string" || isUnsafeSessionName(name)) return null;

  const parts = name.split("_");
  // source + target + at least one model part + 3 timestamp parts
  if (parts.length < 6) return null;

  const ms = parts[parts.length - 1];
  const hms = parts[parts.length - 2];
  const ymd = parts[parts.length - 3];
  if (!/^\d{3}$/.test(ms) || !/^\d{6}$/.test(hms) || !/^\d{8}$/.test(ymd)) return null;

  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  const day = Number(ymd.slice(6, 8));
  const hour = Number(hms.slice(0, 2));
  const minute = Number(hms.slice(2, 4));
  const second = Number(hms.slice(4, 6));

  // requestLogger formats the stamp from local-time getters, so rebuild it as
  // local time. Using Date.UTC here would shift every row by the tz offset.
  const date = new Date(year, month - 1, day, hour, minute, second, Number(ms));
  if (Number.isNaN(date.getTime())) return null;

  return {
    name,
    sourceFormat: parts[0],
    targetFormat: parts[1],
    model: parts.slice(2, parts.length - 3).join("_"),
    timestamp: date.toISOString(),
  };
}

/**
 * Validate a persisted requestDetails.logDir as a session directory name.
 *
 * The stored value is already the bare name — requestDetailsRepo reduces
 * reqLogger.sessionPath to its final segment on the way in, so an absolute path
 * never reaches the record and never reaches a URL from here. That reduction is
 * the single normalisation point; this function only screens the result and does
 * not strip anything itself.
 *
 * Which is why the two have to move together: parseSessionName rejects a name
 * containing a path separator, so if that reduction is ever removed this returns
 * null for every row and the whole tab reports no raw dump.
 *
 * Returns null unless it parses as a real session name.
 */
export function sessionNameFromLogDir(logDir) {
  if (typeof logDir !== "string" || !logDir) return null;
  return parseSessionName(logDir) ? logDir : null;
}

/**
 * Absolute path of a session directory as resolved right now.
 *
 * Built from resolveLogsDir() and the session name, so it points at where the
 * files are now rather than where they were when the row was written — which is
 * the other reason the record stores only a name. The dashboard shows this path
 * so a file can be opened directly, which also makes a broken logs root
 * immediately obvious.
 */
export function sessionDirPath(name) {
  return safeSessionPath(name);
}

/**
 * Resolve a session directory, refusing anything that escapes the logs root.
 * @returns {string|null} absolute path, or null when the name is unsafe/unknown
 */
function safeSessionPath(name) {
  if (isUnsafeSessionName(name)) return null;
  // Belt and braces: the screen above already excludes separators and dot
  // segments, but the resolved path is re-checked so a future change to that
  // screen cannot open a hole.
  const root = resolveLogsDir();
  const resolved = path.resolve(root, name);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

function readFileCapped(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  if (stat.size > MAX_FILE_BYTES) {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(MAX_FILE_BYTES);
      const read = fs.readSync(fd, buf, 0, MAX_FILE_BYTES, 0);
      return {
        text: buf.subarray(0, read).toString("utf8"),
        truncated: true,
        originalSize: stat.size,
      };
    } finally {
      fs.closeSync(fd);
    }
  }

  try {
    return { text: fs.readFileSync(filePath, "utf8"), truncated: false, originalSize: stat.size };
  } catch {
    return null;
  }
}

/** Read the last bytes of a file without loading the whole transcript. */
function readTail(filePath, bytes = TAIL_PROBE_BYTES) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return "";
  }
  if (!stat.isFile() || stat.size === 0) return "";

  const length = Math.min(bytes, stat.size);
  const position = stat.size - length;
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(length);
    const read = fs.readSync(fd, buf, 0, length, position);
    return buf.subarray(0, read).toString("utf8");
  } catch {
    return "";
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Classify how an attempt ended, from the dump alone.
 *
 * Needed because requestDetails.status is unreliable for streaming:
 * streamingHandler.js hardcodes status:"success" both when the stream opens and
 * when it completes, so a stream that dies mid-flight still reads as a success.
 * Deriving it here keeps that upstream file untouched.
 *
 * @returns {"error"|"ok"|"incomplete"|"unknown"}
 */
export function deriveOutcome(name) {
  const dir = safeSessionPath(name);
  if (!dir) return "unknown";

  if (fs.existsSync(path.join(dir, "6_error.json"))) return "error";

  // Non-streaming: this file is written once, after the response is complete.
  if (fs.existsSync(path.join(dir, "7_res_client.json"))) return "ok";

  // Streaming: the transcript is appended chunk by chunk, so its mere presence
  // proves nothing. Only a terminal marker in the tail does.
  const streamPath = path.join(dir, "7_res_client.txt");
  if (fs.existsSync(streamPath)) {
    const tail = readTail(streamPath);
    const finished = STREAM_TERMINATORS.some((marker) => tail.includes(marker))
      || FINISH_REASON_RE.test(tail);
    return finished ? "ok" : "incomplete";
  }

  return "incomplete";
}

/**
 * Did this record's stream reach buildOnStreamComplete's callback?
 *
 * That callback is invoked from the transform stream's flush, which a
 * TransformStream only runs on a clean close — never on abort or error. So the
 * row starts life with a placeholder body, zero tokens and ttft 0, and is
 * upserted with real values only once the stream ends properly.
 *
 * Reads the record's `response`, which requestDetailsRepo replaces wholesale
 * with a {_truncated, …} stub past observabilityMaxJsonSize. A clipped response
 * has no `type` left, so it fails the guard below and resolveOutcome falls
 * through to the transcript. That costs nothing, and the reason is worth
 * knowing before reordering the steps there: a response only grows large enough
 * to be clipped by completing, while an aborted stream keeps the short
 * placeholder and is still read here.
 *
 * Not exported: callers should go through resolveOutcome, which applies the
 * error precedence this function knows nothing about.
 *
 * @returns {"ok"|"incomplete"|null} null when the record carries no usable stream signal
 */
function deriveStreamingOutcomeFromRecord(detail) {
  if (!detail || detail.response?.type !== "streaming") return null;

  const content = detail.response?.content;
  if (typeof content === "string" && content !== STREAMING_PLACEHOLDER) return "ok";

  // Content is missing or still the placeholder, yet the completion callback
  // plainly ran: nothing else writes a real ttft or token count. This is the
  // provider-returned-tokens-but-empty-content case.
  if (Number(detail.latency?.ttft) > 0) return "ok";
  if (Number(detail.tokens?.completion_tokens) > 0) return "ok";

  return "incomplete";
}

/**
 * Final outcome for a row, combining the persisted record with the raw dump.
 *
 * Precedence:
 *   1. An explicit error wins, from either side.
 *   2. The record's streaming signal, when the record still carries one — see
 *      deriveStreamingOutcomeFromRecord.
 *   3. The transcript, for rows with no usable record signal: non-streaming
 *      ones, and streams whose response was clipped on write.
 *
 * @param {{detail?: object, logOutcome?: string|null}} input
 * @returns {{outcome: "ok"|"error"|"incomplete"|"unknown", source: "logs"|"record"}}
 */
export function resolveOutcome({ detail, logOutcome }) {
  if (logOutcome === "error") return { outcome: "error", source: "logs" };
  if (detail?.status === "error") return { outcome: "error", source: "record" };

  const fromRecord = deriveStreamingOutcomeFromRecord(detail);
  if (fromRecord) return { outcome: fromRecord, source: "record" };

  if (logOutcome === "ok" || logOutcome === "incomplete") {
    return { outcome: logOutcome, source: "logs" };
  }

  // Nothing above answered: no dump to read, and no streaming markers on the
  // record. A stored success is all that is left, and it is the weakest signal
  // here — streamingHandler.js writes it at stream open, so a stream that died
  // mid-flight and lost its dump reads as "ok". The steps above exist to keep
  // that case from reaching this line.
  if (detail?.status === "success") return { outcome: "ok", source: "record" };

  return { outcome: "unknown", source: "record" };
}

/** True when the session directory still exists (it may have been pruned). */
export function sessionExists(name) {
  const dir = safeSessionPath(name);
  if (!dir) return false;
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Every valid session directory, newest first.
 *
 * Sorting is by the PARSED timestamp, not the raw name: names begin with the
 * source format, so a lexical sort would group by format instead of time.
 * Only names are inspected here — no session file is opened.
 */
function collectSessions() {
  const root = resolveLogsDir();
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const sessions = [];
  for (const entry of entries) {
    // Skip symlinks and stray files such as the legacy "<provider>-<date>.log".
    if (!entry.isDirectory()) continue;
    const parsed = parseSessionName(entry.name);
    if (parsed) sessions.push(parsed);
  }

  sessions.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));
  return sessions;
}

/**
 * Read every stage present in one session. Files are returned as they are on
 * disk: oversized transcripts are capped and malformed JSON comes back as raw
 * text rather than throwing, so a half-written file still renders, but nothing
 * inside a file is rewritten or filtered out.
 *
 * Stages only. Outcome belongs to the list endpoint, which resolves it against
 * the persisted record — returning it here too would give the panel a second
 * answer with no way to tell which one wins.
 */
export function readSession(name) {
  const dir = safeSessionPath(name);
  if (!dir) return null;

  const meta = parseSessionName(name);
  if (!meta) return null;

  try {
    if (!fs.statSync(dir).isDirectory()) return null;
  } catch {
    return null;
  }

  const stages = [];
  for (const stage of STAGE_FILES) {
    const read = readFileCapped(path.join(dir, stage.file));
    if (!read) continue;

    const entry = {
      key: stage.key,
      file: stage.file,
      label: stage.label,
      kind: stage.kind,
      truncated: read.truncated,
      size: read.originalSize,
    };

    if (stage.kind === "json") {
      try {
        // Strip a UTF-8 BOM if present: JSON.parse rejects it. requestLogger.js
        // does not emit one, but files copied or hand-edited on Windows may.
        //
        // Rendered exactly as stored, headers included. Masking happens on the
        // write side only — maskSensitiveHeaders at all four write sites in
        // open-sse/utils/requestLogger.js — so every file under logs/ is already
        // safe when it lands here. There is deliberately no second pass on read:
        // checklist item 2 is what keeps the write side honest, and a reader that
        // re-masked would make this view disagree with the file on disk.
        entry.json = JSON.parse(read.text.replace(/^\uFEFF/, ""));
      } catch {
        // Truncated or mid-write file: hand back the text so it is still useful.
        entry.text = read.text;
        entry.parseError = true;
      }
    } else {
      entry.text = read.text;
    }

    stages.push(entry);
  }

  return { ...meta, stages };
}

/**
 * Delete the oldest session directories until at most maxCount remain.
 *
 * This is the only function in the fork that removes files, so it is
 * deliberately narrow:
 *   - operates only on first-level children of resolveLogsDir()
 *   - only on entries that are real directories (symlinks are skipped)
 *   - only on names that parse as a valid session, so unrelated files such as
 *     the legacy "<provider>-<date>.log" are never touched
 *   - each removal is isolated, so one failure cannot abort the rest
 *
 * @returns {{removed:number, kept:number, failed:number}}
 */
function pruneSessions(maxCount) {
  const limit = Number(maxCount);
  if (!Number.isFinite(limit) || limit < 1) return { removed: 0, kept: 0, failed: 0 };

  const sessions = collectSessions();
  if (sessions.length <= limit) return { removed: 0, kept: sessions.length, failed: 0 };

  const root = resolveLogsDir();
  const doomed = sessions.slice(limit);
  let removed = 0;
  let failed = 0;

  for (const session of doomed) {
    const target = safeSessionPath(session.name);
    if (!target) { failed++; continue; }
    try {
      // Re-verify immediately before deleting: must still be a directory and
      // must not be a symlink pointing outside the tree.
      const stat = fs.lstatSync(target);
      if (!stat.isDirectory() || stat.isSymbolicLink()) { failed++; continue; }
      if (path.dirname(target) !== root) { failed++; continue; }
      fs.rmSync(target, { recursive: true, force: true });
      removed++;
    } catch {
      failed++;
    }
  }

  return { removed, kept: sessions.length - removed, failed };
}

/**
 * Throttled prune, safe to call on every list request. Keeps retention working
 * without adding a scheduler or touching the request path.
 *
 * PRUNE_THROTTLE_MS sets a minimum gap between runs, not a period: nothing calls
 * this on a timer, so retention advances only as often as someone loads the Logs
 * tab. The throttle is module state, so a restart clears it and the next call
 * prunes immediately.
 */
export function maybePruneSessions(maxCount) {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_THROTTLE_MS) return null;
  lastPruneAt = now;
  try {
    return pruneSessions(maxCount);
  } catch {
    return null;
  }
}

