/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** Coherent solid blue matching the Qwen brand icon design. */
export const QWEN_LOGO_COLOR = '#072efe';

/**
 * Full alphanumeric ASCII art logo faithfully preserved from the user-provided design source
 * (/home/tan/Downloads/ascii-art.txt). Contains 24 lines of clean alphanumeric characters
 * (N, M, O, L) with no block characters.
 */
export const fullAsciiLogo = `
                NNNNNNNNN
             MNNNNNNNNONN
             NNNNNNNNNNNNN
           MNONNNNNNNNNNNNNNNNNONNNNNNNN
          MNNNNNNNNNNNNNNNNNNNNNNNNNNNNNM
          NNNNNNONNNNNNNNNNNNNNNNNNNNNNNNN
  NNNNNNNNMNNNNNNNNNNNNNNNNNNNNNNNONNNNNNN
 NNNNNNONNONNNNNONNNNNNNNNNNNNNNNNNNNNNNN
NNNNNNNNNNNNMNNNONNNNNNNNNNNNNNNNNNNNNNN
NNNNNNNNNNONNN                 NNNNNNNNN
 NNNONNNNNONNNN               NNNNNNNNNNN
  NNNNNNNNNNNNNN             NNNNNNNNNNNNN
   NNNNNNNONNNNNN           NNNNNNNNNNNNNNN
    NNNNNNNNNONNNN         NNNNNNNNNNNNNNNNNL
     NNNNNNNNNNNNNN       NNNNNNNNNNNONNNNNON
     NNNNNONNNNNNNNN     NNNNNNONNNNNNNNNNNNN
    NNNONNNNNONNNNNNN   NNNNNNNONNNNNNNNNNNN
   NNNNNNNNNNNNNNNNONN NNNNNNNNNNNNNNNNNONN
   NNNNNNNONNNNNNNNONNNNNNNNNNNNNNNN
    NNNONNNNNNNNNNNNMNNNNNNNONNNNNN
     NNNNNNNNNNNNNNNNNONNNNNNNNNNM
                   MNNNNNNNNNNNNM
                    NNNNNNNNNNNN
                     NNNNNNNNN
`;

/**
 * Standard alphanumeric terminal banner logo reproducing the user-supplied art.
 */
export const shortAsciiLogo = fullAsciiLogo;

/**
 * Controlled compact alphanumeric variant (20 columns x 10 lines) for narrower terminals
 * preserving the triangular void, ribbon arms, and proportional contours with no block characters.
 */
export const compactAsciiLogo = `
      NNNNNN
     NNNNNNNNNNNNN
 NNNNNNNNNNNNNNNNNN
NNNNNNNNNNNNNNNNNN
NNNNNNN      NNNNN
  NNNNNN    NNNNNNNN
  NNNNNNN  NNNNNNNNN
 NNNNNNNNNNNNNNNNNN
  NNNNNNNNNNNNN
         NNNNN
`;
