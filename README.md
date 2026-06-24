# Skills

[![skills.sh](https://skills.sh/b/hewel/skills)](https://skills.sh/hewel/skills)

Personal repository for agent skills.

### Per-skill installation

| Skill | Install | Page |
| --- | --- | --- |
| `solidjs` | `npx skills add hewel/skills --skill solidjs` | [skills.sh/hewel/skills/solidjs](https://skills.sh/hewel/skills/solidjs) |
| `effect-ts-extensions` | `npx skills add hewel/skills --skill effect-ts-extensions` | [skills.sh/hewel/skills/effect-ts-extensions](https://skills.sh/hewel/skills/effect-ts-extensions) |
| `execute` | `npx skills add hewel/skills --skill execute` | [skills.sh/hewel/skills/execute](https://skills.sh/hewel/skills/execute) |
| `debug-browser-traces` | `npx skills add hewel/skills --skill debug-browser-traces` | [skills.sh/hewel/skills/debug-browser-traces](https://skills.sh/hewel/skills/debug-browser-traces) |

## Available Skills

### `solidjs`

Generic SolidJS frontend guidance extracted from JMSR's reusable conventions.
It covers Solid primitives, `classList`, JSX ownership, context boundaries,
portal targets, component APIs, and async UI fallbacks.

### `effect-ts-extensions`

Generic Effect TypeScript coding guidance that extends the base `effect-ts`
skill. It adds compact rules for:

- Effect language-service checks
- typed recoverable failures
- schema-driven external boundaries
- unsafe TypeScript cleanup
- `Effect.fn` workflow shape
- `Option` handling
- runtime boundary discipline
- Effect logging and config usage

Use it with the base `effect-ts` skill. The base skill remains authoritative for
API details, package versions, services, layers, testing setup, source lookup,
and exact Effect semantics.

This skill intentionally excludes project, framework, and library-specific
guidance such as JMSR, Glim, Tauri, TanStack Router, React/effect-atom, RPC, and
HTTP platform APIs.

### `execute`

Tracker-backed issue execution for GitHub, GitLab, and repo-local tracker tools
such as Plane. It keeps acceptance criteria as the TDD execution and tracker
progress unit while committing cohesive logical code units.

### `debug-browser-traces`

Browser trace debugging for Chrome trace-event JSON, DevTools/WebKit recordings,
HAR exports, screenshots, console logs, and before/after comparisons. It
includes a Node analyzer that normalizes timing, request order, visual evidence,
and noisy render signals into a concise bug narrative.
