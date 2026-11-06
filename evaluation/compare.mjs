#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const CASES = JSON.parse(
  fs.readFileSync(path.join(directory, 'cases.json'), 'utf8'),
);
const CASE_IDS = new Set(CASES.map(({ id }) => id));
const COUNTERS = [
  'inputTokens',
  'outputTokens',
  'cachedTokens',
  'reasoningTokens',
  'requests',
  'retries',
  'subagentRequests',
  'compactionRequests',
  'toolCalls',
];
const REVIEW_STATES = new Set(['pending', 'approved', 'needs_changes']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateRun(run, index) {
  assert(run && typeof run === 'object', `runs[${index}] must be an object`);
  assert(CASE_IDS.has(run.caseId), `Unknown caseId: ${run.caseId}`);
  assert(
    typeof run.sampleId === 'string' && run.sampleId.length > 0,
    `runs[${index}].sampleId must be a non-empty string`,
  );
  assert(
    run.metrics && typeof run.metrics === 'object',
    `runs[${index}].metrics must be an object`,
  );
  for (const key of COUNTERS) {
    assert(
      run.metrics[key] === null || isNonNegativeInteger(run.metrics[key]),
      `runs[${index}].metrics.${key} must be null or a non-negative safe integer`,
    );
  }
  const { reportedCostUsd } = run.metrics;
  assert(
    reportedCostUsd === null ||
      (typeof reportedCostUsd === 'number' &&
        Number.isFinite(reportedCostUsd) &&
        reportedCostUsd >= 0),
    `runs[${index}].metrics.reportedCostUsd must be a non-negative number or null`,
  );
  assert(
    run.quality && typeof run.quality === 'object',
    `runs[${index}].quality must be an object`,
  );
  assert(
    typeof run.quality.taskCompleted === 'boolean',
    `runs[${index}].quality.taskCompleted must be a boolean`,
  );
  assert(
    typeof run.quality.testsPassed === 'boolean',
    `runs[${index}].quality.testsPassed must be a boolean`,
  );
  assert(
    isNonNegativeInteger(run.quality.regressionDefects),
    `runs[${index}].quality.regressionDefects must be a non-negative safe integer`,
  );
  assert(
    REVIEW_STATES.has(run.quality.humanReview),
    `runs[${index}].quality.humanReview must be pending, approved, or needs_changes`,
  );
}

export function validateRunSet(input) {
  assert(input && typeof input === 'object', 'Run set must be an object');
  assert(input.schemaVersion === 1, 'schemaVersion must be 1');
  assert(
    ['recorded', 'synthetic'].includes(input.source),
    'source must be recorded or synthetic',
  );
  assert(
    input.experiment && typeof input.experiment === 'object',
    'experiment must identify the provider, model, protocol, and configHash',
  );
  for (const key of ['provider', 'model', 'protocol', 'configHash']) {
    assert(
      typeof input.experiment[key] === 'string' &&
        input.experiment[key].length > 0,
      `experiment.${key} must be a non-empty string`,
    );
  }
  assert(
    Array.isArray(input.runs) && input.runs.length > 0,
    'runs must be a non-empty array',
  );
  const seen = new Set();
  input.runs.forEach((run, index) => {
    validateRun(run, index);
    const key = `${run.caseId}\0${run.sampleId}`;
    assert(!seen.has(key), `Duplicate run: ${run.caseId}/${run.sampleId}`);
    seen.add(key);
  });
  return input;
}

function sum(runs, key) {
  if (runs.some((run) => run.metrics[key] === null)) return null;
  const total = runs.reduce((value, run) => value + run.metrics[key], 0);
  assert(
    Number.isSafeInteger(total),
    `Aggregate ${key} exceeds safe integer range`,
  );
  return total;
}

function measuredCost(runs) {
  if (runs.some((run) => run.metrics.reportedCostUsd === null)) return null;
  const total = runs.reduce(
    (value, run) => value + run.metrics.reportedCostUsd,
    0,
  );
  assert(Number.isFinite(total), 'Aggregate reportedCostUsd is not finite');
  return total;
}

function metricComparison(baseline, candidate) {
  const change =
    baseline === null || candidate === null || baseline === 0
      ? null
      : ((candidate - baseline) / baseline) * 100;
  return {
    baseline,
    candidate,
    percentChange: change === null ? null : Math.round(change * 10) / 10,
  };
}

function qualitySummary(runs) {
  const counts = { pending: 0, approved: 0, needs_changes: 0 };
  for (const run of runs) counts[run.quality.humanReview] += 1;
  return {
    taskCompletion:
      runs.filter((run) => run.quality.taskCompleted).length / runs.length,
    testPassRate:
      runs.filter((run) => run.quality.testsPassed).length / runs.length,
    regressionDefects: runs.reduce(
      (total, run) => total + run.quality.regressionDefects,
      0,
    ),
    humanReview: counts,
  };
}

function summarize(runs) {
  const usage = Object.fromEntries(
    [...COUNTERS, 'reportedCostUsd'].map((name) => [
      name,
      name === 'reportedCostUsd' ? measuredCost(runs) : sum(runs, name),
    ]),
  );
  return { runCount: runs.length, usage, quality: qualitySummary(runs) };
}

export function compareRuns(baselineInput, candidateInput) {
  const baseline = validateRunSet(baselineInput);
  const candidate = validateRunSet(candidateInput);
  assert(
    baseline.source === candidate.source,
    'Baseline and candidate source values must match',
  );
  assert(
    ['provider', 'model', 'protocol', 'configHash'].every(
      (key) => baseline.experiment[key] === candidate.experiment[key],
    ),
    'Baseline and candidate experiment settings must match',
  );
  const key = (run) => `${run.caseId}\0${run.sampleId}`;
  const baselineByKey = new Map(baseline.runs.map((run) => [key(run), run]));
  const candidateByKey = new Map(candidate.runs.map((run) => [key(run), run]));
  assert(
    baselineByKey.size === candidateByKey.size &&
      [...baselineByKey.keys()].every((id) => candidateByKey.has(id)),
    'Baseline and candidate must contain the same caseId/sampleId pairs',
  );

  const baselineSummary = summarize(baseline.runs);
  const candidateSummary = summarize(candidate.runs);
  const compareSummary = (baselineMetrics, candidateMetrics) =>
    Object.fromEntries(
      [...COUNTERS, 'reportedCostUsd'].map((name) => [
        name,
        metricComparison(
          baselineMetrics.usage[name],
          candidateMetrics.usage[name],
        ),
      ]),
    );
  const baselineRunsByCase = new Map();
  const candidateRunsByCase = new Map();
  for (const run of baseline.runs) {
    const group = baselineRunsByCase.get(run.caseId) ?? [];
    group.push(run);
    baselineRunsByCase.set(run.caseId, group);
  }
  for (const run of candidate.runs) {
    const group = candidateRunsByCase.get(run.caseId) ?? [];
    group.push(run);
    candidateRunsByCase.set(run.caseId, group);
  }
  const byCase = Object.fromEntries(
    CASES.filter(({ id }) => baselineRunsByCase.has(id)).map(
      ({ id, category }) => {
        const left = summarize(baselineRunsByCase.get(id));
        const right = summarize(candidateRunsByCase.get(id));
        return [
          id,
          {
            category,
            runCount: left.runCount,
            usage: compareSummary(left, right),
            quality: { baseline: left.quality, candidate: right.quality },
          },
        ];
      },
    ),
  );

  return {
    schemaVersion: 1,
    source: baseline.source,
    experiment: baseline.experiment,
    runCount: baseline.runs.length,
    usage: compareSummary(baselineSummary, candidateSummary),
    byCase,
    quality: {
      baseline: baselineSummary.quality,
      candidate: candidateSummary.quality,
    },
  };
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i];
    const value = args[i + 1];
    assert(
      ['--baseline', '--candidate', '--output'].includes(name),
      `Unknown option: ${name}`,
    );
    assert(value && !value.startsWith('--'), `Missing value for ${name}`);
    options[name] = value;
  }
  assert(
    options['--baseline'] && options['--candidate'],
    'Usage: node evaluation/compare.mjs --baseline baseline.json --candidate candidate.json [--output report.json]',
  );
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const read = (file) =>
    JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  const report = compareRuns(
    read(options['--baseline']),
    read(options['--candidate']),
  );
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (options['--output']) {
    fs.writeFileSync(path.resolve(options['--output']), output, { flag: 'wx' });
  } else {
    process.stdout.write(output);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
