# Skills

[![skills.sh](https://skills.sh/b/hewel/skills)](https://skills.sh/hewel/skills)

Personal repository for agent skills.

## Installation

Install this skill collection with the `skills` CLI:

```bash
npx skills add hewel/skills
```

To opt out of skills.sh telemetry for the install command:

```bash
DISABLE_TELEMETRY=1 npx skills add hewel/skills
```

## Available Skills

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
