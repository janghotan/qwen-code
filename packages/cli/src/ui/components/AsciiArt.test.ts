/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import {
  QWEN_LOGO_COLOR,
  compactAsciiLogo,
  fullAsciiLogo,
  shortAsciiLogo,
} from './AsciiArt.js';
import { getAsciiArtWidth } from '../utils/textUtils.js';

describe('AsciiArt', () => {
  it('defines the coherent Qwen brand blue (#072efe)', () => {
    expect(QWEN_LOGO_COLOR).toBe('#072efe');
  });

  describe('fullAsciiLogo (design source of truth)', () => {
    it('preserves exact character sequence, whitespace and alignment from the design source', () => {
      const sourcePath = '/home/tan/Downloads/ascii-art.txt';
      if (fs.existsSync(sourcePath)) {
        const sourceText = fs.readFileSync(sourcePath, 'utf8');
        expect(fullAsciiLogo.trim()).toBe(sourceText.trim());
      }
    });

    it('has exactly 24 lines and 45 columns width', () => {
      const lines = fullAsciiLogo.trim().split('\n');
      expect(lines).toHaveLength(24);
      const maxWidth = Math.max(...lines.map((l) => l.length));
      expect(maxWidth).toBe(45);
    });

    it('uses only alphanumeric characters (N, M, O, L) and whitespace with no block characters', () => {
      const nonSpaceChars = new Set(
        fullAsciiLogo.replace(/[\s\r\n]/g, '').split(''),
      );
      const blockChars = ['█', '▀', '▄', '▌', '▐', '■'];
      for (const b of blockChars) {
        expect(nonSpaceChars.has(b)).toBe(false);
      }
      expect(Array.from(nonSpaceChars).sort()).toEqual(['L', 'M', 'N', 'O']);
    });

    it('preserves the intentional triangular central void geometry', () => {
      const lines = fullAsciiLogo.trim().split('\n');
      const centerRow = lines[9]; // line 10 in 1-based index
      expect(centerRow).toBeDefined();
      expect(centerRow).toContain('                 ');
      expect(centerRow).toMatch(/\w+\s{10,}\w+/);
    });
  });

  describe('shortAsciiLogo (standard banner)', () => {
    it('is bounded in vertical height to 24 lines', () => {
      const lines = shortAsciiLogo.trim().split('\n');
      expect(lines).toHaveLength(24);
    });

    it('is bounded in width to 45 columns', () => {
      const width = getAsciiArtWidth(shortAsciiLogo);
      expect(width).toBe(45);
    });

    it('preserves the triangular central void using alphanumeric characters', () => {
      const lines = shortAsciiLogo.trim().split('\n');
      expect(lines[9]).toContain('                 ');
      expect(lines[23]).toContain('NNNNNNNNN');
    });

    it('contains no ANSI escape sequences or control characters', () => {
      expect(shortAsciiLogo.includes('\u001b')).toBe(false);
      // eslint-disable-next-line no-control-regex
      expect(shortAsciiLogo).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    });
  });

  describe('compactAsciiLogo (compact variant)', () => {
    it('is bounded in vertical height to 10 lines', () => {
      const lines = compactAsciiLogo.trim().split('\n');
      expect(lines).toHaveLength(10);
    });

    it('is bounded in width to 20 columns for narrower terminals', () => {
      const width = getAsciiArtWidth(compactAsciiLogo);
      expect(width).toBeLessThanOrEqual(20);
    });

    it('uses only alphanumeric characters and preserves central void', () => {
      const lines = compactAsciiLogo.trim().split('\n');
      expect(lines[4]).toContain('      ');
      expect(lines[9]).toContain('NNNNN');
      expect(compactAsciiLogo).not.toContain('█');
    });

    it('contains no ANSI escape sequences or control characters', () => {
      expect(compactAsciiLogo.includes('\u001b')).toBe(false);
      // eslint-disable-next-line no-control-regex
      expect(compactAsciiLogo).not.toMatch(/[\x00-\x08\x0b\x0c\x0e-\x1f]/);
    });
  });
});
