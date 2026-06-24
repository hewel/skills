# Browser Trace Formats

Use this reference when `scripts/analyze-browser-trace.mjs` reports an unknown or partial format.

## Supported Inputs

- Chromium trace-event JSON: top-level `traceEvents`. Timestamps are usually microseconds in `ts`, durations in `dur`. Embedded screenshots often appear as `Screenshot` events with `args.snapshot`.
- DevTools/WebKit/Tauri performance recording: top-level `recording.records`. Records have typed entries such as `timeline-record-type-network`, `timeline-record-type-script`, `timeline-record-type-layout`, and `timeline-record-type-rendering-frame`. Some network records carry HAR-like entries but no comparable `startTime`; in that case record order is evidence, not precise time.
- HAR: top-level `log.entries`. Request and response timings come from `startedDateTime` and `time`.
- Console sidecars: pass with `--console`. JSON arrays, objects with `logs` or `entries`, NDJSON, and plain text are accepted.
- DOM sidecars: pass with `--dom`. HTML, JSON, and text snapshots are treated as evidence that DOM state was captured; use `--focus` to test for relevant terms.
- Visual sidecars: pass screenshots or recording files with `--visual`. Directories are scanned one level for `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.mp4`, `.webm`, and `.mov`.

## Interpretation Rules

- Do not merge timestamp models silently. If one lane uses relative trace time and another uses record index or epoch time, call out the weaker ordering.
- Screenshots or DOM snapshots decide whether a network race was user-visible. Without visual evidence, describe UI impact as an inference.
- Console logs and app semantics are optional evidence, not guaranteed trace data. If the capture lacks them, avoid claiming the user's intended action beyond what navigation, input, request, render, or screenshot events show.
- Repeated endpoint names are app semantics, not enough diagnosis by themselves. Use request order, response order, route markers, and visible state together.
- A long frame or layout burst is a lead only when it overlaps the wrong visual state or blocked input. Otherwise keep it in `Noise discounted`.
- For stale-response bugs, look for an older request that finishes after a newer request for the same logical resource, especially across route, filter, page, sort, or library changes.
- Before/after comparison is strongest when both captures have the same evidence lanes. If one side lacks network timing, screenshots, DOM, or console evidence, treat disappeared anomalies as a lead rather than proof.
