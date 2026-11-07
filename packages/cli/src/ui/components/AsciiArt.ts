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
 * 标准半块字符终端徽标（28 列 x 14 行），精确还原 Qwen 官方莫比乌斯三丝带环拓扑结构。
 * 显式保留三条丝带之间的负空间切割缝隙与中央倒三角虚空，确保在终端分辨率下依然高度可辨识。
 */
export const shortAsciiLogo = `
          ▄█████▄
         ████████▄▄▄▄▄▄▄▄
        █████████████████▄
  ▄▄▄  ███████████████████
▄█████▄ ▀███████████████▀
████████             ▄▄▄
 ████████          ▄█████▄
  ▀███████▄       ▄███████▄
   ▀███████▄     ██████████▄
  ▄█████████▄   ███████████▀
  ███████████ ▄██████████▀▀
   ▀████████ ▄███████▀
             ███████▀
              █████▀
`;

/**
 * 紧凑型半块字符徽标变体（20 列 x 10 行），适用于窄屏终端，保留三丝带结构与中心负空间。
 */
export const compactAsciiLogo = `
       ▄███▄
      ███████████▄
 ▄▄▄ █████████████▀
█████▄▀▀▀▀▀▀▀▀▀▀▀▀
▀█████▄       ███▄
 ▀█████▄     ██████
  ██████▄  ▄████████
 ▀███████ ▄█████▀▀▀
  ▀▀▀▀▀▀▀▄█████
         ▀████
`;
