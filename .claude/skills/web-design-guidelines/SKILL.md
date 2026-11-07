---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance (accessibility, focus, forms, animation, typography, images, performance, dark mode, i18n, hydration). Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
argument-hint: <file-or-pattern>
metadata:
  author: vercel
  version: "1.0.0"
---

# Web Interface Guidelines

Review files for compliance with Vercel's Web Interface Guidelines.

## How It Works

1. Read the pinned rules in [guidelines.md](guidelines.md) (this directory).
2. Read the specified files, or ask the user for files/pattern if none were given.
3. Check against every rule in `guidelines.md`.
4. Output findings in the terse `file:line` format that `guidelines.md` specifies.

## Pinned source

The upstream skill fetches `command.md` from the `main` branch on every run.
This repo pins a reviewed copy instead, so reviews are reproducible and no
remote content is loaded as instructions.

- Upstream: https://github.com/vercel-labs/web-interface-guidelines (`command.md`)
- Pinned commit: `434b7f91364665f2f733b310ec54809bf8f37937` (2026-10-05)

To update, re-copy `command.md` to `guidelines.md`, review the diff, and bump the commit above.
