/**
 * @license
 * Copyright 2026 Qwen Team
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_SKILL_LISTING_CHARS } from '../core/environmentContext.js';
import {
  renderAvailableSkillsBlock,
  type AvailableSkillEntry,
} from '../tools/skill-utils.js';
import { parseSkillContent } from './skill-load.js';
import {
  SkillActivationRegistry,
  splitConditionalSkills,
} from './skill-activation.js';
import { SkillManager } from './skill-manager.js';
import { makeFakeConfig } from '../test-utils/config.js';

// Bundled skills are loaded from disk at runtime by SkillManager. A typo in
// frontmatter (missing `description`, malformed YAML, broken `---` delimiter,
// `allowedTools` written as a scalar instead of a list, ...) currently fails
// only when a user invokes the skill — `skill-manager.ts` swallows the parse
// error and emits a debug log, so CI stays green. This integration test parses
// every shipped SKILL.md against the real loader so any frontmatter regression
// fails CI immediately.

const bundledDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'bundled',
);

const skillNames = fs
  .readdirSync(bundledDir, { withFileTypes: true })
  .filter(
    (d) =>
      d.isDirectory() &&
      fs.existsSync(path.join(bundledDir, d.name, 'SKILL.md')),
  )
  .map((d) => d.name);

describe('bundled SKILL.md files', () => {
  it('discovers at least one bundled skill', () => {
    expect(skillNames.length).toBeGreaterThan(0);
  });

  it.each(['browser-use', 'computer-use'])(
    'keeps retired %s documentation out of the bundled skill catalog',
    async (name) => {
      expect(skillNames).not.toContain(name);
      const manager = new SkillManager(makeFakeConfig());
      await expect(manager.loadSkill(name, 'bundled')).resolves.toBeNull();
    },
  );

  it.each(skillNames)('%s/SKILL.md parses with required fields', (name) => {
    const file = path.join(bundledDir, name, 'SKILL.md');
    const content = fs.readFileSync(file, 'utf8');
    const cfg = parseSkillContent(content, file);

    expect(cfg.name).toBe(name);
    expect(cfg.description).toBeTruthy();
    expect(cfg.body.length).toBeGreaterThan(0);
    if (cfg.allowedTools !== undefined) {
      expect(Array.isArray(cfg.allowedTools)).toBe(true);
    }
  });

  it('ships compact path-activated engineering skills', async () => {
    const expectedNames = [
      'engineering-implementation',
      'software-architecture',
      'root-cause-debugging',
      'test-engineering',
      'security-code-review',
      'performance-engineering',
    ];
    const manager = new SkillManager(makeFakeConfig());
    const configs = await Promise.all(
      expectedNames.map(async (name) => {
        const file = path.join(bundledDir, name, 'SKILL.md');
        expect(fs.existsSync(file), `${name} should be bundled`).toBe(true);
        const cfg = parseSkillContent(fs.readFileSync(file, 'utf8'), file);
        expect(cfg.paths, `${name} should load conditionally`).toBeDefined();
        expect(cfg.paths?.length).toBeGreaterThan(0);
        expect(cfg.body.length).toBeLessThanOrEqual(1_200);
        // The runtime parser (not only the fixture parser above) must accept it.
        await expect(
          manager.loadSkill(name, 'bundled'),
        ).resolves.not.toBeNull();
        return cfg;
      }),
    );

    const split = splitConditionalSkills(configs);
    expect(split.unconditional).toEqual([]);
    expect(split.conditional).toHaveLength(expectedNames.length);

    const registry = new SkillActivationRegistry(configs, '/');
    expect(await registry.matchAndConsume('/src/app.ts')).toContain(
      'engineering-implementation',
    );
    expect(await registry.matchAndConsume('/tests/app.test.ts')).toEqual(
      expect.arrayContaining(['root-cause-debugging', 'test-engineering']),
    );
    expect(await registry.matchAndConsume('/src/auth/session.ts')).toContain(
      'security-code-review',
    );
    expect(await registry.matchAndConsume('/bench/api.bench.ts')).toContain(
      'performance-engineering',
    );
    expect(await registry.matchAndConsume('/docs/architecture.md')).toContain(
      'software-architecture',
    );
  });

  // Every model-invocable bundled skill's `description` and `when_to_use` are
  // rendered into the session-start <available_skills> listing and charged on
  // every request. The listing is simplified once it passes
  // MAX_SKILL_LISTING_CHARS, but that trim keeps bundled entries verbatim, so
  // whatever the bundled entries take is taken from the room left for the
  // user's project, user and extension skills and model-invocable commands
  // (#12472). At 6,986 characters, that room is about 1,010. The last raise,
  // 6,800 → 7,050, paid for the `auto-memory` entry (233 characters), which
  // took about 11,000 characters of memory guidance out of every main-session
  // request (#16291).
  // A failure here means compress a bundled frontmatter, or raise this number
  // as a decision about how much of the listing bundled skills may take.
  const BUNDLED_LISTING_BUDGET = 7_050;

  it(`renders the model-invocable bundled listing within ${BUNDLED_LISTING_BUDGET} characters`, () => {
    const entries: AvailableSkillEntry[] = skillNames
      .map((name) => {
        const file = path.join(bundledDir, name, 'SKILL.md');
        return parseSkillContent(fs.readFileSync(file, 'utf8'), file);
      })
      // Mirror the runtime listing: pending conditional skills (`paths:`) are
      // not advertised until a tool call activates them, so they do not take
      // room in the session-start listing this budget protects.
      .filter((cfg) => !cfg.disableModelInvocation && !cfg.paths?.length)
      .map((cfg) => ({
        name: cfg.name,
        description: cfg.description,
        whenToUse: cfg.whenToUse,
        level: 'bundled' as const,
      }));

    expect(renderAvailableSkillsBlock(entries).length).toBeLessThanOrEqual(
      BUNDLED_LISTING_BUDGET,
    );
    expect(BUNDLED_LISTING_BUDGET).toBeLessThan(MAX_SKILL_LISTING_CHARS);
  });

  it('ships dataviz validator and references with the bundled skill', () => {
    const datavizDir = path.join(bundledDir, 'dataviz');

    expect(fs.existsSync(path.join(datavizDir, 'SKILL.md'))).toBe(true);
    expect(
      fs.existsSync(path.join(datavizDir, 'scripts', 'validate_palette.js')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(datavizDir, 'references', 'palette.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(datavizDir, 'references', 'choosing-a-form.md')),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(datavizDir, 'references', 'anti-patterns.md')),
    ).toBe(true);
  });

  it('ships the review verdict-gated reference files with the bundled skill', () => {
    const reviewDir = path.join(bundledDir, 'review');

    expect(fs.existsSync(path.join(reviewDir, 'SKILL.md'))).toBe(true);
    for (const name of ['posting.md', 'persistence.md', 'aone.md']) {
      expect(fs.existsSync(path.join(reviewDir, 'references', name))).toBe(
        true,
      );
    }
  });
});
