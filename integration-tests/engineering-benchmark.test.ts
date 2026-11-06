/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fakeServerHostOptions, TestRig } from './test-helper.js';
import {
  fakeToolCall,
  startFakeOpenAIServer,
  type FakeOpenAIResponse,
  type FakeOpenAIServer,
  type FakeOpenAIToolCall,
} from './fake-openai-server.js';
import { fakeModelLaunchArgs } from './helpers/gated-skill-fixture.js';

interface ScriptStep {
  calls: FakeOpenAIToolCall[];
  usage?: FakeOpenAIResponse['usage'];
}

interface ScriptRun {
  prompt: string;
  steps: ScriptStep[];
  final: string;
  args?: string[];
  /** First run of the recovery case must leave a recorded session behind. */
  chatRecording?: boolean;
}

interface Verification {
  taskCompleted: boolean;
  testsPassed: boolean;
  regressionDefects: number;
}

interface BenchmarkTask {
  id: string;
  category: string;
  files: (dir: string) => Record<string, string>;
  settings?: Record<string, unknown>;
  runs: (dir: string) => ScriptRun[];
  verify: (dir: string, outputs: string[]) => Verification;
}

const usage = (prompt: number, completion: number) => ({
  prompt_tokens: prompt,
  completion_tokens: completion,
  total_tokens: prompt + completion,
  prompt_tokens_details: { cached_tokens: Math.floor(prompt / 4) },
});

function abs(dir: string, relativePath: string): string {
  return join(dir, relativePath);
}

function writeFixture(dir: string, files: Record<string, string>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(dir, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
  }
}

// Fixtures live inside this repository, whose package.json sets
// "type": "module". Pin them to CommonJS so require() works in fixtures.
const COMMONJS_PACKAGE = { 'package.json': '{"type":"commonjs"}\n' };

function nodeCheck(dir: string, expression: string): boolean {
  try {
    execFileSync(process.execPath, ['-e', expression], {
      cwd: dir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function nodeTest(dir: string, file: string): boolean {
  try {
    execFileSync(process.execPath, ['--test', file], {
      cwd: dir,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

const TASKS: BenchmarkTask[] = [
  {
    id: 'simple-bug-fix',
    category: 'Simple bug fix',
    files: () => ({
      'math.js': `function subtract(a, b) {
  return a + b;
}

module.exports = { subtract };
`,
    }),
    runs: (dir) => [
      {
        prompt:
          'subtract(10, 4) currently returns 14. Fix the bug in math.js and verify the corrected result with Node.',
        steps: [
          {
            calls: [
              fakeToolCall('read_file', {
                file_path: abs(dir, 'math.js'),
              }),
            ],
            usage: usage(120, 24),
          },
          {
            calls: [
              fakeToolCall('edit', {
                file_path: abs(dir, 'math.js'),
                old_string: 'return a + b;',
                new_string: 'return a - b;',
              }),
            ],
            usage: usage(180, 32),
          },
          {
            calls: [
              fakeToolCall('run_shell_command', {
                command:
                  'node -e "const { subtract } = require(\'./math.js\'); if (subtract(10, 4) !== 6) process.exit(1)"',
                description: 'verify subtract result',
                is_background: false,
              }),
            ],
            usage: usage(220, 30),
          },
        ],
        final: 'Fixed subtract in math.js and verified subtract(10, 4) === 6.',
      },
    ],
    verify: (dir, outputs) => {
      const source = readFileSync(join(dir, 'math.js'), 'utf8');
      const completed =
        source.includes('a - b') &&
        nodeCheck(
          dir,
          "const { subtract } = require('./math.js'); if (subtract(10, 4) !== 6) process.exit(1)",
        ) &&
        outputs.some((o) => o.includes('subtract(10, 4) === 6'));
      return {
        taskCompleted: completed,
        testsPassed:
          nodeCheck(
            dir,
            "const { subtract } = require('./math.js'); if (subtract(10, 4) !== 6) process.exit(1)",
          ) && outputs.some((o) => o.includes('subtract(10, 4) === 6')),
        regressionDefects: 0,
      };
    },
  },
  {
    id: 'feature',
    category: 'Normal feature implementation',
    files: () => ({
      'app.js': `function greet(name) {
  return \`Hello, \${name}!\`;
}

module.exports = { greet };
`,
    }),
    runs: (dir) => [
      {
        prompt:
          'Add a shout(name) function to app.js that returns greet(name).toUpperCase(), and verify it with Node.',
        steps: [
          {
            calls: [
              fakeToolCall('read_file', { file_path: abs(dir, 'app.js') }),
            ],
            usage: usage(110, 22),
          },
          {
            calls: [
              fakeToolCall('edit', {
                file_path: abs(dir, 'app.js'),
                old_string: 'module.exports = { greet };',
                new_string: `function shout(name) {
  return greet(name).toUpperCase();
}

module.exports = { greet, shout };`,
              }),
            ],
            usage: usage(190, 40),
          },
          {
            calls: [
              fakeToolCall('run_shell_command', {
                command:
                  "node -e \"const { shout } = require('./app.js'); if (shout('qwen') !== 'HELLO, QWEN!') process.exit(1)\"",
                description: 'verify shout output',
                is_background: false,
              }),
            ],
            usage: usage(240, 28),
          },
        ],
        final: 'Added shout(name) and verified HELLO, QWEN!.',
      },
    ],
    verify: (dir, outputs) => {
      const testsPassed =
        nodeCheck(
          dir,
          "const { shout } = require('./app.js'); if (shout('qwen') !== 'HELLO, QWEN!') process.exit(1)",
        ) && outputs.some((o) => o.includes('HELLO, QWEN!'));
      return { taskCompleted: testsPassed, testsPassed, regressionDefects: 0 };
    },
  },
  {
    id: 'multi-file-feature',
    category: 'Multi-file feature',
    files: () => ({
      'config.js': `const config = { host: 'localhost', port: 3000 };
module.exports = { config };
`,
      'server.js': `const { config } = require('./config');

function baseUrl() {
  return \`http://\${config.host}:\${config.port}\`;
}

module.exports = { baseUrl };
`,
    }),
    runs: (dir) => [
      {
        prompt:
          'Add a pathPrefix option defaulting to /api in config.js and make server.js baseUrl include it. Verify the final URL with Node.',
        steps: [
          {
            calls: [
              fakeToolCall('read_file', { file_path: abs(dir, 'config.js') }),
              fakeToolCall('read_file', { file_path: abs(dir, 'server.js') }),
            ],
            usage: usage(220, 36),
          },
          {
            calls: [
              fakeToolCall('edit', {
                file_path: abs(dir, 'config.js'),
                old_string: "const config = { host: 'localhost', port: 3000 };",
                new_string:
                  "const config = { host: 'localhost', port: 3000, pathPrefix: '/api' };",
              }),
            ],
            usage: usage(260, 30),
          },
          {
            calls: [
              fakeToolCall('edit', {
                file_path: abs(dir, 'server.js'),
                old_string: 'return `http://${config.host}:${config.port}`;',
                new_string:
                  'return `http://${config.host}:${config.port}${config.pathPrefix}`;',
              }),
            ],
            usage: usage(300, 34),
          },
          {
            calls: [
              fakeToolCall('run_shell_command', {
                command:
                  "node -e \"const { baseUrl } = require('./server.js'); if (baseUrl() !== 'http://localhost:3000/api') process.exit(1)\"",
                description: 'verify composed base URL',
                is_background: false,
              }),
            ],
            usage: usage(340, 26),
          },
        ],
        final: 'Added pathPrefix and verified http://localhost:3000/api.',
      },
    ],
    verify: (dir, outputs) => {
      const testsPassed =
        nodeCheck(
          dir,
          "const { baseUrl } = require('./server.js'); if (baseUrl() !== 'http://localhost:3000/api') process.exit(1)",
        ) && outputs.some((o) => o.includes('http://localhost:3000/api'));
      return { taskCompleted: testsPassed, testsPassed, regressionDefects: 0 };
    },
  },
  {
    id: 'complex-debugging',
    category: 'Complex debugging',
    files: () => ({
      'calc.js': `function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

module.exports = { average };
`,
      'calc.test.js': `const test = require('node:test');
const assert = require('node:assert');
const { average } = require('./calc');

test('average of an empty list is 0', () => {
  assert.strictEqual(average([]), 0);
});

test('average of numbers', () => {
  assert.strictEqual(average([2, 4, 6]), 4);
});
`,
    }),
    runs: (dir) => [
      {
        prompt:
          'node --test calc.test.js fails on the empty list. Reproduce the failure, find the root cause, fix it without weakening the test, and run the test again.',
        steps: [
          {
            calls: [
              fakeToolCall('run_shell_command', {
                command: 'node --test calc.test.js',
                description: 'reproduce failing average test',
                is_background: false,
              }),
            ],
            usage: usage(180, 30),
          },
          {
            calls: [
              fakeToolCall('read_file', { file_path: abs(dir, 'calc.js') }),
            ],
            usage: usage(220, 26),
          },
          {
            calls: [
              fakeToolCall('edit', {
                file_path: abs(dir, 'calc.js'),
                old_string: `function average(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}`,
                new_string: `function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}`,
              }),
            ],
            usage: usage(260, 40),
          },
          {
            calls: [
              fakeToolCall('run_shell_command', {
                command: 'node --test calc.test.js',
                description: 'verify average tests pass',
                is_background: false,
              }),
            ],
            usage: usage(300, 24),
          },
        ],
        final:
          'Reproduced the empty-list failure, guarded the divisor, and both tests pass.',
      },
    ],
    verify: (dir, outputs) => {
      const testsPassed = nodeTest(dir, 'calc.test.js');
      return {
        taskCompleted:
          testsPassed && outputs.some((o) => o.includes('both tests pass')),
        testsPassed,
        regressionDefects: 0,
      };
    },
  },
  {
    id: 'architectural-refactoring',
    category: 'Architectural refactoring',
    files: () => ({
      'format.js': `function formatName(user) {
  return \`\${user.first} \${user.last}\`.trim();
}

module.exports = { formatName };
`,
      'index.js': `const { formatName } = require('./format');

module.exports = { label: (user) => formatName(user) };
`,
    }),
    runs: (dir) => [
      {
        prompt:
          'Move formatName into names.js, keep format.js exporting it for compatibility, update index.js to import from names.js, and verify with Node.',
        steps: [
          {
            calls: [
              fakeToolCall('read_file', { file_path: abs(dir, 'format.js') }),
              fakeToolCall('read_file', { file_path: abs(dir, 'index.js') }),
            ],
            usage: usage(210, 34),
          },
          {
            calls: [
              fakeToolCall('write_file', {
                file_path: abs(dir, 'names.js'),
                content: `function formatName(user) {
  return \`\${user.first} \${user.last}\`.trim();
}

module.exports = { formatName };
`,
              }),
            ],
            usage: usage(250, 36),
          },
          {
            calls: [
              fakeToolCall('write_file', {
                file_path: abs(dir, 'format.js'),
                content: "module.exports = require('./names');\n",
              }),
            ],
            usage: usage(280, 22),
          },
          {
            calls: [
              fakeToolCall('edit', {
                file_path: abs(dir, 'index.js'),
                old_string: "const { formatName } = require('./format');",
                new_string: "const { formatName } = require('./names');",
              }),
            ],
            usage: usage(310, 24),
          },
          {
            calls: [
              fakeToolCall('run_shell_command', {
                command:
                  "node -e \"const { label } = require('./index.js'); if (label({ first: 'Qwen', last: 'Code' }) !== 'Qwen Code') process.exit(1)\"",
                description: 'verify refactored imports',
                is_background: false,
              }),
            ],
            usage: usage(340, 22),
          },
        ],
        final:
          'Moved formatName into names.js and verified the compatibility re-export.',
      },
    ],
    verify: (dir, outputs) => {
      const testsPassed =
        nodeCheck(
          dir,
          "const { label } = require('./index.js'); if (label({ first: 'Qwen', last: 'Code' }) !== 'Qwen Code') process.exit(1)",
        ) && outputs.some((o) => o.includes('compatibility re-export'));
      return { taskCompleted: testsPassed, testsPassed, regressionDefects: 0 };
    },
  },
  {
    id: 'unit-test-implementation',
    category: 'Unit-test implementation',
    files: () => ({
      'slug.js': `function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

module.exports = { slugify };
`,
    }),
    runs: (dir) => [
      {
        prompt:
          'Add slug.test.js using node:test for normal text, surrounding whitespace, punctuation, and empty input. Run the tests.',
        steps: [
          {
            calls: [
              fakeToolCall('read_file', { file_path: abs(dir, 'slug.js') }),
            ],
            usage: usage(140, 24),
          },
          {
            calls: [
              fakeToolCall('write_file', {
                file_path: abs(dir, 'slug.test.js'),
                content: `const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('./slug');

test('normal text', () => assert.strictEqual(slugify('Hello World'), 'hello-world'));
test('surrounding whitespace', () => assert.strictEqual(slugify('  A B  '), 'a-b'));
test('punctuation collapses', () => assert.strictEqual(slugify('a & b!'), 'a-b'));
test('empty input', () => assert.strictEqual(slugify('   '), ''));
`,
              }),
            ],
            usage: usage(220, 60),
          },
          {
            calls: [
              fakeToolCall('run_shell_command', {
                command: 'node --test slug.test.js',
                description: 'verify slug tests',
                is_background: false,
              }),
            ],
            usage: usage(280, 24),
          },
        ],
        final: 'Added four slugify cases and node --test slug.test.js passes.',
      },
    ],
    verify: (dir, outputs) => {
      const testsPassed = nodeTest(dir, 'slug.test.js');
      return {
        taskCompleted:
          testsPassed && outputs.some((o) => o.includes('slug.test.js passes')),
        testsPassed,
        regressionDefects: 0,
      };
    },
  },
  {
    id: 'security-review',
    category: 'Security review',
    files: () => ({
      'db.js': `const db = require('./db-client');

function findUser(username) {
  return db.query(\`SELECT * FROM users WHERE name = '\${username}'\`);
}

module.exports = { findUser };
`,
      'routes.js': `const { findUser } = require('./db');

function handle(req, res) {
  const user = findUser(req.query.name);
  res.end(JSON.stringify({ user, token: process.env.API_TOKEN }));
}

module.exports = { handle };
`,
    }),
    runs: (dir) => [
      {
        prompt:
          'Review db.js and routes.js for security defects. Do not change code; report concrete findings with the affected file and fix.',
        steps: [
          {
            calls: [
              fakeToolCall('read_file', { file_path: abs(dir, 'db.js') }),
              fakeToolCall('read_file', { file_path: abs(dir, 'routes.js') }),
            ],
            usage: usage(250, 40),
          },
          {
            calls: [
              fakeToolCall('grep_search', {
                pattern: 'query|process\\.env|token',
                path: dir,
              }),
            ],
            usage: usage(300, 30),
          },
        ],
        final:
          'Critical: db.js findUser interpolates username into SQL, allowing injection; use a parameterized query. High: routes.js returns process.env.API_TOKEN in the response, exposing a secret.',
      },
    ],
    verify: (dir, outputs) => {
      const filesUnchanged =
        readFileSync(join(dir, 'db.js'), 'utf8').includes('${username}') &&
        readFileSync(join(dir, 'routes.js'), 'utf8').includes('API_TOKEN');
      const testsPassed =
        filesUnchanged &&
        outputs.some(
          (o) =>
            o.includes('db.js') &&
            o.includes('parameterized') &&
            o.includes('API_TOKEN'),
        );
      return { taskCompleted: testsPassed, testsPassed, regressionDefects: 0 };
    },
  },
  {
    id: 'large-repository-exploration',
    category: 'Large repository exploration',
    files: () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 30; i++) {
        const marker =
          i === 17
            ? "const UNIQUE_MARKER = 'nebula-4821';"
            : `const marker${i} = 'filler-${i}';`;
        files[`src/modules/module-${i}.js`] = `${marker}
module.exports = { module: ${i} };
`;
      }
      return files;
    },
    runs: (dir) => [
      {
        prompt:
          'Find where UNIQUE_MARKER is defined in this repository and report the file path and value. Do not modify files.',
        steps: [
          {
            calls: [
              fakeToolCall('glob', { pattern: 'src/**/*.js', path: dir }),
            ],
            usage: usage(180, 26),
          },
          {
            calls: [
              fakeToolCall('grep_search', {
                pattern: 'UNIQUE_MARKER',
                path: dir,
              }),
            ],
            usage: usage(260, 30),
          },
          {
            calls: [
              fakeToolCall('read_file', {
                file_path: abs(dir, 'src/modules/module-17.js'),
              }),
            ],
            usage: usage(300, 26),
          },
        ],
        final:
          'UNIQUE_MARKER is defined in src/modules/module-17.js with value nebula-4821.',
      },
    ],
    verify: (dir, outputs) => {
      const source = readFileSync(
        join(dir, 'src/modules/module-17.js'),
        'utf8',
      );
      const testsPassed =
        source.includes('nebula-4821') &&
        outputs.some(
          (o) => o.includes('module-17.js') && o.includes('nebula-4821'),
        );
      return { taskCompleted: testsPassed, testsPassed, regressionDefects: 0 };
    },
  },
  {
    id: 'long-session-compaction',
    category: 'Long-session compaction',
    files: () => ({
      'notes/item-1.md': 'Action item: rotate the staging deploy key.\n',
      'notes/item-2.md': 'Background: the cache warm-up is slow.\n',
      'notes/item-3.md': 'Action item: document the rollback step.\n',
      'notes/item-4.md': 'Background: build logs are noisy.\n',
      'notes/item-5.md': 'Action item: keep this task after compaction.\n',
      'notes/item-6.md': 'Background: flaky test is quarantined.\n',
    }),
    settings: {
      model: { generationConfig: { contextWindowSize: 40000 } },
    },
    runs: (dir) => [
      {
        prompt:
          'Read every file in notes/ and summarize the action items. Context may be compacted; preserve the task.',
        steps: [1, 2, 3, 4, 5, 6].map((index) => ({
          calls: [
            fakeToolCall('read_file', {
              file_path: abs(dir, `notes/item-${index}.md`),
            }),
          ],
          usage: usage(9000 + index, 20),
        })),
        final:
          'Action items: rotate the staging deploy key, document the rollback step, and keep this task after compaction.',
      },
    ],
    verify: (_dir, outputs) => {
      const testsPassed = outputs.some(
        (o) =>
          o.includes('rotate the staging deploy key') &&
          o.includes('document the rollback step') &&
          o.includes('keep this task after compaction'),
      );
      return { taskCompleted: testsPassed, testsPassed, regressionDefects: 0 };
    },
  },
  {
    id: 'interrupted-session-recovery',
    category: 'Interrupted-session recovery',
    files: () => ({
      'task.md':
        'Steps: 1) create state.txt with "step one". 2) append "step two".\n',
    }),
    runs: (dir) => [
      {
        prompt:
          'Start the recovery task in task.md. Do step 1 only, then stop.',
        chatRecording: true,
        steps: [
          {
            calls: [
              fakeToolCall('read_file', { file_path: abs(dir, 'task.md') }),
            ],
            usage: usage(130, 22),
          },
          {
            calls: [
              fakeToolCall('write_file', {
                file_path: abs(dir, 'state.txt'),
                content: 'step one\n',
              }),
            ],
            usage: usage(190, 26),
          },
        ],
        final: 'Step 1 complete; remaining: append step two.',
      },
      {
        prompt: 'Continue the recovery task and complete step 2.',
        args: ['--continue'],
        steps: [
          {
            calls: [
              fakeToolCall('read_file', {
                file_path: abs(dir, 'state.txt'),
              }),
            ],
            usage: usage(160, 22),
          },
          {
            calls: [
              fakeToolCall('edit', {
                file_path: abs(dir, 'state.txt'),
                old_string: 'step one\n',
                new_string: 'step one\nstep two\n',
              }),
            ],
            usage: usage(220, 28),
          },
        ],
        final: 'Recovered the session and completed step 2.',
      },
    ],
    verify: (dir, outputs) => {
      const content = readFileSync(join(dir, 'state.txt'), 'utf8');
      const testsPassed =
        content === 'step one\nstep two\n' &&
        outputs.some((o) => o.includes('completed step 2'));
      return { taskCompleted: testsPassed, testsPassed, regressionDefects: 0 };
    },
  },
];

interface RunRecord {
  caseId: string;
  sampleId: string;
  metrics: {
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    reasoningTokens: null;
    requests: number;
    retries: number;
    subagentRequests: null;
    compactionRequests: number;
    toolCalls: number;
    reportedCostUsd: null;
  };
  quality: Verification & { humanReview: 'pending' };
}

describe.each([
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
    bundlePath: undefined as string | undefined,
  },
])('offline engineering benchmark ($title)', (target) => {
  const records: RunRecord[] = [];

  afterAll(() => {
    const recordsDir = process.env['QWEN_EVALUATION_RUNS_DIR'];
    if (!recordsDir) return;
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
            configHash: 'engineering-benchmark-v1',
          },
          runs: records,
        },
        null,
        2,
      )}\n`,
      { flag: 'w' },
    );
  });

  it.each(TASKS)(
    '$category: $id',
    async (task) => {
      const rig = new TestRig();
      if (target.bundlePath) rig.bundlePath = target.bundlePath;
      await rig.setup(`offline benchmark ${task.id}`, {
        settings: task.settings,
      });

      let server: FakeOpenAIServer | undefined;
      const totals = {
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        compactionRequests: 0,
      };
      let currentRun = 0;
      let stepIndex = 0;
      let finalReturned = false;

      const addUsage = (value: FakeOpenAIResponse['usage'] | undefined) => {
        if (!value) return;
        totals.inputTokens += value.prompt_tokens;
        totals.outputTokens += value.completion_tokens;
        totals.cachedTokens += value.prompt_tokens_details?.cached_tokens ?? 0;
      };

      try {
        writeFixture(rig.testDir!, {
          ...COMMONJS_PACKAGE,
          ...task.files(rig.testDir!),
        });
        const runs = task.runs(rig.testDir!);
        server = await startFakeOpenAIServer(({ body }) => {
          const messages = (body['messages'] as Array<{ role?: string }>) ?? [];
          if (body['stream'] !== true) {
            return { content: '{"selected_memories":[]}' };
          }
          const systemText = messages
            .filter((message) => message.role === 'system')
            .map((message) => JSON.stringify(message))
            .join('\n');
          const userText = messages
            .filter((message) => message.role === 'user')
            .map((message) => JSON.stringify(message))
            .join('\n');
          if (
            systemText.includes('summarizes a conversation') ||
            userText.includes('First, reason in your <analysis> block')
          ) {
            totals.compactionRequests++;
            const summaryUsage = usage(900, 180);
            addUsage(summaryUsage);
            return {
              content:
                '<state_snapshot><current_work>Compacted benchmark context.</current_work><next_step>Continue reading notes.</next_step></state_snapshot>',
              usage: summaryUsage,
            };
          }

          const script = runs[currentRun];
          const step = script?.steps[stepIndex];
          if (step) {
            stepIndex++;
            addUsage(step.usage);
            return { toolCalls: step.calls, usage: step.usage };
          }
          if (script && !finalReturned) {
            finalReturned = true;
            const finalUsage = usage(200, 40);
            addUsage(finalUsage);
            return { content: script.final, usage: finalUsage };
          }
          return { content: 'Done.', usage: usage(20, 2) };
        }, fakeServerHostOptions());

        const outputs: string[] = [];
        for (let index = 0; index < runs.length; index++) {
          currentRun = index;
          stepIndex = 0;
          finalReturned = false;
          const run = runs[index];
          outputs.push(
            await rig.run(
              { prompt: run.prompt, chatRecording: run.chatRecording },
              ...(run.args ?? []),
              ...fakeModelLaunchArgs(server),
            ),
          );
        }

        const verification = task.verify(rig.testDir!, outputs);
        const toolCalls = rig.readToolLogs().length;
        records.push({
          caseId: task.id,
          sampleId: 'deterministic-fake-provider',
          metrics: {
            ...totals,
            reasoningTokens: null,
            requests: server.requests.length,
            retries: 0,
            subagentRequests: null,
            toolCalls,
            reportedCostUsd: null,
          },
          quality: { ...verification, humanReview: 'pending' },
        });

        expect(verification.taskCompleted, task.id).toBe(true);
        expect(verification.testsPassed, task.id).toBe(true);
        expect(toolCalls, `${task.id} tool calls`).toBeGreaterThanOrEqual(2);
        if (task.id === 'long-session-compaction') {
          expect(
            totals.compactionRequests,
            'compaction requests observed',
          ).toBeGreaterThan(0);
        }
      } finally {
        await server?.close();
        await rig.cleanup();
      }
    },
    120_000,
  );
});
