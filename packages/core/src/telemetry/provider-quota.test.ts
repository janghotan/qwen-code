/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { uiTelemetryService } from './uiTelemetry.js';
import { EVENT_API_RESPONSE } from './constants.js';
import {
  MAX_PROVIDER_TOKENS_PER_SESSION_ENV,
  PROVIDER_QUOTA_WARN_RATIO,
  checkProviderQuota,
  getProviderQuotaStatus,
  resolveMaxProviderTokensPerSession,
} from './provider-quota.js';

const SESSION = 'provider-quota-test';
const env = (raw: string) => ({ [MAX_PROVIDER_TOKENS_PER_SESSION_ENV]: raw });

function recordProviderUsage(totalTokenCount: number, session = SESSION) {
  uiTelemetryService.addEvent(
    {
      'event.name': EVENT_API_RESPONSE,
      'event.timestamp': new Date().toISOString(),
      response_id: `response-${totalTokenCount}`,
      model: 'test-model',
      duration_ms: 1,
      input_token_count: totalTokenCount,
      output_token_count: 0,
      cached_content_token_count: 0,
      thoughts_token_count: 0,
      total_token_count: totalTokenCount,
      prompt_id: 'prompt',
    } as Parameters<typeof uiTelemetryService.addEvent>[0],
    session,
  );
}

beforeEach(() => {
  uiTelemetryService.reset();
});

describe('resolveMaxProviderTokensPerSession', () => {
  it('returns null when unset or invalid', () => {
    expect(resolveMaxProviderTokensPerSession({})).toBeNull();
    expect(resolveMaxProviderTokensPerSession(env(''))).toBeNull();
    expect(resolveMaxProviderTokensPerSession(env('0'))).toBeNull();
    expect(resolveMaxProviderTokensPerSession(env('1e3'))).toBeNull();
  });

  it('accepts a positive integer', () => {
    expect(resolveMaxProviderTokensPerSession(env('5000'))).toBe(5000);
  });
});

describe('checkProviderQuota', () => {
  it('is open when no cap is configured', () => {
    expect(checkProviderQuota(SESSION, {})).toBeNull();
  });

  it('reports exact usage and admits work below the hard limit', () => {
    recordProviderUsage(60);
    const status = getProviderQuotaStatus(SESSION, env('100'));
    expect(status).toEqual({ limit: 100, used: 60 });
    expect(60 / 100).toBeLessThan(PROVIDER_QUOTA_WARN_RATIO);
    expect(checkProviderQuota(SESSION, env('100'))).toBeNull();
  });

  it('refuses at the hard limit without touching the moving total', () => {
    recordProviderUsage(100);
    expect(checkProviderQuota(SESSION, env('100'))?.message).toContain(
      'Provider token quota reached (100 / 100)',
    );
    expect(uiTelemetryService.getProviderReportedTotalTokens(SESSION)).toBe(
      100,
    );
  });

  it('fails closed once any response omits its provider total', () => {
    recordProviderUsage(100);
    recordProviderUsage(0);
    expect(checkProviderQuota(SESSION, env('1000'))?.message).toContain(
      'usage is unknown',
    );
  });
});
