# TUI Logo and Edit Statistics

[English](2026-11-06-tui-logo-and-edit-stats.md) | [简体中文](2026-11-06-tui-logo-and-edit-stats.zh-CN.md)

## Problem

The terminal banner still showed the Qwen Code wordmark and title. Successful file edits also lacked a compact summary of the model's line changes.

## Goals and boundaries

- Show the supplied blue Qwen icon and label the product `Engineering Edition` in both Ink and OpenTUI banners.
- Preserve custom banner art and titles.
- Show model-added and model-removed line counts beside successful file-edit actions, using green and red respectively.
- Keep the change local to terminal rendering; do not change authentication, provider, or model settings.

## Design

Render a compact Unicode block rendition of the supplied icon in the sampled source color `#072efe`. Keep custom banner art on the existing theme-gradient path. Carry the two model line counts from `FileDiff.diffStat` through OpenTUI's structured result event and render them in the action row. Ink reads the same fields directly from its existing `FileDiff` result. Omit counts when they are missing or the action did not succeed.

This reuses existing banner and file-diff data paths. Embedding terminal image protocols would not work consistently across supported terminals; exposing all diff statistics would add detail beyond the requested line counts.

## Validation

Run the focused Ink and OpenTUI banner, event-adapter, transcript, and tool-message tests; run CLI type checking, lint, build, and bundle. Verify the built CLI with `node dist/cli.js --version`. Do not make a live model request.

## Acceptance

Both terminal backends display the blue icon and `Engineering Edition`; custom branding still works; successful file edits show `(+N)(-N)` with green and red counts; local CLI tests and build pass.
