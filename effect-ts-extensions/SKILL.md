---
name: effect-ts-extensions
description: Use with the base effect-ts skill for generic Effect TypeScript code. Adds compact, project-agnostic rules for language-service checks, typed failures, schema boundaries, unsafe TypeScript cleanup, Effect.fn workflows, Option handling, Exit/runtime boundaries, fallback placement, logging, config, and review. Do not use for React/effect-atom, Tauri, TanStack Router, RPC, HTTP platform APIs, Glim, JMSR, framework-specific, package-install, or library-specific guidance.
---

# Effect TypeScript Extensions

This extends the base `effect-ts` skill. It is not the source of truth for API details, package versions, services, layers, testing setup, or exact Effect semantics. Use the base skill for those decisions. If this skill conflicts with the base skill, follow the base skill and ask before changing this one.

## Language Service

For substantial Effect work, check whether the repo has Effect language-service support before treating plain TypeScript diagnostics as complete.

Look for `@effect/language-service`, a `tsconfig.json` plugin entry, and editor/workspace settings that use the workspace TypeScript version. It catches Effect-specific mistakes such as floating Effects, missing requirements, bad generator/yield usage, and confusing Success/Error/Requirements parameters.

If setup is missing, mention it. Do not edit package manifests or TypeScript config unless the task includes tooling changes. When enabling it, use the repo package manager and version policy, add:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "@effect/language-service" }]
  }
}
```

Then make sure the editor uses workspace TypeScript. Check current docs or the base `effect-ts` skill before adding CI/build-time diagnostics.

## Core Rules

- Keep recoverable failures in the Effect error channel until an outer boundary translates them.
- Use `Effect.fail` for expected failures, `Effect.try` for throwing sync APIs, and `Effect.tryPromise` for rejecting Promise APIs.
- Use `Effect.catchTag` / `Effect.catchTags` when recovery or translation depends on a specific error.
- Use `Effect.fn` for named reusable workflows; keep small local compositions as plain `Effect.gen` when a stable name adds no value.
- Decode untrusted values with `Schema.decodeUnknown` or explicit narrowers before treating them as domain data.
- Use `Option` for meaningful absence; avoid `Option.getOrThrow`.
- Avoid recoverable `throw new Error(...)`, catch-and-rethrow paths, raw workflow `try/catch`, fake success fallback objects, unsafe `as`, double assertions, and `any`.
- Do not hide `Effect.runPromise`, `Effect.runSync`, or runtime creation inside low-level modules.

## Typed Failures

Prefer specific, named errors over generic catch-all errors. Good errors describe what failed and what recovery is possible.

Name errors by condition, for example `{Entity}NotFoundError`, `{Entity}{Action}Error`, `Invalid{Field}Error`, `{Integration}UnavailableError`, `{Capability}UnsupportedError`, or `{Operation}TimeoutError`.

Include useful structured context: relevant IDs, invalid fields when safe, retryability when callers can retry, a `message`, and safe cause details. Do not collapse distinct recoverable failures into generic `NotFoundError`, `BadRequestError`, or `InternalError` until a boundary intentionally hides details and no caller can recover by type.

Use `catchAll` only when intentionally handling the whole error union. Avoid `mapError` when remapping depends on tags or context. Avoid `Effect.orDie` for expected failures; reserve it for defects, impossible states, test setup, or after real recovery has been exhausted.

## Boundaries And Data

Decode or narrow external data from JSON, persistence, environment/config, command or process output, network/file contents, and values crossing module boundaries as `unknown`.

Prefer schemas for reusable domain shapes that cross boundaries or need encoding/decoding. Plain TypeScript is fine for local pure helpers that never parse external data.

Brand IDs only when mixing two identifiers would be a real bug. Do not brand every string by default.

Keep fallback defaults at the boundary. Core workflows should report failure or absence explicitly instead of fabricating success-shaped data.

It is fine to return domain-valid empty success values, such as empty collections or pages, when the operation actually succeeded. Do not use those shapes to hide failures or missing required data.

## Runtime Shape

Low-level modules should describe work as `Effect.Effect<Success, Error, Requirements>` and let outer boundaries run it. Boundaries include CLIs, request handlers, UI events, job runners, process entrypoints, and tests.

At the boundary, inspect the result and translate it into the host model: return a response, render state, log and exit, throw only when the host requires throwing, or convert unrecoverable defects into process failure.

Prefer explicit `Exit` handling or a small boundary helper for fallback pipelines, such as `runWorkflow().then(defaultTo(fallback))`. Keep the fallback helper at the boundary so core workflows still expose typed failures and absence.

Do not switch between Effect and Promise chains mid-workflow. Compose inside Effect, then run once at the edge.

## Observability And Environment

Inside Effect workflows, prefer Effect facilities:

- `Effect.log*` with structured safe fields instead of `console.log`
- `Config.*` instead of direct environment access
- `Config.redacted` for sensitive values
- `Clock` for time-dependent workflow logic that should be testable
- `Ref` for mutable state inside concurrent workflows

Do not log secrets, tokens, personal data, full payloads, or raw unknown errors without sanitizing them.

## Refactor Checklist

When converting TypeScript to Effect:

1. Classify code as pure helper, workflow, adapter, or boundary.
2. Keep pure non-fallible helpers plain.
3. Convert recoverable failures to typed `Effect.fail`.
4. Wrap throwing/rejecting APIs with `Effect.try` / `Effect.tryPromise`.
5. Decode unknown inputs before use.
6. Model absence with `Option` or schema optionality.
7. Compose reusable workflows with `Effect.fn` and `Effect.gen`.
8. Handle errors only at recovery or translation points.
9. Run the final Effect at the outer boundary.
10. Translate `Exit` or typed errors into the host model at that boundary.
11. Add or update success and failure tests when behavior changes.

## Review Checklist

- [ ] Substantial Effect work checked or noted language-service setup.
- [ ] Expected failures are typed and specific.
- [ ] No recoverable workflow path throws `new Error(...)`.
- [ ] Throwing/rejecting APIs are wrapped.
- [ ] Unknown external data is decoded or narrowed.
- [ ] Optional values are explicit.
- [ ] Fallback defaults live at the boundary, not inside core workflows.
- [ ] Error handling preserves useful variants until a real boundary.
- [ ] `catchAll`, `mapError`, and `orDie` do not erase recoverable information.
- [ ] Effects run at an outer boundary, not in low-level modules.
- [ ] No new `any`, unsafe `as`, double assertions, or fake fallback data.
- [ ] Logs and config use Effect facilities inside Effect code.
