/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fakeServerHostOptions, TestRig } from './test-helper.js';
import { fakeToolCall, startFakeOpenAIServer } from './fake-openai-server.js';
import type { FakeOpenAIServer } from './fake-openai-server.js';
import { fakeModelLaunchArgs } from './helpers/gated-skill-fixture.js';

describe('offline engineering evaluation', () => {
  let rig: TestRig | undefined;
  let server: FakeOpenAIServer | undefined;
  const targets = [
    ...(process.env['QWEN_EVALUATION_BASELINE_CLI']
      ? [
          {
            label: 'upstream-baseline',
            title: 'upstream baseline',
            bundlePath: process.env['QWEN_EVALUATION_BASELINE_CLI'],
          },
        ]
      : []),
    {
      label: 'engineering-edition',
      title: 'engineering edition',
      bundlePath: undefined,
    },
  ];

  afterEach(async () => {
    await server?.close();
    await rig?.cleanup();
  });

  it.each(targets)(
    'executes a deterministic coding task through a local fake provider ($title)',
    async (target) => {
      rig = new TestRig();
      if (target.bundlePath) rig.bundlePath = target.bundlePath;
      await rig.setup('offline engineering evaluation');
      let generatedToolCalls = 0;
      const usage = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        requests: 0,
      };
      server = await startFakeOpenAIServer(({ body }) => {
        if (body['stream'] !== true) {
          return { content: '{"selected_memories":[]}' };
        }
        const messages = (body['messages'] as Array<{ role?: string }>) ?? [];
        const nextToolCall =
          (messages.at(-1)?.role === 'user' && generatedToolCalls === 0) ||
          (messages.at(-1)?.role === 'tool' && generatedToolCalls === 1);
        if (nextToolCall) {
          generatedToolCalls++;
          usage.inputTokens += 120;
          usage.outputTokens += 12;
          usage.cachedTokens += 20;
          usage.requests++;
          const filePath = join(rig!.testDir!, 'greeting.txt');
          return {
            toolCalls: [
              generatedToolCalls === 1
                ? fakeToolCall('read_file', { file_path: filePath })
                : fakeToolCall('write_file', {
                    file_path: filePath,
                    content: 'Qwen offline evaluation passed.\n',
                  }),
            ],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 12,
              total_tokens: 132,
              prompt_tokens_details: { cached_tokens: 20 },
            },
          };
        }
        usage.inputTokens += 160;
        usage.outputTokens += 18;
        usage.cachedTokens += 40;
        usage.requests++;
        return {
          content: 'Created greeting.txt and verified its contents.',
          usage: {
            prompt_tokens: 160,
            completion_tokens: 18,
            total_tokens: 178,
            prompt_tokens_details: { cached_tokens: 40 },
          },
        };
      }, fakeServerHostOptions());

      const output = await rig.run(
        'Create greeting.txt with the exact text: Qwen offline evaluation passed.',
        ...fakeModelLaunchArgs(server),
      );

      expect(output).toContain('Created greeting.txt');
      expect(readFileSync(join(rig.testDir!, 'greeting.txt'), 'utf8')).toBe(
        'Qwen offline evaluation passed.\n',
      );
      expect(generatedToolCalls).toBe(2);
      expect(
        server.requests.filter((request) => request.body['stream'] === true),
      ).toHaveLength(3);
      expect(usage).toEqual({
        inputTokens: 400,
        outputTokens: 42,
        cachedTokens: 80,
        requests: 3,
      });
      expect(
        server.requests.every(
          (request) => request.body['model'] === 'fake-model',
        ),
      ).toBe(true);

      const recordsDir = process.env['QWEN_EVALUATION_RUNS_DIR'];
      if (recordsDir) {
        mkdirSync(recordsDir, { recursive: true });
        writeFileSync(
          join(recordsDir, `${target.label}.json`),
          `${JSON.stringify(
            {
              schemaVersion: 1,
              source: 'synthetic',
              experiment: {
                provider: 'local-fake-openai',
                model: 'fake-model',
                protocol: 'openai-chat-completions',
                configHash: 'engineering-evaluation-v1',
              },
              runs: [
                {
                  caseId: 'feature',
                  sampleId: 'fixed-file-writing-task',
                  metrics: {
                    inputTokens: usage.inputTokens,
                    outputTokens: usage.outputTokens,
                    cachedTokens: usage.cachedTokens,
                    reasoningTokens: null,
                    requests: usage.requests,
                    retries: null,
                    subagentRequests: null,
                    compactionRequests: null,
                    toolCalls: generatedToolCalls,
                    reportedCostUsd: null,
                  },
                  quality: {
                    taskCompleted: true,
                    testsPassed: true,
                    regressionDefects: 0,
                    humanReview: 'pending',
                  },
                },
              ],
            },
            null,
            2,
          )}\n`,
          { flag: 'wx' },
        );
      }
    },
  );
});
