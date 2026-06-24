# Browser Trace Formats

Use this reference when `scripts/analyze-browser-trace.mjs` reports an unknown or partial format.

## Supported Inputs

- Chromium trace-event JSON: top-level `traceEvents`. Timestamps are usually microseconds in `ts`, durations in `dur`. Embedded screenshots often appear as `Screenshot` events with `args.snapshot`.
- DevTools/WebKit/Tauri performance recording: top-level `recording.records`. Records have typed entries such as `timeline-record-type-network`, `timeline-record-type-script`, `timeline-record-type-layout`, and `timeline-record-type-rendering-frame`. Some network records carry HAR-like entries but no comparable `startTime`; in that case record order is evidence, not precise time.
- HAR: top-level `log.entries`. Request and response timings come from `startedDateTime` and `time`.
- Plain console-log JSON is only partially supported. Prefer converting logs to lines with timestamps or pairing them with a trace.

## Interpretation Rules

- Do not merge timestamp models silently. If one lane uses relative trace time and another uses record index or epoch time, call out the weaker ordering.
- Screenshots or DOM snapshots decide whether a network race was user-visible. Without visual evidence, describe UI impact as an inference.
- Repeated endpoint names are app semantics, not enough diagnosis by themselves. Use request order, response order, route markers, and visible state together.
- A long frame or layout burst is a lead only when it overlaps the wrong visual state or blocked input. Otherwise keep it in `Noise discounted`.
- For stale-response bugs, look for an older request that finishes after a newer request for the same logical resource, especially across route, filter, page, sort, or library changes.
