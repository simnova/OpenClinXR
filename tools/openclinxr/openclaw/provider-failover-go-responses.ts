/**
 * Chat Completions <-> OpenCode Go /responses translation.
 *
 * MEASURED 2026-09-24 against the real endpoint (https://opencode.ai/zen/go/v1/responses,
 * model muse-spark-1.3-contributor) and recorded under __fixtures__/go-responses-*.sse:
 *   - a plain text turn: response.output_item.added (message) -> response.output_text.delta* ->
 *     response.output_item.done -> response.completed
 *   - a tool-calling turn: response.output_item.added (function_call) ->
 *     response.function_call_arguments.delta* -> response.function_call_arguments.done ->
 *     response.output_item.done -> response.completed
 *   - a follow-up turn: Go accepts {type:"function_call", call_id, name, arguments} and
 *     {type:"function_call_output", call_id, output} as INPUT items and answers the tool result.
 *   - a tiny max_output_tokens with default (high) reasoning effort spends the whole budget on
 *     reasoning and the stream ends after response.incomplete with no output at all — that is why
 *     the fixtures were captured with reasoning.effort "minimal".
 *
 * Previously (provider-failover-proxy.ts, canFailoverToGoResponses) a tool-calling or multi-turn
 * request was refused wholesale: the old translation only carried the last user message as a plain
 * string, so grok's agentic turns (system prompt + tools + history) never failed over and grok just
 * retried the dying primary. This module carries the FULL request across, and refuses only the
 * residual case it genuinely cannot represent (a content part it cannot render as text, e.g. an
 * image).
 */

// ---------------------------------------------------------------------------
// LEGACY single-turn translation (pre-2026-09-24). No longer called by forwardChat — kept only so
// the original "maps chat messages into a Go responses input" / "maps a Go responses payload back
// to chat.completion" tests (plain-string `input`, no tool_calls) keep passing unmodified.
// forwardChat now calls translateChatRequestToGoResponses / goResponsesJsonToChatCompletion below.
// ---------------------------------------------------------------------------

function lastUserText(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .map((p) => (typeof p === "string" ? p : (p as { text?: string })?.text ?? ""))
        .join("\n");
    }
  }
  return "";
}

export function chatToGoResponses(body: Record<string, unknown>, model: string): Record<string, unknown> {
  const text = lastUserText(body.messages);
  return { model, input: text || JSON.stringify(body.messages ?? "") };
}

export function goResponsesToChat(raw: unknown, model: string): Record<string, unknown> {
  const d = raw as {
    output?: Array<{ content?: Array<{ text?: string }>; text?: string }>;
    output_text?: string;
  };
  let content = "";
  if (typeof d?.output_text === "string") content = d.output_text;
  else if (Array.isArray(d?.output)) {
    content = d.output
      .flatMap((o) => o.content ?? [])
      .map((c) => c.text ?? "")
      .join("");
  }
  return {
    id: "failover-go-muse",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
  };
}

// ---------------------------------------------------------------------------
// Request translation: chat.completions body -> Go /responses payload
// ---------------------------------------------------------------------------

type ChatToolCall = { id?: string; type?: string; function?: { name?: string; arguments?: unknown } };
type ChatMessage = {
  role?: string;
  content?: unknown;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
};

function textFromContent(content: unknown): { text: string; unsupported?: string } {
  if (typeof content === "string") return { text: content };
  if (content === null || content === undefined) return { text: "" };
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (typeof p === "string") {
        parts.push(p);
        continue;
      }
      const part = p as { type?: string; text?: string };
      if ((part?.type === "text" || part?.type === "input_text") && typeof part.text === "string") {
        parts.push(part.text);
        continue;
      }
      return { text: parts.join(""), unsupported: `content part of type ${String(part?.type ?? typeof p)}` };
    }
    return { text: parts.join("") };
  }
  return { text: "", unsupported: `content of type ${typeof content}` };
}

/** Chat messages -> Go /responses `instructions` + `input` items. */
export function chatMessagesToGoInput(messages: unknown): {
  instructions?: string;
  input: Array<Record<string, unknown>>;
  unsupported?: string;
} {
  const items: Array<Record<string, unknown>> = [];
  const systemParts: string[] = [];
  if (!Array.isArray(messages)) return { input: items };
  for (const raw of messages) {
    const m = raw as ChatMessage;
    if (m?.role === "system" || m?.role === "developer") {
      const { text, unsupported } = textFromContent(m.content);
      if (unsupported) return { input: items, unsupported };
      if (text) systemParts.push(text);
      continue;
    }
    if (m?.role === "tool") {
      if (!m.tool_call_id) return { input: items, unsupported: "tool message with no tool_call_id" };
      const { text, unsupported } = textFromContent(m.content);
      if (unsupported) return { input: items, unsupported };
      items.push({ type: "function_call_output", call_id: m.tool_call_id, output: text });
      continue;
    }
    if (m?.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      for (const tc of m.tool_calls) {
        const fn = tc?.function;
        if (!tc?.id || !fn?.name) return { input: items, unsupported: "assistant tool_call missing id/name" };
        items.push({
          type: "function_call",
          call_id: tc.id,
          name: fn.name,
          arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        });
      }
      const { text, unsupported } = textFromContent(m.content);
      if (unsupported) return { input: items, unsupported };
      if (text) items.push({ type: "message", role: "assistant", content: [{ type: "input_text", text }] });
      continue;
    }
    if (m?.role === "user" || m?.role === "assistant") {
      const { text, unsupported } = textFromContent(m.content);
      if (unsupported) return { input: items, unsupported };
      items.push({ type: "message", role: m.role, content: [{ type: "input_text", text }] });
      continue;
    }
    return { input: items, unsupported: `unsupported message role ${String(m?.role)}` };
  }
  return { instructions: systemParts.length > 0 ? systemParts.join("\n\n") : undefined, input: items };
}

/** OpenAI `tools` array -> Go /responses `tools` array (flattened, no nested `function`). */
export function chatToolsToGoTools(tools: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(tools)) return undefined;
  const out: Array<Record<string, unknown>> = [];
  for (const t of tools) {
    const tool = t as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } };
    if (tool?.type !== "function" || !tool.function?.name) continue;
    out.push({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters ?? { type: "object", properties: {} },
    });
  }
  return out.length > 0 ? out : undefined;
}

export function chatToolChoiceToGo(toolChoice: unknown): unknown {
  if (typeof toolChoice === "string") return toolChoice;
  const tc = toolChoice as { type?: string; function?: { name?: string } } | undefined;
  if (tc?.type === "function" && tc.function?.name) return { type: "function", name: tc.function.name };
  return undefined;
}

export type GoTranslationResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Full chat.completions request -> Go /responses payload. Refuses only when a message carries a
 * part this translation cannot render as text (verified: text, tool_calls, and tool results all
 * translate; NOT TESTED against the real endpoint: image/audio content parts, which fall through
 * to the refusal below and are never sent).
 */
export function translateChatRequestToGoResponses(
  body: Record<string, unknown>,
  model: string,
  wantStream: boolean,
): GoTranslationResult {
  const { instructions, input, unsupported } = chatMessagesToGoInput(body.messages);
  if (unsupported) return { ok: false, reason: `cannot translate to Go /responses: ${unsupported}` };
  if (input.length === 0) return { ok: false, reason: "cannot translate to Go /responses: no representable input" };
  const payload: Record<string, unknown> = { model, input, stream: wantStream };
  if (instructions) payload.instructions = instructions;
  const tools = chatToolsToGoTools(body.tools);
  if (tools) payload.tools = tools;
  if (body.tool_choice !== undefined) {
    const mapped = chatToolChoiceToGo(body.tool_choice);
    if (mapped !== undefined) payload.tool_choice = mapped;
  }
  const maxTokens = body.max_output_tokens ?? body.max_tokens ?? body.max_completion_tokens;
  if (typeof maxTokens === "number") payload.max_output_tokens = maxTokens;
  return { ok: true, payload };
}

// ---------------------------------------------------------------------------
// Response translation: Go /responses (JSON or SSE) -> chat.completions shape
// ---------------------------------------------------------------------------

type GoOutputItem = {
  type?: string;
  content?: Array<{ text?: string }>;
  text?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
};

type GoToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

/** Non-streaming Go /responses JSON body -> one chat.completion object (with tool_calls). */
export function goResponsesJsonToChatCompletion(raw: unknown, model: string): Record<string, unknown> {
  const d = raw as {
    output?: GoOutputItem[];
    output_text?: string;
    incomplete_details?: { reason?: string };
  };
  let content = "";
  const toolCalls: GoToolCall[] = [];
  if (typeof d?.output_text === "string") content += d.output_text;
  if (Array.isArray(d?.output)) {
    for (const item of d.output) {
      if (item.type === "function_call") {
        toolCalls.push({
          id: item.call_id ?? "",
          type: "function",
          function: { name: item.name ?? "", arguments: item.arguments ?? "" },
        });
        continue;
      }
      if (Array.isArray(item.content)) content += item.content.map((c) => c.text ?? "").join("");
      else if (typeof item.text === "string") content += item.text;
    }
  }
  const finishReason =
    toolCalls.length > 0 ? "tool_calls" : d?.incomplete_details?.reason === "max_output_tokens" ? "length" : "stop";
  const message: Record<string, unknown> = { role: "assistant", content: content || null };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return {
    id: "failover-go-muse",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, finish_reason: finishReason, message }],
  };
}

export type GoSseEvent = { event?: string; data: Record<string, unknown> };

/** Splits raw SSE bytes into {event, data} pairs, skipping [DONE] and unparsable blocks. */
export function parseGoResponsesSse(text: string): GoSseEvent[] {
  const events: GoSseEvent[] = [];
  for (const block of text.split(/\n\n+/)) {
    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("event:")) eventName = trimmed.slice(6).trim();
      else if (trimmed.startsWith("data:")) dataLines.push(trimmed.slice(5).trim());
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join("\n");
    if (raw === "" || raw === "[DONE]") continue;
    try {
      events.push({ event: eventName, data: JSON.parse(raw) as Record<string, unknown> });
    } catch {
    }
  }
  return events;
}

export type GoStreamToChatResult = {
  sse: string;
  hasContent: boolean;
  hasToolCalls: boolean;
  finishReason: "stop" | "tool_calls" | "length";
};

/** Renders one chat.completion.chunk data: line. */
function chunkLine(id: string, created: number, model: string, delta: Record<string, unknown>, finishReason: string | null): string {
  return `data: ${JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/**
 * Go /responses SSE -> chat.completion.chunk SSE. Verified against __fixtures__/go-responses-
 * text.sse and go-responses-tool-call.sse: text deltas stream as response.output_text.delta;
 * a tool call opens on response.output_item.added (item.type function_call) and streams its
 * arguments via response.function_call_arguments.delta, keyed by item_id.
 */
export function goResponsesStreamToChatChunks(text: string, model: string): GoStreamToChatResult {
  const events = parseGoResponsesSse(text);
  const created = Math.floor(Date.now() / 1000);
  const id = "failover-go-stream";
  const lines: string[] = [];
  let sentRole = false;
  let hasContent = false;
  let hasToolCalls = false;
  let sawIncomplete = false;
  const toolIndexByItemId = new Map<string, number>();
  let nextToolIndex = 0;

  const emit = (delta: Record<string, unknown>, chunkFinishReason: string | null = null): void => {
    lines.push(chunkLine(id, created, model, delta, chunkFinishReason));
  };
  const ensureRole = (): void => {
    if (sentRole) return;
    sentRole = true;
    emit({ role: "assistant" });
  };

  for (const evt of events) {
    const type = (evt.data.type as string | undefined) ?? evt.event;
    if (type === "response.output_text.delta") {
      const delta = evt.data.delta;
      if (typeof delta === "string" && delta !== "") {
        ensureRole();
        hasContent = true;
        emit({ content: delta });
      }
      continue;
    }
    if (type === "response.output_item.added") {
      const item = evt.data.item as { type?: string; id?: string; call_id?: string; name?: string } | undefined;
      if (item?.type === "function_call") {
        ensureRole();
        const idx = nextToolIndex;
        nextToolIndex += 1;
        toolIndexByItemId.set(item.id ?? String(idx), idx);
        hasToolCalls = true;
        emit({
          tool_calls: [
            { index: idx, id: item.call_id ?? item.id, type: "function", function: { name: item.name ?? "", arguments: "" } },
          ],
        });
      }
      continue;
    }
    if (type === "response.function_call_arguments.delta") {
      const itemId = evt.data.item_id as string | undefined;
      const delta = evt.data.delta;
      const idx = toolIndexByItemId.get(itemId ?? "");
      if (idx !== undefined && typeof delta === "string" && delta !== "") {
        emit({ tool_calls: [{ index: idx, function: { arguments: delta } }] });
      }
      continue;
    }
    if (type === "response.incomplete" || type === "response.completed" || type === "response.failed") {
      const resp = evt.data.response as { incomplete_details?: { reason?: string } } | undefined;
      if (resp?.incomplete_details?.reason === "max_output_tokens") sawIncomplete = true;
    }
  }
  ensureRole();
  const finishReason: GoStreamToChatResult["finishReason"] = hasToolCalls ? "tool_calls" : sawIncomplete ? "length" : "stop";
  emit({}, finishReason);
  lines.push("data: [DONE]\n\n");
  return { sse: lines.join(""), hasContent, hasToolCalls, finishReason };
}

/** Renders a chat.completion message (content and/or tool_calls) as chat.completion.chunk SSE. */
export function sseFromChatMessage(
  message: { content?: unknown; tool_calls?: GoToolCall[] },
  model: string,
): string {
  const created = Math.floor(Date.now() / 1000);
  const id = "failover-stream";
  const lines: string[] = [chunkLine(id, created, model, { role: "assistant" }, null)];
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    message.tool_calls.forEach((tc, i) => {
      lines.push(chunkLine(id, created, model, { tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.function.name, arguments: "" } }] }, null));
      lines.push(chunkLine(id, created, model, { tool_calls: [{ index: i, function: { arguments: tc.function.arguments } }] }, null));
    });
    lines.push(chunkLine(id, created, model, {}, "tool_calls"));
  } else {
    if (typeof message.content === "string" && message.content !== "") {
      lines.push(chunkLine(id, created, model, { content: message.content }, null));
    }
    lines.push(chunkLine(id, created, model, {}, "stop"));
  }
  lines.push("data: [DONE]\n\n");
  return lines.join("");
}
