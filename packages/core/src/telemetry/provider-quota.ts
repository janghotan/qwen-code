/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { MAX_TURN_BUDGET_TOKENS } from '../core/turn-budget.js';
import { createDebugLogger } from '../utils/debugLogger.js';
import { parsePositiveIntegerEnv } from '../utils/env.js';
import { uiTelemetryService } from './uiTelemetry.js';

const debugLogger = createDebugLogger('PROVIDER_QUOTA');

/** Session-wide cap on provider-reported tokens for optional agent work. */
export const MAX_PROVIDER_TOKENS_PER_SESSION_ENV =
  'QWEN_CODE_MAX_PROVIDER_TOKENS_PER_SESSION';

/** Fraction of the session cap at which one advisory is logged. */
export const PROVIDER_QUOTA_WARN_RATIO = 0.8;

export interface ProviderQuotaStatus {
  limit: number;
  /** Provider-reported session total, or null once a response omits a positive total. */
  used: number | null;
}

/**
 * Resolve the session cap. Unset or invalid values mean "no cap"; values above
 * the hard ceiling are clamped like the workflow token cap.
 */
export function resolveMaxProviderTokensPerSession(
  env: Record<string, string | undefined> = process.env,
): number | null {
  const raw = env[MAX_PROVIDER_TOKENS_PER_SESSION_ENV];
  if (raw === undefined || raw.trim() === '') return null;
  const parsed = parsePositiveIntegerEnv(raw, 0);
  if (parsed < 1) {
    debugLogger.warn(
      `Invalid ${MAX_PROVIDER_TOKENS_PER_SESSION_ENV}=${JSON.stringify(raw)}, treating as unset (no cap)`,
    );
    return null;
  }
  if (parsed > MAX_TURN_BUDGET_TOKENS) {
    debugLogger.warn(
      `${MAX_PROVIDER_TOKENS_PER_SESSION_ENV}=${parsed} exceeds hard ceiling (${MAX_TURN_BUDGET_TOKENS}); clamping.`,
    );
    return MAX_TURN_BUDGET_TOKENS;
  }
  return parsed;
}

export function getProviderQuotaStatus(
  sessionId: string | undefined,
  env: Record<string, string | undefined> = process.env,
): ProviderQuotaStatus | null {
  const limit = resolveMaxProviderTokensPerSession(env);
  if (limit === null) return null;
  return {
    limit,
    used:
      sessionId === undefined
        ? null
        : uiTelemetryService.getProviderReportedTotalTokens(sessionId),
  };
}

export class ProviderQuotaExceededError extends Error {
  override readonly name = 'ProviderQuotaExceededError';

  constructor(used: number | null, limit: number) {
    super(
      used === null
        ? `Provider usage is unknown with a session token quota of ${limit}; refusing further optional agent dispatches. Continue this task without spawning agents.`
        : `Provider token quota reached (${used} / ${limit}); refusing further optional agent dispatches. Continue this task without spawning agents.`,
    );
  }
}

const warned = new Set<string>();

function warnOnce(sessionId: string | undefined, status: ProviderQuotaStatus) {
  const key = `${sessionId ?? '(no-session)'}:${status.limit}`;
  if (warned.has(key)) return;
  warned.add(key);
  debugLogger.warn(
    status.used === null
      ? `Provider token quota is enabled, but session usage is unknown; optional agent dispatches will be refused.`
      : `Provider token quota is ${status.used} / ${status.limit}; optional agent dispatches stop at the limit.`,
  );
}

/**
 * Admission check for optional model work. Returns an error when the session
 * is at the cap, or when usage is unknown (fail closed). Never aborts work that
 * is already running.
 */
export function checkProviderQuota(
  sessionId: string | undefined,
  env: Record<string, string | undefined> = process.env,
): ProviderQuotaExceededError | null {
  const status = getProviderQuotaStatus(sessionId, env);
  if (status === null) return null;
  if (status.used === null) {
    warnOnce(sessionId, status);
    return new ProviderQuotaExceededError(null, status.limit);
  }
  if (status.used / status.limit >= PROVIDER_QUOTA_WARN_RATIO) {
    warnOnce(sessionId, status);
  }
  return status.used >= status.limit
    ? new ProviderQuotaExceededError(status.used, status.limit)
    : null;
}
