import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CASES, compareRuns, validateRunSet } from './compare.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

const metrics = (overrides = {}) => ({
  inputTokens: 100,
  outputTokens: 20,
  cachedTokens: 10,
  reasoningTokens: 5,
  requests: 2,
  retries: 0,
  subagentRequests: 0,
  compactionRequests: 0,
  toolCalls: 3,
  reportedCostUsd: null,
  ...overrides,
});

const run = (caseId, overrides = {}) => ({
  caseId,
  sampleId: 'sample-1',
  metrics: metrics(overrides),
  quality: {
    taskCompleted: true,
    testsPassed: true,
    regressionDefects: 0,
    humanReview: 'pending',
  },
});

const runSet = (runs, source = 'recorded', experiment = {}) => ({
  schemaVersion: 1,
  source,
  experiment: {
    provider: 'fixture-provider',
    model: 'fixture-model',
    protocol: 'fixture-protocol',
    configHash: 'fixture-config',
    ...experiment,
  },
  runs,
});

test('compares usage totals without treating synthetic values as measured savings', () => {
  const baseline = runSet([run('simple-bug-fix')], 'synthetic');
  const candidate = runSet(
    [run('simple-bug-fix', { inputTokens: 80 })],
    'synthetic',
  );

  const result = compareRuns(baseline, candidate);

  assert.equal(result.source, 'synthetic');
  assert.equal(result.usage.inputTokens.baseline, 100);
  assert.equal(result.usage.inputTokens.candidate, 80);
  assert.equal(result.usage.inputTokens.percentChange, -20);
  assert.equal(result.quality.baseline.taskCompletion, 1);
  assert.equal(result.quality.candidate.taskCompletion, 1);
});

test('does not calculate a percentage when baseline usage is zero', () => {
  const result = compareRuns(
    runSet([run('simple-bug-fix', { inputTokens: 0 })]),
    runSet([run('simple-bug-fix', { inputTokens: 5 })]),
  );

  assert.equal(result.usage.inputTokens.percentChange, null);
});

test('rejects duplicate and unknown benchmark case identifiers', () => {
  assert.throws(
    () => validateRunSet(runSet([run('unknown')])),
    /Unknown caseId/,
  );
  assert.throws(
    () =>
      validateRunSet(runSet([run('simple-bug-fix'), run('simple-bug-fix')])),
    /Duplicate run/,
  );
});

test('keeps provider-reported cost unknown when any run omits it', () => {
  const result = compareRuns(
    runSet([run('simple-bug-fix', { reportedCostUsd: 0.02 })]),
    runSet([run('simple-bug-fix')]),
  );

  assert.equal(result.usage.reportedCostUsd.baseline, 0.02);
  assert.equal(result.usage.reportedCostUsd.candidate, null);
  assert.equal(result.usage.reportedCostUsd.percentChange, null);
});

test('keeps unreported token fields unknown instead of treating them as zero', () => {
  const report = compareRuns(
    runSet([run('simple-bug-fix', { cachedTokens: null })]),
    runSet([run('simple-bug-fix', { cachedTokens: null })]),
  );

  assert.equal(report.usage.cachedTokens.baseline, null);
  assert.equal(report.usage.cachedTokens.candidate, null);
  assert.equal(report.usage.cachedTokens.percentChange, null);
});

test('rejects comparisons with different provider or experiment settings', () => {
  assert.throws(
    () =>
      compareRuns(
        runSet([run('simple-bug-fix')]),
        runSet([run('simple-bug-fix')], 'recorded', { model: 'another-model' }),
      ),
    /experiment settings must match/,
  );
});

test('compares all ten synthetic categories without presenting savings', () => {
  const read = (name) =>
    JSON.parse(fs.readFileSync(path.join(root, 'fixtures', name), 'utf8'));
  const report = compareRuns(
    read('synthetic-baseline.json'),
    read('synthetic-candidate.json'),
  );

  assert.equal(report.source, 'synthetic');
  assert.equal(report.runCount, 10);
  assert.equal(Object.keys(report.byCase).length, CASES.length);
  assert.equal(report.usage.inputTokens.percentChange, 0);
  assert.equal(report.usage.reportedCostUsd.baseline, null);
  assert.equal(report.quality.candidate.humanReview.pending, 10);
});
