#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptName = path.basename(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const opts = {
    files: [],
    focus: null,
    limit: 24,
    json: false,
    screenshotsDir: null,
    screenshotsMax: 12,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--focus") opts.focus = new RegExp(argv[++i], "i");
    else if (arg === "--limit") opts.limit = Number(argv[++i]);
    else if (arg === "--screenshots-dir") opts.screenshotsDir = argv[++i];
    else if (arg === "--screenshots-max") opts.screenshotsMax = Number(argv[++i]);
    else if (arg === "-h" || arg === "--help") usage(0);
    else opts.files.push(arg);
  }

  if (opts.files.length === 0) usage(1);
  return opts;
}

function usage(code) {
  const out = code === 0 ? console.log : console.error;
  out(`Usage: node ${scriptName} [--focus <regex>] [--limit N] [--json] [--screenshots-dir DIR] <trace.json> [more.json]`);
  process.exit(code);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${file}: ${error.message}`);
  }
}

function safeUrl(raw) {
  if (!raw || typeof raw !== "string") return null;
  try {
    return new URL(raw);
  } catch {
    try {
      return new URL(raw, "http://local.invalid");
    } catch {
      return null;
    }
  }
}

function requestSignature(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return rawUrl || "(unknown)";
  const pathname = parsed.protocol === "ipc:" ? parsed.hostname + parsed.pathname : parsed.pathname;
  const semanticParams = [];
  for (const key of ["libraryId", "parentId", "page", "startIndex", "limit", "pageSize", "sort", "sortDirection", "filter", "playedFilter"]) {
    if (parsed.searchParams.has(key)) semanticParams.push(`${key}=${parsed.searchParams.get(key)}`);
  }
  return semanticParams.length > 0 ? `${pathname}?${semanticParams.join("&")}` : pathname;
}

function logicalResource(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return rawUrl || "(unknown)";
  return parsed.protocol === "ipc:" ? parsed.hostname + parsed.pathname : parsed.pathname;
}

function shortUrl(rawUrl) {
  if (!rawUrl) return "(unknown)";
  const parsed = safeUrl(rawUrl);
  if (!parsed) return rawUrl.slice(0, 140);
  if (parsed.protocol === "ipc:") {
    return `ipc://${parsed.hostname}${parsed.pathname}${parsed.search}`.slice(0, 160);
  }
  return `${parsed.origin}${parsed.pathname}${parsed.search}`.slice(0, 180);
}

function ms(value) {
  if (!Number.isFinite(value)) return null;
  return value;
}

function fmtMs(value) {
  if (!Number.isFinite(value)) return "?";
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value.toFixed(1)}ms`;
}

function formatRel(item) {
  if (Number.isFinite(item.t)) return `+${fmtMs(item.t)}`;
  if (Number.isFinite(item.index)) return `#${item.index}`;
  return "+?";
}

function detectFormat(data) {
  if (Array.isArray(data.traceEvents)) return "chromium-trace";
  if (data.recording && Array.isArray(data.recording.records)) return "devtools-recording";
  if (data.log && Array.isArray(data.log.entries)) return "har";
  if (Array.isArray(data)) return "json-array";
  return "unknown-json";
}

function baseSummary(file, data, format) {
  const stat = fs.statSync(file);
  return {
    file,
    bytes: stat.size,
    format,
    counts: {},
    warnings: [],
    timing: "unknown",
    durationMs: null,
    navigation: [],
    network: [],
    visual: [],
    script: [],
    render: [],
    focusHits: [],
    anomalies: [],
    extractedScreenshots: [],
  };
}

function analyzeFile(file, opts) {
  const data = readJson(file);
  const format = detectFormat(data);
  const result = baseSummary(file, data, format);

  if (format === "chromium-trace") analyzeChromiumTrace(data, result, opts);
  else if (format === "devtools-recording") analyzeDevtoolsRecording(data, result, opts);
  else if (format === "har") analyzeHar(data, result);
  else {
    result.warnings.push("Unsupported JSON shape. Expected traceEvents, recording.records, or log.entries.");
  }

  findNetworkAnomalies(result);
  sortAndLimit(result, opts.limit);
  return result;
}

function analyzeChromiumTrace(data, result, opts) {
  const events = data.traceEvents;
  result.counts.events = events.length;
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (!Number.isFinite(event.ts)) continue;
    if (event.ts === 0 && event.cat === "__metadata") continue;
    minTs = Math.min(minTs, event.ts);
  }
  if (!Number.isFinite(minTs)) minTs = 0;
  for (const event of events) {
    if (!Number.isFinite(event.ts) || event.ts < minTs) continue;
    maxTs = Math.max(maxTs, event.ts + (event.dur || 0));
  }
  if (!Number.isFinite(maxTs)) maxTs = minTs;
  result.timing = "trace ts/dur in microseconds, normalized to first event";
  result.durationMs = (maxTs - minTs) / 1000;

  const nameCounts = new Map();
  for (const event of events) {
    nameCounts.set(event.name || "(unnamed)", (nameCounts.get(event.name || "(unnamed)") || 0) + 1);
  }
  result.counts.topNames = [...nameCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  let screenshotWritten = 0;
  const chromeRequests = new Map();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const name = event.name || "";
    const args = event.args || {};
    const dataArg = args.data || {};
    const t = Number.isFinite(event.ts) ? (event.ts - minTs) / 1000 : null;
    const dur = Number.isFinite(event.dur) ? event.dur / 1000 : 0;
    const blob = `${name} ${event.cat || ""} ${JSON.stringify(args).slice(0, 2000)}`;

    if (name === "TracingStartedInBrowser" && Array.isArray(dataArg.frames)) {
      for (const frame of dataArg.frames) {
        if (frame.url) result.navigation.push({ t, label: "initial frame", detail: frame.url, index });
      }
    }

    if (/Navigation|SoftNavigation|CommitLoad|MarkLoad|DOMContentLoaded|firstContentfulPaint|largestContentfulPaint/i.test(name)) {
      result.navigation.push({ t, label: name, detail: extractEventDetail(event), index });
    }

    if (/ResourceWillSendRequest|ResourceSendRequest|ResourceReceiveResponse|ResourceFinish|ResourceReceivedData|XHR|Fetch|WebSocket/i.test(name)) {
      const url = dataArg.url || dataArg.request?.url || args.url || dataArg.requestURL;
      const requestId = dataArg.requestId || url || `${name}:${index}`;
      const current = chromeRequests.get(requestId) || { index, t: null, end: null, duration: null, method: "", status: null, url: null, encodedBytes: 0 };
      current.index = Math.min(current.index, index);
      if (url) current.url = url;
      if (dataArg.requestMethod || dataArg.method) current.method = dataArg.requestMethod || dataArg.method;
      if (Number.isFinite(dataArg.statusCode) || Number.isFinite(dataArg.status)) current.status = dataArg.statusCode || dataArg.status;
      if (Number.isFinite(dataArg.encodedDataLength)) current.encodedBytes += dataArg.encodedDataLength;
      if (/SendRequest|WillSendRequest|XHR|Fetch|WebSocket/.test(name) && Number.isFinite(t) && !Number.isFinite(current.t)) {
        current.t = t;
      }
      if (/Finish|ReceiveResponse/.test(name) && Number.isFinite(t)) current.end = Math.max(current.end ?? t, t);
      chromeRequests.set(requestId, current);
    }

    if (name === "Screenshot") {
      const hasSnapshot = typeof args.snapshot === "string" && args.snapshot.length > 0;
      result.visual.push({ t, label: "Screenshot", detail: hasSnapshot ? "embedded JPEG snapshot" : "no snapshot payload", index });
      if (opts.screenshotsDir && hasSnapshot && screenshotWritten < opts.screenshotsMax) {
        fs.mkdirSync(opts.screenshotsDir, { recursive: true });
        const out = path.join(opts.screenshotsDir, `${path.basename(result.file).replace(/[^a-z0-9_.-]/gi, "_")}-${String(screenshotWritten + 1).padStart(3, "0")}.jpg`);
        fs.writeFileSync(out, Buffer.from(args.snapshot, "base64"));
        result.extractedScreenshots.push(out);
        screenshotWritten += 1;
      }
    }

    if (/EventDispatch|InputLatency|FunctionCall|TimerFire|RequestAnimationFrame|FireAnimationFrame/i.test(name)) {
      const fn = dataArg.functionName || dataArg.type || dataArg.url || "";
      if (dur >= 8 || /click|keydown|pointer|mouse|input|submit/i.test(fn + name)) {
        result.script.push({ t, duration: dur, label: name, detail: fn, index });
      }
    }

    if (/RunTask|TaskQueueManager::ProcessTaskFromWorkQueue|Layout|UpdateLayoutTree|Paint|CompositeLayers|DroppedFrame/i.test(name) && dur >= 16) {
      result.render.push({ t, duration: dur, label: name, detail: extractEventDetail(event), index });
    }

    if (opts.focus && opts.focus.test(blob)) {
      result.focusHits.push({ t, label: name, detail: extractEventDetail(event), index });
    }
  }

  if (!result.visual.some((item) => item.label === "Screenshot")) {
    result.warnings.push("No embedded screenshots found; UI state must be inferred from non-visual events.");
  }

  for (const request of chromeRequests.values()) {
    if (!request.url) continue;
    if (Number.isFinite(request.t) && Number.isFinite(request.end)) {
      request.duration = Math.max(0, request.end - request.t);
    }
    result.network.push({
      ...request,
      signature: requestSignature(request.url),
      resource: logicalResource(request.url),
      timingConfidence: Number.isFinite(request.t) ? "trace" : "record-order",
    });
  }

  if (result.network.length === 0) {
    result.warnings.push("No explicit network request lifecycle events found; this capture may need HAR/WebKit recording logs for request ordering.");
  }
}

function analyzeDevtoolsRecording(data, result, opts) {
  const records = data.recording.records;
  result.counts.records = records.length;
  result.durationMs = Number.isFinite(data.recording.startTime) && Number.isFinite(data.recording.endTime)
    ? (data.recording.endTime - data.recording.startTime) * 1000
    : null;
  result.timing = "record start/end seconds; some network entries may be record-order only";

  const typeCounts = new Map();
  for (const record of records) {
    typeCounts.set(record.type || "(unknown)", (typeCounts.get(record.type || "(unknown)") || 0) + 1);
  }
  result.counts.recordTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);

  const origin = Number.isFinite(data.recording.startTime) ? data.recording.startTime : null;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const t = Number.isFinite(record.startTime) && Number.isFinite(origin) ? (record.startTime - origin) * 1000 : null;
    const end = Number.isFinite(record.endTime) && Number.isFinite(origin) ? (record.endTime - origin) * 1000 : null;
    const duration = Number.isFinite(t) && Number.isFinite(end) ? end - t : null;
    const blob = `${record.type || ""} ${record.eventType || ""} ${JSON.stringify(record).slice(0, 2000)}`;

    if (record.type === "timeline-record-type-network" && record.entry) {
      const entry = record.entry;
      const url = entry.request?.url;
      result.network.push({
        t,
        end: Number.isFinite(t) && Number.isFinite(entry.time) ? t + entry.time : null,
        duration: Number.isFinite(entry.time) ? entry.time : null,
        method: entry.request?.method || "",
        status: entry.response?.status || null,
        url,
        signature: requestSignature(url),
        resource: logicalResource(url),
        index,
        timingConfidence: Number.isFinite(t) ? "record-time" : "record-order",
      });
    }

    if (/screenshot/i.test(record.type || record.eventType || "")) {
      result.visual.push({ t, label: record.type, detail: record.eventType || "", index });
    }

    if (record.type === "timeline-record-type-script") {
      result.script.push({ t, duration, label: record.eventType || record.type, detail: record.details || "", index });
    }

    if (record.type === "timeline-record-type-rendering-frame" || record.type === "timeline-record-type-layout") {
      if (!Number.isFinite(duration) || duration >= 8) {
        result.render.push({ t, duration, label: record.type, detail: record.eventType || "", index });
      }
    }

    if (opts.focus && opts.focus.test(blob)) {
      result.focusHits.push({ t, label: record.type || "(record)", detail: record.eventType || extractEntryUrl(record.entry) || "", index });
    }
  }

  if (result.network.some((item) => item.timingConfidence === "record-order")) {
    result.warnings.push("Some network entries lack comparable startTime; use record index for ordering and avoid millisecond claims for those entries.");
  }
  if (result.visual.length === 0) {
    result.warnings.push("No screenshot records found; pair with screenshots or a screen capture when UI state matters.");
  }
}

function analyzeHar(data, result) {
  const entries = data.log.entries;
  result.counts.entries = entries.length;
  result.timing = "HAR startedDateTime/time in milliseconds";
  const starts = entries.map((entry) => Date.parse(entry.startedDateTime)).filter(Number.isFinite);
  const origin = starts.length ? Math.min(...starts) : null;

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const start = Date.parse(entry.startedDateTime);
    const t = Number.isFinite(start) && Number.isFinite(origin) ? start - origin : null;
    const duration = Number.isFinite(entry.time) ? entry.time : null;
    const url = entry.request?.url;
    result.network.push({
      t,
      end: Number.isFinite(t) && Number.isFinite(duration) ? t + duration : null,
      duration,
      method: entry.request?.method || "",
      status: entry.response?.status || null,
      url,
      signature: requestSignature(url),
      resource: logicalResource(url),
      index,
      timingConfidence: Number.isFinite(t) ? "har-time" : "record-order",
    });
  }

  if (result.network.length > 0) {
    const ends = result.network.map((item) => item.end).filter(Number.isFinite);
    result.durationMs = ends.length ? Math.max(...ends) : null;
  }
  result.warnings.push("HAR has network evidence only; route, render, console, and screenshot claims need companion artifacts.");
}

function extractEntryUrl(entry) {
  return entry?.request?.url || "";
}

function extractEventDetail(event) {
  const dataArg = event.args?.data || {};
  return dataArg.url || dataArg.frame || dataArg.type || dataArg.functionName || "";
}

function findNetworkAnomalies(result) {
  const network = result.network.filter((item) => item.url);
  for (const item of network) {
    if (Number.isFinite(item.status) && item.status >= 400) {
      result.anomalies.push({ severity: "high", kind: "http-error", detail: `${item.status} ${item.method} ${shortUrl(item.url)}`, t: item.t, index: item.index });
    }
    if (Number.isFinite(item.duration) && item.duration >= 1000) {
      result.anomalies.push({ severity: "medium", kind: "slow-request", detail: `${fmtMs(item.duration)} ${item.method} ${shortUrl(item.url)}`, t: item.t, index: item.index });
    }
  }

  const byResource = new Map();
  for (const item of network) {
    const key = item.resource || item.signature;
    if (!byResource.has(key)) byResource.set(key, []);
    byResource.get(key).push(item);
  }

  for (const [resource, items] of byResource.entries()) {
    const ordered = [...items].sort(compareTimeline);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const older = ordered[i];
      const newer = ordered[i + 1];
      if (Number.isFinite(older.t) && Number.isFinite(newer.t) && Number.isFinite(older.end) && Number.isFinite(newer.end)) {
        if (older.t <= newer.t && older.end > newer.end) {
          result.anomalies.push({
            severity: "high",
            kind: "stale-response-risk",
            detail: `${resource}: older ${older.signature} finishes at ${fmtMs(older.end)} after newer ${newer.signature} at ${fmtMs(newer.end)}`,
            t: newer.t,
            index: newer.index,
          });
        }
        if (Math.abs(newer.t - older.t) <= 50) {
          result.anomalies.push({
            severity: "medium",
            kind: "duplicate-or-burst-request",
            detail: `${resource}: ${older.signature} and ${newer.signature} start ${fmtMs(Math.abs(newer.t - older.t))} apart`,
            t: newer.t,
            index: newer.index,
          });
        }
      } else if (Math.abs((newer.index ?? 0) - (older.index ?? 0)) <= 20) {
        result.anomalies.push({
          severity: "low",
          kind: "nearby-repeat-record-order",
          detail: `${resource}: repeated requests near records #${older.index} and #${newer.index}`,
          t: newer.t,
          index: newer.index,
        });
      }
    }
  }
}

function compareTimeline(a, b) {
  const at = Number.isFinite(a.t) ? a.t : Number.POSITIVE_INFINITY;
  const bt = Number.isFinite(b.t) ? b.t : Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;
  return (a.index ?? 0) - (b.index ?? 0);
}

function sortAndLimit(result, limit) {
  for (const key of ["navigation", "network", "visual", "script", "render", "focusHits", "anomalies"]) {
    result[key].sort(compareTimeline);
  }
  result.networkTop = [...result.network]
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, limit);
  for (const key of ["navigation", "network", "visual", "script", "render", "focusHits", "anomalies"]) {
    result[key] = result[key].slice(0, limit);
  }
}

function printMarkdown(results) {
  for (const result of results) {
    console.log(`## ${result.file}`);
    console.log("");
    console.log(`- Format: ${result.format}`);
    console.log(`- Size: ${(result.bytes / 1024 / 1024).toFixed(2)} MiB`);
    console.log(`- Duration: ${result.durationMs == null ? "unknown" : fmtMs(result.durationMs)}`);
    console.log(`- Timing: ${result.timing}`);
    printCounts(result.counts);
    if (result.warnings.length > 0) {
      console.log(`- Warnings: ${result.warnings.join(" ")}`);
    }
    if (result.extractedScreenshots.length > 0) {
      console.log(`- Extracted screenshots: ${result.extractedScreenshots.join(", ")}`);
    }
    console.log("");

    printSection("Narrative anchors", result.navigation, itemLine);
    printSection("Visual evidence", result.visual, itemLine);
    printSection("Network order", result.network, networkLine);
    printSection("Network longest", result.networkTop, networkLine);
    printSection("Focus hits", result.focusHits, itemLine);
    printSection("Script/input markers", result.script, itemLineWithDuration);
    printSection("Render/perf signals", result.render, itemLineWithDuration);
    printSection("Anomalies", result.anomalies, anomalyLine);
    console.log("");
  }
}

function printCounts(counts) {
  if (counts.events) console.log(`- Events: ${counts.events}`);
  if (counts.records) console.log(`- Records: ${counts.records}`);
  if (counts.entries) console.log(`- HAR entries: ${counts.entries}`);
  if (counts.recordTypes) console.log(`- Record types: ${counts.recordTypes.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (counts.topNames) console.log(`- Top event names: ${counts.topNames.map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

function printSection(title, items, formatter) {
  console.log(`### ${title}`);
  if (!items || items.length === 0) {
    console.log("- none");
  } else {
    for (const item of items) console.log(`- ${formatter(item)}`);
  }
  console.log("");
}

function itemLine(item) {
  const detail = item.detail ? ` - ${String(item.detail).slice(0, 180)}` : "";
  return `${formatRel(item)} ${item.label}${detail}`;
}

function itemLineWithDuration(item) {
  const duration = Number.isFinite(item.duration) ? ` (${fmtMs(item.duration)})` : "";
  const detail = item.detail ? ` - ${String(item.detail).slice(0, 180)}` : "";
  return `${formatRel(item)} ${item.label}${duration}${detail}`;
}

function networkLine(item) {
  const duration = Number.isFinite(item.duration) ? ` ${fmtMs(item.duration)}` : "";
  const status = item.status ? ` status=${item.status}` : "";
  const method = item.method ? `${item.method} ` : "";
  const confidence = item.timingConfidence ? ` [${item.timingConfidence}]` : "";
  return `${formatRel(item)}${duration}${status} ${method}${shortUrl(item.url)}${confidence}`;
}

function anomalyLine(item) {
  return `${formatRel(item)} ${item.severity} ${item.kind}: ${item.detail}`;
}

const opts = parseArgs(process.argv.slice(2));
const results = opts.files.map((file) => analyzeFile(file, opts));
if (opts.json) console.log(JSON.stringify(results, null, 2));
else printMarkdown(results);
