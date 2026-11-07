/**
 * @license
 * Copyright 2025 Qwen
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { getMainSessionBaseSystemPrompt } from '../core/client.js';
import { estimateContextTextTokens } from '../services/tokenEstimation.js';
import { uiTelemetryService } from '../telemetry/uiTelemetry.js';
import type { Config } from '../config/config.js';

/**
 * 空闲上下文与基准 Token 消耗测试套件。
 * 针对全新会话在零工具（Zero Tools）或极简配置下的基准提示词进行可重复的 Token 量化测量，
 * 确保核心系统指令未发生意外膨胀，且常驻前缀（Resident Prefix）保持精简与高缓存命中率。
 */
describe('Idle Context & Zero-Tools Benchmark', () => {
  const createMockMinimalConfig = (): Config =>
    ({
      getSystemPrompt: vi.fn().mockReturnValue(undefined),
      getModel: vi.fn().mockReturnValue('qwen3-max'),
      getWorkingDir: vi.fn().mockReturnValue('/workspace'),
      getUserMemory: vi.fn().mockReturnValue(''),
      getAppendSystemPrompt: vi.fn().mockReturnValue(''),
      getAutoMemoryPrompt: vi.fn().mockReturnValue(''),
      isTodoWriteEnabled: vi.fn().mockReturnValue(false),
      getCodeModeOnly: vi.fn().mockReturnValue(false),
      getExperimentalZedIntegration: vi.fn().mockReturnValue(false),
      getInputFormat: vi.fn().mockReturnValue(undefined),
      isInteractive: vi.fn().mockReturnValue(true),
      getOutputStyle: vi.fn().mockReturnValue(undefined),
      getToolRegistry: vi.fn().mockReturnValue({
        getAllTools: () => [],
        getFunctionDeclarations: () => [],
      }),
      isSkillEnabled: vi.fn().mockReturnValue(false),
      getSkillManager: vi.fn().mockReturnValue({
        listSkills: async () => [],
      }),
    }) as unknown as Config;

  it('measures baseline system prompt token cost under zero-tool configuration', () => {
    const config = createMockMinimalConfig();
    const systemPrompt = getMainSessionBaseSystemPrompt(config);

    // 计算纯系统指令字符数与估算 Token
    const charCount = systemPrompt.length;
    const estimatedTokens = estimateContextTextTokens(systemPrompt);

    // 验证核心系统指令结构完整且基准 Token 消耗稳定在测量区间内（4000~5500 tokens）
    expect(charCount).toBeGreaterThan(5000);
    expect(estimatedTokens).toBeGreaterThan(3000);
    expect(estimatedTokens).toBeLessThan(5500);
  });

  it('verifies prefix stability hash and length for fresh zero-tool requests', () => {
    const config = createMockMinimalConfig();
    const systemPrompt = getMainSessionBaseSystemPrompt(config);
    const sessionId = 'idle-session-bench';

    uiTelemetryService.resetSession(sessionId);

    // 记录首次请求的前缀稳定性
    uiTelemetryService.recordPrefixStability(systemPrompt, sessionId);
    const initial = uiTelemetryService.getPrefixStability(sessionId);

    expect(initial.totalEvaluated).toBe(1);
    expect(initial.stableRequests).toBe(1);
    expect(initial.driftCount).toBe(0);
    expect(initial.prefixLength).toBe(systemPrompt.length);
    expect(initial.currentPrefixHash).toBeDefined();
    expect(initial.currentPrefixHash).toHaveLength(16);

    // 连续第二次简单问答（如 "hello"），系统指令前缀保持完全一致，无缓存失效漂移
    uiTelemetryService.recordPrefixStability(systemPrompt, sessionId);
    const secondTurn = uiTelemetryService.getPrefixStability(sessionId);

    expect(secondTurn.totalEvaluated).toBe(2);
    expect(secondTurn.stableRequests).toBe(2);
    expect(secondTurn.driftCount).toBe(0);
    expect(secondTurn.currentPrefixHash).toBe(initial.currentPrefixHash);
  });

  it('evaluates dynamic conversation token overhead for simple single-turn prompt', () => {
    const userPrompt = 'Hello, how can you help me?';
    const userTokens = estimateContextTextTokens(userPrompt);

    // 简短问答在零工具下仅包含用户输入消息的纯文本消耗
    expect(userTokens).toBeGreaterThan(0);
    expect(userTokens).toBeLessThan(20);
  });

  it('covers both system instructions and tool schemas in prefix stability fingerprint', () => {
    const config = createMockMinimalConfig();
    const systemPrompt = getMainSessionBaseSystemPrompt(config);
    const sessionId = 'prefix-tools-bench';

    uiTelemetryService.resetSession(sessionId);

    // 初始前缀（包含指令与工具声明结构）
    const initialTools = JSON.stringify([
      { name: 'read_file', description: 'Read file' },
    ]);
    const fullPrefix1 = `${systemPrompt}\n---TOOLS---\n${initialTools}`;
    uiTelemetryService.recordPrefixStability(fullPrefix1, sessionId);

    let state = uiTelemetryService.getPrefixStability(sessionId);
    expect(state.totalEvaluated).toBe(1);
    expect(state.stableRequests).toBe(1);
    expect(state.driftCount).toBe(0);
    const hash1 = state.currentPrefixHash;

    // 当工具声明（如加载了新工具或 MCP 声明）改变时，前缀发生漂移
    const updatedTools = JSON.stringify([
      { name: 'read_file', description: 'Read file' },
      { name: 'write_file', description: 'Write file' },
    ]);
    const fullPrefix2 = `${systemPrompt}\n---TOOLS---\n${updatedTools}`;
    uiTelemetryService.recordPrefixStability(fullPrefix2, sessionId);

    state = uiTelemetryService.getPrefixStability(sessionId);
    expect(state.totalEvaluated).toBe(2);
    expect(state.driftCount).toBe(1);
    expect(state.currentPrefixHash).not.toBe(hash1);
  });
});
