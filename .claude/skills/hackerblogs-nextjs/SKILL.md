---
name: hackerblogs-nextjs
description: Project conventions for this repo's Next.js 16.4 App Router + React 19.3 + TypeScript + Tailwind v4 stack with Cache Components and Partial Prefetching enabled. Use whenever writing, editing, or reviewing any page, layout, component, route handler, server action, data fetching, caching, styling, or config in this repo, and to pick which of the other frontend skills applies.
---

# hackerblogs Next.js conventions

Your training data predates this stack. The installed docs at
`node_modules/next/dist/docs/` are the source of truth. When this file,
another skill, or your memory disagrees with them, **the bundled docs win**.
Read the relevant doc before writing code; the paths below are relative to
`node_modules/next/dist/docs/01-app/`.

## Stack

| Thing | Value |
| --- | --- |
| Framework | `next@16.4.5`, App Router only (`app/`), Turbopack |
| React | `19.3` (no `forwardRef`; `ref` is a prop; `use()`, `useActionState`) |
| Flags | `cacheComponents: true`, `partialPrefetching: true` in `next.config.ts` |
| Styling | Tailwind v4, CSS-first. Loaded by the `@tailwindcss/turbopack` loader in `next.config.ts` (no `postcss.config`, no `tailwind.config.*`). Tokens live in `@theme inline` + CSS variables in `app/globals.css`. Dark mode is class-based (`.dark`) |
| UI kit | shadcn/ui (`components.json`: style `radix-nova`, Radix via the `radix-ui` package, `lucide-react` icons). Components in `components/ui/`, `cn` from `@/lib/utils`. Add with `bunx --bun shadcn@latest add <name>`; follow the `shadcn` skill |
| Package manager | Bun (`bun install`, `bun run <script>`, `bunx <bin>`). Translate `pnpm`/`npm` examples from docs and skills |
| Imports | `@/*` maps to the repo root |
| Lint | ESLint 9 flat config (`eslint.config.mjs`); `next lint` no longer exists |

## Rendering model: Cache Components

Read `01-getting-started/08-caching.md` before touching data fetching.

- Every route prerenders a **static shell**. Anything that is uncached or
  request-specific must either be cached or sit inside `<Suspense>`:
  - Runtime APIs: `cookies()`, `headers()`, `searchParams`, `params`,
    `connection()`, plus uncached `fetch`/DB calls. Wrap the reading
    component in `<Suspense fallback={…}>`. Push the read as deep as possible
    so the shell keeps the useful UI.
  - Shared data: `'use cache'` at the top of the function or component body,
    **always** paired with `cacheLife(...)`, and `cacheTag(...)` when it needs
    on-demand invalidation. Imports come from `next/cache` with no `unstable_` prefix.
  - Cookie/header-dependent data with a known lifetime: `'use cache: private'`.
    Durable cross-instance cache: `'use cache: remote'`.
  - `new Date()`, `Math.random()`, `crypto.randomUUID()`: capture inside
    `'use cache'`, or call `await io()` (from `next/cache`) first to keep it
    request-time.
- **Removed** segment configs under Cache Components: `dynamic`, `revalidate`,
  `fetchCache`, `dynamicParams`, `runtime`. Don't add them. Available instead:
  `instant`, `prefetch`, `ensureStatic`, `maxDuration`, `preferredRegion`
  (`03-api-reference/03-file-conventions/02-route-segment-config/`).
- `export const instant = false` is the **last resort** opt-out, not a fix.
- Don't use `unstable_cache`, `unstable_noStore`, or module-level LRU maps for
  cross-request caching. Use `'use cache'`. `React.cache()` is still fine for
  per-request deduplication.
- When the dev overlay or build prints a blocking-route insight, follow its
  `[stream] / [cache] / [block]` options and read the linked
  `nextjs.org/docs/messages/...` page. Debug builds with
  `bunx next build --debug-prerender`.

## Mutations

Read `01-getting-started/07-mutating-data.md` and `02-guides/server-actions.md`.

- Use Server Actions (`'use server'`). **Authenticate and authorize inside every
  action**, because actions are public endpoints.
- `updateTag(tag)`: read-your-writes, Server Actions only. Use it for forms and settings.
- `revalidateTag(tag, 'max')`: the second argument is **required** in v16. It is
  stale-while-revalidate, suited to content like posts.
- `refresh()` (`next/cache`) re-renders the client router from an action.

## Routing and files

- `params` and `searchParams` are **Promises**. `await` them in Server Components
  or `use()` them in Client Components.
- Use the global typed helpers with no import: `PageProps<'/blog/[slug]'>`,
  `LayoutProps<'/'>`, `RouteContext<'/api/x'>`. Run `bunx next typegen` to refresh them.
- `proxy.ts` with `export function proxy()` replaces `middleware.ts`. It runs on
  Node only.
- Parallel route slots need an explicit `default.tsx`, or the build fails.
- Error boundaries: `error.tsx` per segment, or `catchError` from `next/error`
  for component-level boundaries.
- Metadata: `metadata` / `generateMetadata` (`01-getting-started/14-metadata-and-og-images.md`).

## Navigation and prefetching (Partial Prefetching)

- Plain `<Link href>` prefetches the destination's shared **App Shell**. This is the default; keep it.
- `prefetch={true}` adds cached URL-specific content per link. Use it only
  deliberately (`02-guides/optimizing-prefetching.md`). `prefetch={false}`
  disables prefetching.
- Instant-navigation background: `02-guides/instant-navigation.md`.

## Components

- Server Components are the default. Put `'use client'` on the **smallest leaf**
  that needs state, effects, or browser APIs. Pass Server Components as
  `children` into client wrappers rather than importing them.
- Keep secrets and DB access in server-only modules (`import 'server-only'`).
  Only serializable props cross the boundary, so pass minimal data.
- `next/image`: `priority` is **deprecated**. Use `preload`, or usually
  `loading="eager"` / `fetchPriority="high"` for the LCP image. Always set
  `alt` and dimensions (or `fill` + `sizes`).
- `next/font` for fonts. They are exposed as CSS variables wired into `@theme`.

## TypeScript

- `strict` is on. No `any`, no non-null `!` to silence errors, no `@ts-ignore`.
  Narrow with type guards; use `satisfies` for config objects.
- Type props inline or with a local `type Props`. Prefer the generated route
  helpers over hand-written `params` types.

## Verify before claiming done

```bash
bun run lint
bunx next typegen && bunx tsc --noEmit
bun run build        # catches prerender/Suspense errors dev may only warn about
```

For runtime verification against `next dev`, use the `next-dev-loop` skill.
Don't delete `.next` while `next dev` is running. If a dev server is already up
(`.next/dev/lock`), reuse it.

## Which skill for what

| Task | Skill |
| --- | --- |
| Verify a change works in the running app | `next-dev-loop` |
| A route's first paint or navigation isn't instant; grow the static shell | `next-cache-components-optimizer` |
| Control what a specific `<Link>` prefetches | `next-partial-prefetching-optimizer` |
| Client bundle too big or slow initial load | `next-bundle-optimizer` |
| Writing/reviewing React for performance | `vercel-react-best-practices` |
| Component API design (compound components, boolean-prop sprawl) | `vercel-composition-patterns` |
| Page/shared-element animations | `vercel-react-view-transitions` (Next guide: `02-guides/view-transitions.md`) |
| Adding, composing, or styling UI components | `shadcn` |
| Visual direction for new UI | `frontend-design` |
| Accessibility/UX audit of UI code | `web-design-guidelines` |

Known conflicts, resolved:

- `vercel-react-best-practices` → `server-cache-lru`: use `'use cache'` here instead.
- `vercel-react-best-practices` → `client-swr-dedup`: prefer server data
  fetching plus Suspense. Use SWR only for truly client-driven data.
- `web-design-guidelines` says Title Case and `frontend-design` says sentence
  case. Match whatever the existing UI already uses.
- `frontend-design` asks for a distinctive palette and type, while `shadcn` forbids
  raw colors and `dark:` overrides. Express the design through the shadcn
  CSS variables and `cva` variants in `app/globals.css` / `components/ui/`,
  not through one-off utility colors.
