import { handleChat } from "@/sse/handlers/chat.js";
import {
  clearAccountError,
  isValidApiKey,
} from "@/sse/services/auth.js";
// FORK(attempts): this route used to carry its own copy of the account walk — the ninth, and
// the only one outside src/sse/handlers/. It now shares the loop with the other eight, which
// is what gives it the attempt ceilings and the malformed-request stop it never had. Its own
// per-attempt timeout and its response shapes are kept, because both are specific to it.
import { runAccountAttempts } from "@/sse/services/accountAttemptLoop.js";
import { getSettings } from "@/lib/localDb";
import { PROVIDER_MODELS } from "@/shared/constants/models";
import { GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS } from "open-sse/config/runtimeConfig.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;
const GEMINI_NATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Gemini model id charset (matches sanitizeGeminiFunctionName); blocks path traversal in upstream URL.
const GEMINI_NATIVE_MODEL_PATTERN = /^[a-zA-Z0-9_.:-]+$/;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1beta/models/{model}:generateContent        — non-streaming
 * POST /v1beta/models/{model}:streamGenerateContent  — streaming (SSE)
 *
 * Streaming intent is determined by the URL action suffix (canonical Gemini API
 * convention), NOT by a body field. generationConfig.stream is not a real
 * Gemini API field and Gemini CLI never sets it.
 *
 * The @google/genai SDK always uses :streamGenerateContent?alt=sse for chat.
 * The upstream handleChat returns OpenAI SSE format; we transform it to
 * Gemini SSE format on the fly via transformOpenAISSEToGeminiSSE().
 */
export async function POST(request, { params }) {
  await ensureInitialized();

  try {
    const { path } = await params;
    // path = ["provider", "model:action"] or ["model:action"]

    let model;
    let action; // ":generateContent" | ":streamGenerateContent"

    if (path.length >= 2) {
      // Format: /v1beta/models/provider/model:generateContent
      const provider = path[0];
      const modelAction = path[1];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      const modelName = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
      model = provider + "/" + modelName;
    } else {
      // Format: /v1beta/models/model:generateContent
      const modelAction = path[0];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      model = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
    }

    const body = await request.json();

    if (isGeminiNativeTtsRequest(model, body)) {
      return await forwardGeminiNativeRequest(request, body, model, action);
    }

    // Streaming is determined by URL action suffix:
    //   :streamGenerateContent => stream: true  (SSE)
    //   :generateContent       => stream: false (plain JSON)
    const stream = action === ":streamGenerateContent";

    // Convert Gemini request format to OpenAI/internal format
    const convertedBody = convertGeminiToInternal(body, model, stream);

    // Create new request with converted body
    const newRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(convertedBody),
    });

    const response = await handleChat(newRequest);

    if (stream) {
      // Transform OpenAI SSE => Gemini SSE on the fly.
      // The @google/genai SDK always uses :streamGenerateContent?alt=sse and
      // expects Gemini SSE chunks (no [DONE] sentinel — stream just closes).
      return transformOpenAISSEToGeminiSSE(response, model);
    } else {
      // Convert OpenAI JSON response => Gemini GenerateContentResponse
      return await convertOpenAIResponseToGemini(response, model);
    }
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    return Response.json(
      { error: { message: error.message, code: 500 } },
      { status: 500 }
    );
  }
}

function extractGeminiClientApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  const googleApiKey = request.headers.get("x-goog-api-key");
  if (googleApiKey) return googleApiKey;

  const url = new URL(request.url);
  return url.searchParams.get("key");
}

function normalizeGeminiNativeModel(model) {
  return String(model || "")
    .replace(/^models\//, "")
    .replace(/^gemini\//, "");
}

function getGeminiTtsModelIds() {
  return new Set([
    ...(PROVIDER_MODELS.gemini || [])
      .filter((model) => (model.kind || model.type) === "tts")
      .map((model) => model.id),
    ...(PROVIDER_MODELS["gemini-tts-models"] || []).map((model) => model.id),
  ]);
}

function hasAudioResponseModality(body) {
  const modalities = body?.generationConfig?.responseModalities;
  return Array.isArray(modalities)
    && modalities.some((modality) => String(modality).toUpperCase() === "AUDIO");
}

function isGeminiNativeTtsRequest(model, body) {
  const rawModel = String(model || "");
  if (rawModel.includes("/") && !rawModel.startsWith("gemini/") && !rawModel.startsWith("models/")) {
    return false;
  }

  const modelId = normalizeGeminiNativeModel(model);
  return hasAudioResponseModality(body) || getGeminiTtsModelIds().has(modelId);
}

function buildGeminiNativeUrl(requestUrl, model, action) {
  const sourceUrl = new URL(requestUrl);
  const upstreamUrl = new URL(`${GEMINI_NATIVE_BASE_URL}/${normalizeGeminiNativeModel(model)}${action}`);

  for (const [key, value] of sourceUrl.searchParams.entries()) {
    if (key === "key") continue;
    upstreamUrl.searchParams.append(key, value);
  }

  return upstreamUrl.toString();
}

async function validateGeminiNativeClientKey(request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;

  const apiKey = extractGeminiClientApiKey(request);
  if (!apiKey) {
    return Response.json({ error: { message: "Missing API key" } }, { status: 401 });
  }

  const valid = await isValidApiKey(apiKey);
  if (!valid) {
    return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
  }

  return null;
}

function buildGeminiNativeAuthHeaders(credentials) {
  if (credentials?.apiKey) return { "x-goog-api-key": credentials.apiKey };
  if (credentials?.accessToken) return { Authorization: `Bearer ${credentials.accessToken}` };
  return null;
}

function corsHeadersFrom(response) {
  const headers = new Headers(response.headers);
  // Node fetch may expose a decoded body while preserving upstream compression
  // headers. Forwarding those headers makes clients decompress plain bytes again.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function getSafeGeminiConnectionLabel(credentials) {
  const connectionId = String(credentials?.connectionId || "unknown");
  const shortId = connectionId.slice(0, 8);
  const connectionName = String(credentials?.connectionName || "");
  if (!connectionName || connectionName.includes("@")) return shortId;
  return `${connectionName}:${shortId}`;
}

function getGeminiNativeErrorCode(error) {
  return error?.cause?.code || error?.code || error?.cause?.name || error?.name || "UNKNOWN";
}

function isGeminiNativeTimeoutError(error, timedOut) {
  if (timedOut) return true;
  const code = getGeminiNativeErrorCode(error);
  return code === "UND_ERR_HEADERS_TIMEOUT" || code === "HeadersTimeoutError";
}

function getSafeGeminiNativeErrorText(error) {
  const message = error?.message || String(error);
  const code = getGeminiNativeErrorCode(error);
  return `${message} (${code})`;
}

async function forwardGeminiNativeRequest(request, body, model, action) {
  const authError = await validateGeminiNativeClientKey(request);
  if (authError) return authError;

  const modelId = normalizeGeminiNativeModel(model);
  if (!GEMINI_NATIVE_MODEL_PATTERN.test(modelId)) {
    return Response.json({ error: { message: "Invalid model" } }, { status: 400 });
  }
  const bodyText = JSON.stringify(body);

  return runAccountAttempts({
    provider: "gemini",
    lockKey: modelId,
    label: `[gemini/${modelId}]`,
    logTag: "GEMINI_NATIVE",
    signal: request.signal || null,
    attempt: async ({ credentials }) => {
      const authHeaders = buildGeminiNativeAuthHeaders(credentials);
      if (!authHeaders) {
        // Not a provider failure, so it must not rotate and must not lock an account. Reported
        // as a success carrying an error response — the same shape the original code returned
        // by returning straight out of the loop.
        return {
          success: true,
          response: Response.json({ error: { message: "No Gemini API key configured" } }, { status: 404 }),
        };
      }

      const safeConnection = getSafeGeminiConnectionLabel(credentials);
      const startedAt = Date.now();
      const upstreamUrl = buildGeminiNativeUrl(request.url, modelId, action);

      // Per-attempt deadline, chained to the client's signal. Kept local: the shared loop
      // bounds the WALK, this bounds one upstream call, and they are different limits.
      const attemptController = new AbortController();
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        attemptController.abort();
      }, GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS);
      const abortAttempt = () => attemptController.abort();
      request.signal?.addEventListener("abort", abortAttempt, { once: true });

      console.log(`[GEMINI_NATIVE] start model=${modelId} action=${action} conn=${safeConnection} body=${Buffer.byteLength(bodyText)}B timeout=${GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS}`);

      let upstreamResponse;
      try {
        upstreamResponse = await fetch(upstreamUrl, {
          method: "POST",
          headers: {
            "Content-Type": request.headers.get("Content-Type") || "application/json",
            ...authHeaders,
          },
          body: bodyText,
          signal: attemptController.signal,
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
        if (request.signal?.aborted && !timedOut) {
          // The client, not the deadline. Reported as a terminal answer so the loop neither
          // rotates nor locks an account for a request nobody is waiting on.
          console.log(`[GEMINI_NATIVE] client aborted model=${modelId} ms=${durationMs} conn=${safeConnection}`);
          return {
            success: true,
            response: Response.json({ error: { message: "Client closed request" } }, { status: 499 }),
          };
        }

        const status = isGeminiNativeTimeoutError(error, timedOut) ? 504 : 502;
        const errorText = getSafeGeminiNativeErrorText(error);
        console.log(`[GEMINI_NATIVE] fetch failed model=${modelId} status=${status} ms=${durationMs} conn=${safeConnection} error=${errorText}`);
        return {
          success: false,
          status,
          error: errorText,
          response: Response.json({ error: { message: errorText } }, { status }),
        };
      } finally {
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", abortAttempt);
      }

      console.log(`[GEMINI_NATIVE] upstream model=${modelId} status=${upstreamResponse.status} ms=${Date.now() - startedAt} conn=${safeConnection} ct=${upstreamResponse.headers.get("content-type") || "?"} cl=${upstreamResponse.headers.get("content-length") || "?"}`);

      if (upstreamResponse.ok) {
        await clearAccountError(credentials.connectionId, credentials, modelId);
        return {
          success: true,
          response: new Response(upstreamResponse.body, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: corsHeadersFrom(upstreamResponse),
          }),
        };
      }

      const errorText = await upstreamResponse.text();
      return {
        success: false,
        status: upstreamResponse.status,
        error: errorText,
        // FORK(smartrouting): this route reads the response itself rather than going through
        // parseUpstreamError, so it supplies the rate-limit signals directly.
        errorSignals: { headers: Object.fromEntries(upstreamResponse.headers.entries()), body: errorText },
        response: new Response(errorText, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: corsHeadersFrom(upstreamResponse),
        }),
      };
    },
    // One shape for every exhaustion reason, matching what this route answered before.
    onExhausted: ({ lastError, lastStatus, lockedError, lockedErrorCode }) => {
      const message = lastError || lockedError || "No active credentials for provider: gemini";
      const status = lastStatus || Number(lockedErrorCode) || 503;
      console.log(`[GEMINI_NATIVE] exhausted model=${modelId} status=${status} error=${message}`);
      return Response.json({ error: { message } }, { status });
    },
  });
}

/**
 * Convert Gemini request format to OpenAI/internal format.
 *
 * @param {object} geminiBody  - parsed Gemini request body
 * @param {string} model       - resolved model string (e.g. "gemini-pro-high")
 * @param {boolean} stream     - whether to stream (from URL action)
 */
function convertGeminiToInternal(geminiBody, model, stream) {
  const messages = [];

  // Convert system instruction
  if (geminiBody.systemInstruction) {
    const systemText = geminiBody.systemInstruction.parts
      ?.map(p => p.text)
      .join("\n") || "";
    if (systemText) {
      messages.push({ role: "system", content: systemText });
    }
  }

  // Convert contents to messages
  if (geminiBody.contents) {
    for (const content of geminiBody.contents) {
      const role = content.role === "model" ? "assistant" : "user";
      const text = content.parts?.map(p => p.text).join("\n") || "";
      messages.push({ role, content: text });
    }
  }

  return {
    model,
    messages,
    stream,
    max_tokens: geminiBody.generationConfig?.maxOutputTokens,
    temperature: geminiBody.generationConfig?.temperature,
    top_p: geminiBody.generationConfig?.topP,
  };
}

/** Map OpenAI finish_reason => Gemini finishReason */
const FINISH_REASON_MAP = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY",
};

/**
 * Transform an OpenAI SSE stream into a Gemini SSE stream.
 *
 * OpenAI SSE format (what handleChat returns):
 *   data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}
 *   data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
 *   data: [DONE]
 *
 * Gemini SSE format (what @google/genai SDK expects):
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]},"index":0}]}
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":""}]},"finishReason":"STOP","index":0}],"usageMetadata":{...}}
 *   (stream closes — no [DONE])
 */
function transformOpenAISSEToGeminiSSE(upstreamResponse, model) {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();

        // Drop empty lines and the OpenAI [DONE] sentinel.
        // Gemini SSE ends by stream close, no sentinel needed.
        if (!data || data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const choice = parsed.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta || {};

        const parts = [];
        if (delta.reasoning_content) {
          parts.push({ text: delta.reasoning_content, thought: true });
        }
        if (delta.content) {
          parts.push({ text: delta.content });
        }

        // Skip pure role-only deltas with no content and no finish signal
        if (parts.length === 0 && !choice.finish_reason) continue;

        const candidate = {
          content: {
            role: "model",
            parts: parts.length > 0 ? parts : [{ text: "" }],
          },
          index: 0,
        };

        if (choice.finish_reason) {
          candidate.finishReason = FINISH_REASON_MAP[choice.finish_reason] || "STOP";
        }

        const geminiChunk = { candidates: [candidate] };

        // Attach usage + modelVersion on the final chunk (when finish_reason is set)
        if (choice.finish_reason && parsed.usage) {
          geminiChunk.usageMetadata = {
            promptTokenCount: parsed.usage.prompt_tokens || 0,
            candidatesTokenCount: parsed.usage.completion_tokens || 0,
            totalTokenCount: parsed.usage.total_tokens || 0,
          };
          const reasoningTokens =
            parsed.usage.completion_tokens_details?.reasoning_tokens;
          if (reasoningTokens) {
            geminiChunk.usageMetadata.thoughtsTokenCount = reasoningTokens;
          }
          geminiChunk.modelVersion = parsed.model || model;
        }

        controller.enqueue(
          encoder.encode("data: " + JSON.stringify(geminiChunk) + "\r\n\r\n")
        );
      }
    },
    // No flush() needed: Gemini SSE ends by stream close, not a sentinel
  });

  return new Response(upstreamResponse.body.pipeThrough(transformStream), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Convert an OpenAI chat.completion JSON response into a Gemini
 * GenerateContentResponse so that Gemini CLI can parse it.
 */
async function convertOpenAIResponseToGemini(response, model) {
  if (!response.ok) return response;

  let body;
  try {
    body = await response.json();
  } catch {
    return response;
  }

  if (body.candidates) return Response.json(body, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  if (body.error) return Response.json(body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  const choice = body.choices?.[0];
  if (!choice) {
    return Response.json(body, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const { message, finish_reason } = choice;

  const parts = [];
  if (message.reasoning_content) {
    parts.push({ text: message.reasoning_content, thought: true });
  }
  parts.push({ text: message.content || "" });

  const finishReason = FINISH_REASON_MAP[finish_reason] || "STOP";

  const geminiResponse = {
    candidates: [
      {
        content: { role: "model", parts },
        finishReason,
        index: 0,
      },
    ],
    modelVersion: body.model || model,
  };

  if (body.usage) {
    geminiResponse.usageMetadata = {
      promptTokenCount: body.usage.prompt_tokens || 0,
      candidatesTokenCount: body.usage.completion_tokens || 0,
      totalTokenCount: body.usage.total_tokens || 0,
    };
    const reasoningTokens = body.usage.completion_tokens_details?.reasoning_tokens;
    if (reasoningTokens) {
      geminiResponse.usageMetadata.thoughtsTokenCount = reasoningTokens;
    }
  }

  return Response.json(geminiResponse, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
