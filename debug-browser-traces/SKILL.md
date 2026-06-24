---
name: debug-browser-traces
description: Browser trace debugging for Chrome trace-event JSON, DevTools/WebKit performance recordings, HAR exports, screenshots, console logs, and before/after trace comparisons. Use when Codex needs to analyze browser recordings, reconstruct user-action timelines, normalize mixed timestamp formats, identify network ordering or stale-response races, check whether visual evidence exists, or turn noisy browser trace data into a concise bug narrative.
---

# Debug Browser Traces

Use this skill to turn browser trace artifacts into a causal narrative, not a raw event dump.

## Workflow

1. Collect every artifact the user named: trace JSON, HAR, screenshots, DOM snapshots, console logs, and before/after captures. If only a trace is available, continue and mark missing visual or semantic evidence explicitly.

2. Run the analyzer before reading large trace files manually:

```bash
node <skill-dir>/scripts/analyze-browser-trace.mjs <trace-or-har.json> [more files]
```

Use `--focus <regex>` for app terms such as route names, endpoint names, library ids, page numbers, or component names. Add sidecar evidence with `--console <file>`, `--dom <file>`, and `--visual <file-or-dir>` when the user provides logs, DOM snapshots, screenshots, or recordings. Use `--screenshots-dir <dir>` when the trace has embedded Chromium screenshots and the visual state matters.

Completion criterion: the analyzer output names the detected format, evidence quality, timing confidence, visual evidence, network order, and top anomalies for each artifact.

3. Build the timeline around user-visible phases: navigation or route switch, user input, request dispatch, response completion, render/paint/screenshot, and console errors. Prefer relative times from the analyzer. When timestamps are missing or not comparable, say the ordering is record-order only.

Completion criterion: each major claim has a trace-backed event, screenshot, console line, or an explicit "not captured" caveat.

4. Diagnose ordering before performance noise. Look first for stale-response races, duplicated requests, missing cancellation, request/route mismatch, HTTP errors, absent visual evidence, and console failures. Treat long tasks, layout, paint, and CPU spikes as secondary unless they line up with the visible failure.

Completion criterion: the final explanation separates likely causes from distracting trace noise.

5. If comparing before/after traces, run the analyzer on all files in one command and compare the same signals: route markers, request signatures, response order, status failures, screenshots, and console errors. State what disappeared, what stayed, and what the trace still cannot prove.

Completion criterion: the before/after claim is tied to a repeated pattern, not just a smaller event count.

## Limits

- State missing visual evidence plainly. Without screenshots, DOM snapshots, console logs, or a paired screen recording, visual bugs are inferred from event order rather than proven.
- Treat non-comparable DevTools network timestamps as record-order evidence only. Do not convert record order into precise millisecond claims.
- Use `--focus <regex>` for long recordings. A narrow repro is stronger than a broad capture full of framework internals, image loads, layout, paint, and long-task noise.
- For before/after validation, prefer comparable captures that show the same bad pattern disappearing. A single trace that looks quieter is weak evidence.

## Capture Checklist

Prefer a narrow repro with: trace JSON, HAR when available, console log export, screenshots or screen recording, and DOM snapshot near the wrong UI state. Missing lanes are acceptable, but the final diagnosis must follow the analyzer's evidence quality label.

## Output Shape

Answer with:

- `Narrative`: a short sequence of what the user likely did and what the app did in response.
- `Evidence`: the minimal trace facts that support the narrative, with relative times or record-order caveats.
- `Likely bug`: the most plausible failure mode and why.
- `Noise discounted`: scary-looking trace signals that are probably unrelated.
- `Next check`: the smallest code, test, or capture that would confirm the diagnosis.

## Reference

Read [references/formats.md](references/formats.md) only when the analyzer output is ambiguous, a new trace shape appears, or you need to extend the script.
