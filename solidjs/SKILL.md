---
name: solidjs
description: Use this skill when writing or reviewing SolidJS components, signals, resources, context APIs, JSX ownership, portals, conditional classes, or when migrating React-style code to Solid. Apply it for Solid-specific frontend code even when the user only says "frontend", ".tsx component", "signal", "resource", "classList", "Portal", or asks why React hooks/patterns are not working in Solid.
---

# SolidJS

Use Solid primitives and rendering semantics instead of React patterns. Solid updates through fine-grained reactivity; component bodies are setup code, not repeated render functions.

## Reactivity

- Use `createSignal`, `createMemo`, `createEffect`, `createResource`, and stores where they fit the data shape.
- Do not use React hooks such as `useState` or `useEffect`.
- Read signals by calling accessors, for example `count()`, inside JSX or reactive scopes.
- Keep derived values in `createMemo` when they are reused or expensive enough to name.
- Use `createResource` for async data that belongs to the component/reactive lifecycle.
- Avoid copying props into signals unless local editable state is actually needed.

## JSX Ownership

Do not store or pass fully instantiated JSX elements as dynamic state through signals or context. This hides ownership and makes rendering harder to reason about.

Prefer one of these patterns:

- pass data, IDs, component functions, or render callbacks
- expose DOM mount targets through refs when a parent layout owns placement
- render controls declaratively from child templates
- use Solid's `<Portal>` when content must mount outside the local DOM position

For context APIs, expose state, actions, refs, or target elements. Avoid context values such as `{ view: <Panel /> }` or signals containing JSX elements to render somewhere else.

## Classes And Styling

- Keep `class` for static class strings.
- Use `classList` for conditional classes so Solid can update individual class tokens efficiently.
- Avoid building dynamic class strings when `classList` is clearer.

Example:

```tsx
<button
  class="inline-flex items-center"
  classList={{
    active: selected(),
    disabled: disabled(),
  }}
>
  Save
</button>
```

Do not import another component's private style exports directly. Consume the component API, move shared behavior into a shared component, or extract shared styling intentionally.

## Component Boundaries

- Keep page-level orchestration separate from reusable components.
- Put reusable controls behind explicit props and callbacks.
- Do not make a parent render child-owned JSX by passing element instances through state.
- Prefer stable component APIs over reaching into another component's implementation details.
- Keep side effects at lifecycle or reactive boundaries, not inline in JSX expressions.

## Async UI

When data sources have different latency or criticality:

- render the useful fast state first
- put slow or non-critical values behind `<Suspense>` or another stable fallback
- keep fallback UI dimensions stable enough that loading does not shift layout unnecessarily

Do not block an entire screen on slow data if a useful partial view can render safely.

## Review Checklist

- [ ] Solid primitives are used instead of React hooks.
- [ ] Signal accessors are called where values are read.
- [ ] Derived state is not duplicated unnecessarily.
- [ ] Async component data uses `createResource` or an established local Solid data pattern.
- [ ] Conditional classes use `classList` instead of fragile dynamic class strings.
- [ ] JSX element instances are not stored in signals or context.
- [ ] Portal or ref-based mount targets are used when layout ownership crosses component boundaries.
- [ ] Reusable components expose stable props/callbacks instead of private styling or implementation details.
- [ ] Slow data does not block useful first render when a safe fallback can be shown.
