# Agent skills

Project-scoped [Agent Skills](https://docs.claude.com/en/docs/claude-code/skills) for this repo.
Claude Code loads them automatically from `.claude/skills/<name>/SKILL.md`.

Framework knowledge comes from the version-matched docs in
`node_modules/next/dist/docs/`, which `AGENTS.md` points to. These skills cover
project conventions and multi-step workflows on top of that.

| Skill | Source | Pinned commit | License |
| --- | --- | --- | --- |
| `hackerblogs-nextjs` | This repo | — | — |
| `next-dev-loop` | [vercel/next.js `skills/`](https://github.com/vercel/next.js/tree/canary/skills) | `2604659` (2026-11-06) | MIT |
| `next-bundle-optimizer` | vercel/next.js `skills/` | `2604659` | MIT |
| `next-cache-components-optimizer` | vercel/next.js `skills/` | `2604659` | MIT |
| `next-partial-prefetching-optimizer` | vercel/next.js `skills/` | `2604659` | MIT |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/react-best-practices` | `1a2c79d` (2026-10-27) | MIT |
| `vercel-composition-patterns` | vercel-labs/agent-skills `skills/composition-patterns` | `1a2c79d` | MIT |
| `vercel-react-view-transitions` | vercel-labs/agent-skills `skills/react-view-transitions` | `1a2c79d` | MIT |
| `web-design-guidelines` | vercel-labs/agent-skills + [web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | `434b7f9` (2026-10-05) | MIT |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` | `2c5958e` (2026-11-06) | Apache-2.0 |

Third-party skills are vendored unmodified, with one exception:
`web-design-guidelines` reads a pinned local `guidelines.md` instead of
fetching the rules from GitHub `main` at runtime.

Not vendored: `next-cache-components-adoption` and
`next-partial-prefetching-adoption`. Both flags were on from project creation,
so there is nothing to migrate.

## Updating

Re-copy the skill directory from upstream, review the diff, and update the
commit in the table. Skills are instructions the agent follows, so review them
like code.
