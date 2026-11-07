/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  measureToolOutput,
  type ToolOutputBudgetSource,
} from './tool-output-size.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { Part, PartListUnion } from '@google/genai';
import { ReadFileTool } from './read-file.js';
import type { Config } from '../config/config.js';
import { atomicWriteFile } from '../utils/atomicFileWrite.js';
import { createDebugLogger } from '../utils/debugLogger.js';
import {
  logToolOutputTruncated,
  logToolResultSize,
  logToolResultPersisted,
} from '../telemetry/loggers.js';
import {
  ToolOutputTruncatedEvent,
  ToolResultSizeEvent,
  ToolResultPersistedEvent,
} from '../telemetry/types.js';

const debugLogger = createDebugLogger('TRUNCATION');

export const PREVIEW_SIZE_CHARS = 2000;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_SESSION_BYTES = 500 * 1024 * 1024; // 500MB

/**
 * Label of the line `buildStub` embeds carrying a sha256 of the FULL
 * pre-truncation output. The preview only covers the first
 * PREVIEW_SIZE_CHARS chars and the envelope embeds a per-call unique file
 * path, so consumers that fingerprint results (the loop guards in
 * services/loopDetectionService.ts) read this digest instead of hashing the
 * envelope: a board mutating beyond the preview window still fingerprints
 * differently each poll, and a frozen board identically no matter where it
 * was persisted (issue #9450).
 */
export const FULL_OUTPUT_DIGEST_LABEL = 'Full output sha256: ';

/**
 * Stable prefix every truncated tool output starts with. Used as an
 * idempotency sentinel so content that was already truncated (by a tool's own
 * path — e.g. MCP `truncateTextParts` — or by a prior pass) is not truncated
 * again, which would nest headers and spill a duplicate file.
 */
export const TOOL_OUTPUT_TRUNCATED_PREFIX =
  'Tool output was too large and has been truncated';

/**
 * Tolerance factor applied by the scheduler's combined (second) pass:
 * metadata appended after truncation is only re-bounded above 2x the
 * applicable budget, so compliant retained content can legitimately
 * measure up to twice its tool's budget. Shared with the retention
 * diagnostics so both use the same tolerance.
 */
export const COMBINED_PASS_TOLERANCE_FACTOR = 2;

/**
 * Slack added to the oversized check to account for the token-aware
 * fallback in `truncateAndSaveToFile`: when the wrapped (prefix + truncated)
 * form is not smaller than the original, the original is returned sentinel-less.
 * The retained original can sit up to ~prefix-length above the budget before
 * the fallback kicks in, so the diagnostics comparison must tolerate that band.
 */
export const TRUNCATION_FALLBACK_ENVELOPE_SLACK = 500;

/**
 * 诊断行匹配模式：识别测试失败、断言错误、编译器错误以及异常栈追踪。
 * 当工具输出被截断时，这些诊断信息最为关键，如果被截断在中间会导致代理盲目试错或额外消耗轮次读取文件。
 */
export const DIAGNOSTIC_PATTERNS: RegExp[] = [
  /^\s*(?:FAIL|✕|✗|ERROR|FATAL)\b/i,
  /\bAssertionError\b/,
  /\bExpected:|\bReceived:/,
  /\berror\s+TS\d+:/i,
  /Traceback \(most recent call last\):/,
  /--- FAIL:/,
  /\bpanicked at\b/,
];

/**
 * 从被截断的中间行切片中提取关键诊断错误行（如失败的测试用例、断言信息及报错行）。
 * 保证模型在工具输出截断时仍能第一时间直接感知确切的失败根因，无需发起后续读取请求。
 */
export function extractDiagnosticLines(
  lines: string[],
  startIndex: number,
  endIndex: number,
  maxLines = 10,
): Array<{ lineIndex: number; text: string }> {
  const matches: Array<{ lineIndex: number; text: string }> = [];
  const start = Math.max(0, startIndex);
  const end = Math.min(lines.length, endIndex);
  for (let i = start; i < end && matches.length < maxLines; i++) {
    const line = lines[i]!;
    if (DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(line))) {
      matches.push({ lineIndex: i + 1, text: line });
      // 提取错误行紧随的上下文行（如堆栈提示或断言对比）
      let extra = 1;
      while (
        i + extra < end &&
        extra <= 2 &&
        matches.length < maxLines &&
        (lines[i + extra]!.trimStart().startsWith('at ') ||
          lines[i + extra]!.includes('Expected:') ||
          lines[i + extra]!.includes('Received:') ||
          lines[i + extra]!.trimStart().startsWith('> '))
      ) {
        matches.push({ lineIndex: i + extra + 1, text: lines[i + extra]! });
        extra++;
      }
      i += extra - 1;
    }
  }
  return matches;
}

/**
 * Truncates large tool output and saves the full content to a temp file.
 * Used by the shell tool to prevent excessively large outputs from being
 * sent to the LLM context.
 *
 * If content length is within the threshold, returns it unchanged.
 * Otherwise, saves full content to a file and returns a truncated version
 * with head/tail lines and a pointer to the saved file.
 */
export async function truncateAndSaveToFile(
  content: string,
  fileName: string,
  projectTempDir: string,
  threshold: number,
  truncateLines: number,
  keep: 'head' | 'tail' | 'both' = 'both',
  previewChars = threshold,
  exclusive = false,
  persistenceConfig?: Pick<
    Config,
    'getToolResultBytesWritten' | 'trackToolResultBytes'
  >,
): Promise<{ content: string; outputFile?: string }> {
  // Fast path: when no line cap applies (per-tool char budgets pass
  // truncateLines = Infinity) and content is within the char threshold, return
  // early without splitting. read-file (Infinity threshold) and other
  // self-managed tools otherwise allocate a full line array on every call only
  // to reach a guaranteed no-op.
  if (content.length <= threshold && !Number.isFinite(truncateLines)) {
    return { content };
  }

  const lines = content.split('\n');

  // Check both constraints: character threshold and line limit.
  if (content.length <= threshold && lines.length <= truncateLines) {
    return { content };
  }

  // Build head and tail within both line and character budgets. The `keep`
  // direction decides how the line/character budget is split:
  //   - 'both' (default): head 1/5 + tail 4/5 (preserves first & last).
  //   - 'head': all budget to the beginning (mirrors CC's Bash tool).
  //   - 'tail': all budget to the end (mirrors CC's Task tool).
  const effectiveLines = Math.min(truncateLines, lines.length);
  let headCount: number;
  let tailCount: number;
  if (keep === 'head') {
    headCount = effectiveLines;
    tailCount = 0;
  } else if (keep === 'tail') {
    headCount = 0;
    tailCount = effectiveLines;
  } else {
    headCount = Math.max(Math.floor(effectiveLines / 5), 1);
    tailCount = effectiveLines - headCount;
  }
  const defaultSeparator = '\n\n---\n... [CONTENT TRUNCATED] ...\n---\n\n';
  let diagnosticBlock = '';
  if (keep === 'both' && lines.length > effectiveLines) {
    const omittedStart = headCount;
    const omittedEnd = Math.max(omittedStart, lines.length - tailCount);
    const diagnostics = extractDiagnosticLines(
      lines,
      omittedStart,
      omittedEnd,
      10,
    );
    if (diagnostics.length > 0) {
      diagnosticBlock =
        '\n\n[Key Diagnostic Excerpts from Truncated Output]:\n' +
        diagnostics.map((d) => `  (Line ${d.lineIndex}): ${d.text}`).join('\n');
    }
  }
  const candidateSeparator = diagnosticBlock
    ? `\n\n---\n... [CONTENT TRUNCATED] ...${diagnosticBlock}\n---\n\n`
    : defaultSeparator;
  const previewBudget = Math.max(0, previewChars);
  // 当诊断摘录过大导致剩余展示预算不足1/3时，回退到默认紧凑分隔符以保证首尾关键行展示
  const separator =
    diagnosticBlock &&
    previewBudget - candidateSeparator.length < Math.floor(previewBudget / 3)
      ? defaultSeparator
      : candidateSeparator;
  const ellipsis = '...';

  // Collect head lines within budget. If a single line exceeds the
  // remaining budget, include a truncated slice of it.

  // The separator sits between (or beside) the head and tail, so it has to
  // come out of the budget rather than be added on top of it. It was emitted
  // unconditionally while the head budget ignored it entirely, so a small
  // previewChars came back over budget every time: 0 produced 39 characters,
  // 10 produced 42, 40 produced 47. Below the separator's own length there is
  // no room to say anything and still show content -- and the wrapper message
  // above already states the output was truncated -- so drop it there.
  const sep = previewBudget > separator.length ? separator : '';
  const contentBudget = previewBudget - sep.length;
  const headBudget =
    keep === 'head'
      ? contentBudget
      : keep === 'tail'
        ? 0
        : Math.floor(contentBudget / 5);
  const beginning: string[] = [];
  let headChars = 0;
  for (let i = 0; i < Math.min(headCount, lines.length); i++) {
    const remaining = headBudget - headChars;
    if (remaining <= 0) break;
    if (lines[i].length + 1 > remaining) {
      // The ellipsis has to fit inside `remaining` too. Emitting it when
      // fewer than three characters were left put the preview over budget by
      // the difference, on top of the separator overrun above.
      if (remaining >= ellipsis.length) {
        const sliceLen = remaining - ellipsis.length;
        beginning.push(lines[i].slice(0, sliceLen) + ellipsis);
      }
      headChars = headBudget;
      break;
    }
    beginning.push(lines[i]);
    headChars += lines[i].length + 1; // +1 for newline
  }

  // Collect tail lines within remaining budget. If a single line exceeds
  // the remaining budget, include a truncated slice of it.
  const tailBudget =
    keep === 'head' ? 0 : Math.max(contentBudget - headChars, 0);
  const end: string[] = [];
  let tailChars = 0;
  const tailStart = Math.max(lines.length - tailCount, beginning.length);
  for (let i = lines.length - 1; i >= tailStart; i--) {
    const remaining = tailBudget - tailChars;
    if (remaining <= 0) break;
    if (lines[i].length + 1 > remaining) {
      // As above: below the ellipsis's own length there is no room to mark the
      // cut without overshooting, so mark nothing.
      if (remaining >= ellipsis.length) {
        const sliceLen = remaining - ellipsis.length;
        // slice(-0) === slice(0) returns the WHOLE line, so guard the zero
        // case explicitly: sliceLen === 0 means no budget for any tail chars
        // (the head branch's slice(0, 0) already yields '' correctly).
        end.unshift(ellipsis + (sliceLen > 0 ? lines[i].slice(-sliceLen) : ''));
      }
      tailChars = tailBudget;
      break;
    }
    end.unshift(lines[i]);
    tailChars += lines[i].length + 1;
  }

  // Compose by direction: head-only ends with the separator (content
  // removed after), tail-only starts with it (content removed before),
  // both keeps the existing head+separator+tail shape.
  const truncatedContent =
    keep === 'head'
      ? beginning.join('\n') + sep
      : keep === 'tail'
        ? sep + end.join('\n')
        : beginning.join('\n') + sep + end.join('\n');

  // Sanitize fileName to prevent path traversal.
  const safeFileName = `${path.basename(fileName)}.output`;
  const outputFile = path.join(projectTempDir, safeFileName);
  // A structured sample is deliberately compact (8 keys / 2 rows per level),
  // so it can never fill a preview budget above PREVIEW_SIZE_CHARS. Emitting
  // it anyway would shrink web_fetch's internal ~98k preview and shell's 4k preview to
  // ~2k, silently discarding the content the caller budgeted for. Keep the
  // caller's budget authoritative: sample only inside the sample's own size
  // class, otherwise keep the head/tail preview.
  // The sample always walks the beginning of the payload, so a caller asking
  // for `keep: 'tail'` would get content it explicitly did not request; fall
  // back to the directional preview instead. No production caller does both
  // today, but the contract should not depend on that.
  const jsonPreview =
    previewChars <= PREVIEW_SIZE_CHARS && keep !== 'tail'
      ? structuredPreview(content, previewChars)
      : undefined;
  const recoveryHint =
    lines.length === 1
      ? `Page in with ${ReadFileTool.Name} using the absolute file_path above, offset (zero-based line) and limit (line count). This is a single-line payload: line offsets cannot reach its middle; use a byte-range shell read or parse/query the saved JSON file.`
      : `Page in with ${ReadFileTool.Name} using the absolute file_path above, offset (zero-based line) and limit (line count).`;
  // Below the separator's own length `sep` is dropped, so no marker is emitted;
  // the description must not claim one it did not write.
  const removalNote = sep
    ? " The marker '... [CONTENT TRUNCATED] ...' indicates where content was removed."
    : '';
  const truncationDescription = `The truncated output below shows ${keep === 'head' ? 'the beginning' : keep === 'tail' ? 'the end' : 'the beginning and end'} of the content.${removalNote}`;
  const previewDescription = jsonPreview
    ? 'The output below is a structured JSON sample; omitted values remain in the full output file.'
    : truncationDescription;
  // sha256 of the FULL pre-truncation output (see FULL_OUTPUT_DIGEST_LABEL):
  // loop detection fingerprints a bounded result by this digest, so a body
  // that skips persistence must embed it too rather than finger-printing by
  // its unique per-call envelope.
  const fullOutputDigest = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex');
  // One envelope shape for every bounded body: the sentinel must LEAD it,
  // because downstream guards recognize an already-truncated result by
  // `startsWith(TOOL_OUTPUT_TRUNCATED_PREFIX)` (truncateLlmContent,
  // tool-result-retention, loopDetectionService). Only the header, the
  // recovery hint and the preview description differ between a saved spill
  // and one skipped for disk budget — a skipped body must not claim a file.
  const envelope = (
    header: string,
    parts: { hint?: string; description: string; preview: string },
  ) => `${TOOL_OUTPUT_TRUNCATED_PREFIX}.
${header}
Total characters: ${content.length}; total lines: ${lines.length}.
${FULL_OUTPUT_DIGEST_LABEL}${fullOutputDigest}
${parts.hint ? `${parts.hint}\n` : ''}${parts.description}

Truncated part of the output:
${parts.preview}`;
  const wrappedMessage = envelope(
    `The full output has been saved to: ${outputFile}`,
    {
      hint: recoveryHint,
      description: previewDescription,
      preview: jsonPreview ?? truncatedContent,
    },
  );

  // Token-aware fallback: if the wrapped (truncated + instructions) output is
  // not actually smaller than the original, truncating wastes effort and
  // loses recoverability for no benefit — keep the original untouched.
  if (wrappedMessage.length >= content.length) {
    return { content };
  }

  const byteSize = Buffer.byteLength(content, 'utf-8');
  // Two different reasons can skip the spill. `persistToolResult` keeps them
  // apart (`file too large to persist` vs `session disk budget exhausted`), and
  // this path must too: a body skipped for its own size is not a session that
  // ran out of room, and saying so sends the reader after the wrong cause.
  const sessionBytesWritten =
    persistenceConfig?.getToolResultBytesWritten?.() ?? 0;
  const skipReason =
    byteSize > MAX_FILE_SIZE_BYTES
      ? `file exceeds the ${MAX_FILE_SIZE_BYTES} byte persistence limit`
      : 'session disk budget exhausted';
  if (
    persistenceConfig &&
    (byteSize > MAX_FILE_SIZE_BYTES ||
      sessionBytesWritten + byteSize > MAX_SESSION_BYTES)
  )
    return {
      content: envelope(
        `[Note: Full output could not be saved: ${skipReason}]`,
        {
          description: truncationDescription,
          preview: truncatedContent,
        },
      ),
    };
  persistenceConfig?.trackToolResultBytes?.(byteSize);

  try {
    // Restrictive perms: tool output can contain secrets, and this PR widens
    // persistence to every string-returning tool. The spilled file is created
    // owner-only (0o600). We don't set a mode on the temp dir: it is shared
    // with the logger/checkpoints and is normally created earlier without one,
    // and mkdir would not tighten an already-existing directory anyway.
    await fs.mkdir(projectTempDir, { recursive: true });
    await fs.writeFile(outputFile, content, {
      mode: 0o600,
      ...(exclusive ? { flag: 'wx' } : {}),
    });

    return {
      content: wrappedMessage,
      outputFile,
    };
  } catch (error) {
    persistenceConfig?.trackToolResultBytes?.(-byteSize);
    debugLogger.warn(
      `Failed to save truncated output to ${outputFile}:`,
      error,
    );
    // Same envelope as every other bounded body: a write failure must not be
    // the one return that skips the leading sentinel, or the guards that
    // recognize an already-truncated result by `startsWith` re-truncate it.
    return {
      content: envelope('[Note: Could not save full output to file]', {
        description: truncationDescription,
        preview: truncatedContent,
      }),
    };
  }
}

/**
 * High-level truncation helper that reads thresholds from Config,
 * truncates if needed, saves full output to a temp file, and logs
 * telemetry. Returns the (possibly truncated) content and an optional
 * output file path.
 *
 * Callers no longer need to duplicate config extraction, file naming,
 * or telemetry logging.
 */
export async function truncateToolOutput(
  config: Config,
  toolName: string,
  content: string,
  limits?: {
    threshold?: number;
    lines?: number;
    keep?: 'head' | 'tail' | 'both';
    previewChars?: number;
    layer?: 'producer' | 'per_tool' | 'combined';
    source?: ToolOutputBudgetSource;
  },
  promptId?: string,
  callId?: string,
): Promise<{ content: string; outputFile?: string }> {
  // Per-call `limits` override the global config thresholds. Used for
  // per-tool budgets (maxOutputChars) and the combined second-pass that runs
  // a 2x budget after hook/reminder metadata is appended.
  const threshold =
    limits?.threshold ?? config.getTruncateToolOutputThreshold();
  const lines = limits?.lines ?? config.getTruncateToolOutputLines();
  const keep = limits?.keep ?? 'both';
  const previewChars = limits?.previewChars ?? threshold;

  if (threshold <= 0 || lines <= 0) {
    return { content };
  }

  // Fast path: when no line cap applies (char-only budgets pass lines:Infinity)
  // and content is within the char threshold, there is nothing to spill —
  // return before resolving the temp dir, so callers that never truncate (e.g.
  // small MCP outputs) don't require storage to be configured.
  if (content.length <= threshold && !Number.isFinite(lines)) {
    return { content };
  }

  const originalLength = content.length;
  const fileName = `${toolName}_${crypto.randomBytes(6).toString('hex')}`;
  const outputDirectory = config.getExecutionEnvironment?.()?.outputDirectory;
  const result = await truncateAndSaveToFile(
    content,
    fileName,
    outputDirectory ?? config.storage.getProjectTempDir(),
    threshold,
    lines,
    keep,
    previewChars,
    outputDirectory !== undefined,
    config,
  );

  try {
    // Measurement is part of the observation: an estimator throw must not
    // fail the truncation pass it only observes.
    const inputSize = measureToolOutput(content, config);
    const outputSize = measureToolOutput(result.content, config);
    logToolResultSize(
      config,
      new ToolResultSizeEvent(
        toolName,
        toolName.startsWith('mcp__') ? 'mcp' : 'native',
        limits?.layer ?? 'per_tool',
        inputSize.chars,
        outputSize.chars,
        inputSize.estimatedTokens,
        outputSize.estimatedTokens,
        result.content !== content,
        Number.isFinite(threshold) ? threshold : undefined,
        limits?.source ??
          (limits?.threshold !== undefined
            ? 'per_tool'
            : config.isTruncateToolOutputThresholdExplicit?.()
              ? 'explicit'
              : 'global'),
        callId,
        promptId,
      ),
    );
  } catch {
    /* Telemetry is observational. */
  }
  if (result.outputFile) {
    try {
      logToolOutputTruncated(
        config,
        new ToolOutputTruncatedEvent(promptId ?? '', {
          toolName,
          originalContentLength: originalLength,
          truncatedContentLength: result.content.length,
          threshold,
          lines,
        }),
      );
    } catch {
      // Telemetry must never break a successful truncation.
    }
  }

  return result;
}

/**
 * Unified truncation entry for the tool scheduler. Handles both string and
 * Part[] `llmContent`:
 *   - string is truncated directly;
 *   - Part[] has its text parts merged and truncated, while media parts
 *     (inlineData/fileData) are preserved verbatim;
 *   - empty output is replaced with a no-output marker;
 *   - already-truncated content passes through unchanged (idempotent).
 */
export async function truncateLlmContent(
  config: Config,
  toolName: string,
  content: PartListUnion,
  limits?: {
    threshold?: number;
    lines?: number;
    keep?: 'head' | 'tail' | 'both';
  },
  promptId?: string,
  callId?: string,
): Promise<{ content: PartListUnion; outputFile?: string }> {
  // --- string path ---
  if (typeof content === 'string') {
    if (content.trim() === '') {
      return { content: `(${toolName} completed with no output)` };
    }
    // Idempotency: a genuine truncation prefix sits at position 0. Use
    // startsWith (not includes) so a tool whose own output merely contains the
    // phrase mid-stream is still bounded rather than passing through unbounded.
    if (content.startsWith(TOOL_OUTPUT_TRUNCATED_PREFIX)) {
      return { content };
    }
    return truncateToolOutput(
      config,
      toolName,
      content,
      limits,
      promptId,
      callId,
    );
  }

  // --- Part[] / single Part path ---
  const parts: Part[] = (Array.isArray(content) ? content : [content]).map(
    (p) => (typeof p === 'string' ? ({ text: p } as Part) : p),
  );
  const textParts = parts.filter((p) => p.text !== undefined);
  const mediaParts = parts.filter((p) => p.text === undefined);
  const combined = textParts.map((p) => p.text).join('\n');

  if (combined.trim() === '' && mediaParts.length === 0) {
    return { content: `(${toolName} completed with no output)` };
  }
  // Idempotency, mirroring the string path: a part counts as already-truncated
  // only if it STARTS with the sentinel (MCP's truncateTextParts emits such a
  // part). Checking each part's prefix — not `combined.includes` — preserves
  // the multi-part dedup intent while preventing a part that merely contains
  // the phrase mid-stream from bypassing the budget.
  if (textParts.some((p) => p.text?.startsWith(TOOL_OUTPUT_TRUNCATED_PREFIX))) {
    return { content };
  }

  const result = await truncateToolOutput(
    config,
    toolName,
    combined,
    limits,
    promptId,
    callId,
  );

  // Unchanged (within budget or token-aware fallback): leave the original
  // Part[] untouched so part structure and ordering are preserved. Compare
  // content identity rather than `outputFile` so a truncated-but-unsaved
  // result (a disk-write failure returns a bounded preview with no file) still
  // bounds the output, matching the string path.
  if (result.content === combined) {
    return { content };
  }

  // Truncated: collapse text into a single truncated part, then re-append the
  // preserved media parts.
  return {
    content: [{ text: result.content } as Part, ...mediaParts],
    outputFile: result.outputFile,
  };
}

export function isAlreadyTruncated(content: string): boolean {
  return (
    content.includes('... [CONTENT TRUNCATED] ...') ||
    content.startsWith('<persisted-output>') ||
    // A JSON-sample envelope leads with this sentinel and carries no
    // `[CONTENT TRUNCATED]` marker. startsWith, not includes: see above.
    content.startsWith(TOOL_OUTPUT_TRUNCATED_PREFIX)
  );
}

/**
 * 为超长输出构建包含首尾与关键错误诊断的结构化日志预览。
 * 当内容超过 PREVIEW_SIZE_CHARS 且包含多行时：
 * 1. 保留头部输出（展示初始上下文）；
 * 2. 从中间截断部分中提取关键诊断行（使用 extractDiagnosticLines 捕获如 FAIL、Error 等）；
 * 3. 保留尾部输出（展示执行退出信息或汇总）；
 * 使得模型无需调用 read_file 重新载入全量暂存文件，即可直接在 persisted-output 预览中获知失败原因与行号。
 */
function generateStructuredLogPreview(
  content: string,
  maxChars = PREVIEW_SIZE_CHARS,
): string {
  if (content.length <= maxChars) {
    return content;
  }

  const lines = content.split('\n');
  if (lines.length < 8) {
    const slice = content.slice(0, maxChars);
    const lastNewline = slice.lastIndexOf('\n');
    return (lastNewline > 0 ? slice.slice(0, lastNewline) : slice) + '\n...';
  }

  // 截取前部与尾部候选行数
  const headLineCount = Math.min(Math.max(2, Math.floor(lines.length / 20)), 5);
  const tailLineCount = Math.min(Math.max(3, Math.floor(lines.length / 15)), 8);

  const headLines = lines.slice(0, headLineCount);
  const tailLines = lines.slice(
    Math.max(lines.length - tailLineCount, headLineCount),
  );

  // 从省略区域中提取诊断信息
  const omittedStart = headLineCount;
  const omittedEnd = Math.max(omittedStart, lines.length - tailLineCount);
  const diagnostics = extractDiagnosticLines(
    lines,
    omittedStart,
    omittedEnd,
    6,
  );

  let middleBlock = '\n... [CONTENT TRUNCATED] ...\n';
  if (diagnostics.length > 0) {
    middleBlock =
      '\n... [CONTENT TRUNCATED] ...\n[Key Diagnostic Excerpts]:\n' +
      diagnostics.map((d) => `  (Line ${d.lineIndex}): ${d.text}`).join('\n') +
      '\n... [CONTENT TRUNCATED] ...\n';
  }

  const candidate = `${headLines.join('\n')}${middleBlock}${tailLines.join('\n')}`;
  if (candidate.length <= maxChars) {
    return candidate;
  }

  // 若候选组合超出预算，优先保留关键诊断摘录，缩减前部与尾部非诊断上下文行
  if (diagnostics.length > 0) {
    const diagnosticSection =
      '\n... [CONTENT TRUNCATED] ...\n[Key Diagnostic Excerpts]:\n' +
      diagnostics
        .slice(0, 4)
        .map(
          (d) =>
            `  (Line ${d.lineIndex}): ${
              d.text.length > 180 ? d.text.slice(0, 177) + '...' : d.text
            }`,
        )
        .join('\n') +
      '\n... [CONTENT TRUNCATED] ...\n';

    const remainingBudget = maxChars - diagnosticSection.length;
    if (remainingBudget > 80) {
      const compactHead = headLines.slice(0, 2).join('\n');
      const compactTail = tailLines.slice(-2).join('\n');
      const halfRemaining = Math.floor(remainingBudget / 2);
      const headBudget = Math.min(compactHead.length, halfRemaining);
      const tailBudget = Math.min(
        compactTail.length,
        remainingBudget - headBudget,
      );

      const tunedHead =
        compactHead.length > headBudget
          ? compactHead.slice(0, Math.max(0, headBudget - 4)) + '\n...'
          : compactHead;
      const tunedTail =
        compactTail.length > tailBudget
          ? '...\n' + compactTail.slice(-Math.max(0, tailBudget - 4))
          : compactTail;

      const compactCandidate = `${tunedHead}${diagnosticSection}${tunedTail}`;
      if (compactCandidate.length <= maxChars) {
        return compactCandidate;
      }
    }
  }

  // 若仅诊断块本身就超出限制或无诊断行，回退到平坦截断
  const slice = content.slice(0, maxChars);
  const lastNewline = slice.lastIndexOf('\n');
  return (lastNewline > 0 ? slice.slice(0, lastNewline) : slice) + '\n...';
}

function generatePreview(content: string): string {
  let text = generateStructuredLogPreview(content, PREVIEW_SIZE_CHARS);
  // Escape tags that could reshape the model-visible structure
  text = text
    .replace(/<\/?persisted-output>/g, (m) => `&lt;${m.slice(1, -1)}&gt;`)
    .replace(/<\/?system-reminder>/g, (m) => `&lt;${m.slice(1, -1)}&gt;`);
  return text;
}

function structuredPreview(
  content: string,
  maxChars = PREVIEW_SIZE_CHARS,
): string | undefined {
  if (content.length > 1_000_000 || !/^[\s]*[[{]/.test(content))
    return undefined;
  try {
    const value: unknown = JSON.parse(content);
    const sample = (item: unknown, depth: number): unknown => {
      if (typeof item === 'number') {
        // JSON.parse has already rounded an integer the wire carried verbatim,
        // and JSON.stringify renders a non-finite value as `null`. Showing
        // either as if it were the payload's value sends the model after an id
        // that never existed; name the loss instead.
        if (!Number.isFinite(item)) {
          return '<non-finite number - read the full output file>';
        }
        if (Number.isInteger(item) && !Number.isSafeInteger(item)) {
          return '<integer beyond safe precision - read the full output file>';
        }
        return item;
      }
      if (typeof item === 'string')
        return item.length > 120 ? `${item.slice(0, 120)}…` : item;
      if (Array.isArray(item))
        return {
          rows: item.length,
          sample:
            depth > 0
              ? item.slice(0, 2).map((row) => sample(row, depth - 1))
              : [],
        };
      if (item && typeof item === 'object') {
        const entries = Object.entries(item);
        if (depth > 0) {
          const shown = entries.slice(0, 8);
          return {
            keyCount: entries.length,
            sample: Object.fromEntries(
              shown.map(([key, field]) => [key, sample(field, depth - 1)]),
            ),
          };
        }
        return {
          keys: entries.slice(0, 8).map(([key]) => key),
          keyCount: entries.length,
        };
      }
      return item;
    };
    const preview =
      `Structured sample:\n${JSON.stringify(sample(value, 3), null, 2)}`.replace(
        /<\/?(?:persisted-output|system-reminder)>/g,
        (tag) => `&lt;${tag.slice(1, -1)}&gt;`,
      );
    return preview.length <= maxChars ? preview : undefined;
  } catch {
    return undefined;
  }
}

export interface PersistResult {
  content: string;
  outputFile?: string;
  bytesWritten: number;
}

export function normalizeToolResultCallId(callId: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const safeCallId = path.basename(callId).replace(/\x00/g, '_');
  return !safeCallId || safeCallId === '.' || safeCallId === '..'
    ? undefined
    : safeCallId;
}

export async function persistAndTruncateToolResult(
  callId: string,
  toolName: string,
  content: string,
  config: Config,
  promptId?: string,
): Promise<PersistResult> {
  const result = await persistToolResult(callId, toolName, content, config);
  try {
    if (result.outputFile)
      logToolResultPersisted(
        config,
        new ToolResultPersistedEvent(promptId ?? '', {
          toolName,
          bytesWritten: result.bytesWritten,
          outputFile: result.outputFile ?? '',
        }),
      );
  } catch {
    /* Telemetry is observational. */
  }
  return result;
}

async function persistToolResult(
  callId: string,
  toolName: string,
  content: string,
  config: Config,
): Promise<PersistResult> {
  const byteSize = Buffer.byteLength(content, 'utf-8');

  // Hard size cap — content already in memory, just skip disk persistence
  if (byteSize > MAX_FILE_SIZE_BYTES) {
    debugLogger.warn(
      `Tool result for ${toolName} exceeds ${MAX_FILE_SIZE_BYTES} bytes (${byteSize}), skipping disk persistence`,
    );
    return {
      content: buildStub(content, byteSize, '(file too large to persist)'),
      bytesWritten: 0,
    };
  }

  // Session budget check — reserve bytes synchronously before async I/O
  // to prevent parallel tool calls from all passing the check simultaneously.
  const budgetUsed = config.getToolResultBytesWritten();
  if (budgetUsed + byteSize > MAX_SESSION_BYTES) {
    debugLogger.warn(
      `Session tool result budget exhausted (${budgetUsed} + ${byteSize} > ${MAX_SESSION_BYTES}), skipping disk persistence`,
    );
    return {
      content: buildStub(content, byteSize, '(session disk budget exhausted)'),
      bytesWritten: 0,
    };
  }
  // Reserve budget before async write; rollback on failure below.
  config.trackToolResultBytes(byteSize);

  const safeCallId = normalizeToolResultCallId(callId);
  if (!safeCallId) {
    debugLogger.warn(
      `Invalid callId for disk persistence: ${JSON.stringify(callId)}`,
    );
    config.trackToolResultBytes(-byteSize);
    return {
      content: buildStub(content, byteSize, '(invalid callId)'),
      bytesWritten: 0,
    };
  }
  const outputDirectory = config.getExecutionEnvironment?.()?.outputDirectory;
  try {
    const toolResultsDir =
      outputDirectory ?? config.storage.getToolResultsDir();
    const outputFile = path.join(toolResultsDir, `${safeCallId}.txt`);
    await fs.mkdir(toolResultsDir, { recursive: true });
    if (outputDirectory !== undefined) {
      // The worker can replace shared entries; never chmod or reopen them by path.
      await fs.writeFile(outputFile, content, { mode: 0o600, flag: 'wx' });
    } else {
      await atomicWriteFile(outputFile, content, {
        mode: 0o600,
        forceMode: true,
        noFollow: true,
        flush: false,
      });
    }

    return {
      content: buildStub(content, byteSize, outputFile),
      outputFile,
      bytesWritten: byteSize,
    };
  } catch (error) {
    debugLogger.warn('Failed to persist tool result:', error);
    try {
      const fallback = await truncateAndSaveToFile(
        content,
        `${toolName}_${crypto.randomBytes(6).toString('hex')}`,
        outputDirectory ?? config.storage.getProjectTempDir(),
        config.getTruncateToolOutputThreshold(),
        config.getTruncateToolOutputLines(),
        'both',
        undefined,
        outputDirectory !== undefined,
      );
      if (fallback.outputFile) {
        return {
          content: fallback.content,
          outputFile: fallback.outputFile,
          bytesWritten: byteSize,
        };
      }
      config.trackToolResultBytes(-byteSize);
      return { content: fallback.content, bytesWritten: 0 };
    } catch (fallbackError) {
      config.trackToolResultBytes(-byteSize);
      debugLogger.warn('Fallback truncation also failed:', fallbackError);
      return {
        content: buildStub(content, byteSize, '(disk persistence unavailable)'),
        bytesWritten: 0,
      };
    }
  }
}

/**
 * Count lines without materialising a line array. `buildStub` runs on exactly
 * the payloads too large to persist, where splitting would allocate one string
 * per line on the path that exists to avoid that cost.
 */
function countLines(content: string): number {
  let count = 1;
  for (
    let index = content.indexOf('\n');
    index !== -1;
    index = content.indexOf('\n', index + 1)
  ) {
    count++;
  }
  return count;
}

function buildStub(
  content: string,
  byteSize: number,
  filePathOrNote: string,
): string {
  const sizeKb = Math.round(byteSize / 1024);
  const isFilePath = path.isAbsolute(filePathOrNote);
  const preview =
    (isFilePath ? structuredPreview(content) : undefined) ??
    generatePreview(content);
  // sha256 of the FULL pre-truncation output (see FULL_OUTPUT_DIGEST_LABEL):
  // the envelope's per-call unique path would otherwise fingerprint uniquely
  // every poll, silently disabling every result-aware loop guard for exactly
  // the largest results (issue #9450).
  const fullDigest = crypto.createHash('sha256').update(content).digest('hex');

  if (isFilePath) {
    return `<persisted-output>
Output too large (${sizeKb} KB). Full output saved to: ${filePathOrNote}
${FULL_OUTPUT_DIGEST_LABEL}${fullDigest}
Total characters: ${content.length}; total lines: ${countLines(content)}.
Note: this file may be cleaned up after 24 hours.
${content.includes('\n') ? `Page in with ${ReadFileTool.Name} using the absolute file_path above, offset (zero-based line) and limit (line count).` : `Page in with ${ReadFileTool.Name} using the absolute file_path above, offset (zero-based line) and limit (line count). This is a single-line payload: line offsets cannot reach its middle; use a byte-range shell read or parse/query the saved JSON file.`}

Preview (up to ${PREVIEW_SIZE_CHARS} chars):
${preview}
</persisted-output>`;
  }

  return `Output too large (${sizeKb} KB). ${filePathOrNote}
${FULL_OUTPUT_DIGEST_LABEL}${fullDigest}
Total characters: ${content.length}; total lines: ${countLines(content)}.

Preview (up to ${PREVIEW_SIZE_CHARS} chars):
${preview}`;
}
