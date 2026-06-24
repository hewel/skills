#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptName = path.basename(fileURLToPath(import.meta.url));
const SEMANTIC_KEYS = [
  "libraryId",
  "parentId",
  "page",
  "startIndex",
  "limit",
  "pageSize",
  "sort",
  "sortDirection",
  "filter",
  "playedFilter",
];
const VISUAL_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"]);

function parseArgs(argv) {
  const opts = {
    files: [],
    focus: null,
    limit: 24,
    json: false,
    screenshotsDir: null,
    screenshotsMax: 12,
    consoleFiles: [],
    domFiles: [],
    visualPaths: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--focus") opts.focus = new RegExp(argv[++i], "i");
    else if (arg === "--limit") opts.limit = Number(argv[++i]);
    else if (arg === "--screenshots-dir") opts.screenshotsDir = argv[++i];
    else if (arg === "--screenshots-max") opts.screenshotsMax = Number(argv[++i]);
    else if (arg === "--console") opts.consoleFiles.push(argv[++i]);
    else if (arg === "--dom") opts.domFiles.push(argv[++i]);
    else if (arg === "--visual") opts.visualPaths.push(argv[++i]);
    else if (arg === "-h" || arg === "--help") usage(0);
    else opts.files.push(arg);
  }

  if (opts.files.length === 0) usage(1);
  return opts;
}

function usage(code) {
  const out = code === 0 ? console.log : console.error;
  out([
    `Usage: node ${scriptName} [options] <trace-or-har.json> [more.json]`,
    "",
    "Options:",
    "  --focus <regex>            Highlight app terms in trace and sidecar evidence",
    "  --limit N                  Limit each printed section (default: 24)",
    "  --json                     Emit JSON",
    "  --screenshots-dir DIR      Extract embedded Chromium screenshots",
    "  --screenshots-max N        Limit extracted screenshots (default: 12)",
    "  --console FILE             Add console JSON, NDJSON, or text log evidence (repeatable)",
    "  --dom FILE                 Add DOM snapshot HTML, JSON, or text evidence (repeatable)",
    "  --visual FILE_OR_DIR       Add sidecar screenshots or recordings (repeatable)",
  ].join("\n"));
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

function parseJsonMaybe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function semanticFieldsFromUrl(rawUrl) {
  const parsed = safeUrl(rawUrl);
  const fields = {};
  if (!parsed) return fields;
  for (const key of SEMANTIC_KEYS) {
    if (parsed.searchParams.has(key)) fields[key] = parsed.searchParams.get(key);
  }
  return fields;
}

function collectSemanticFields(value, fields = {}) {
  if (!value || typeof value !== "object") return fields;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectSemanticFields(item, fields);
    return fields;
  }
  for (const [key, item] of Object.entries(value)) {
    if (SEMANTIC_KEYS.includes(key) && item != null && typeof item !== "object") {
      fields[key] = String(item);
    } else if (item && typeof item === "object") {
      collectSemanticFields(item, fields);
    }
  }
  return fields;
}

function semanticFieldsFromPostData(postData) {
  const fields = {};
  if (!postData) return fields;
  const text = typeof postData === "string" ? postData : postData.text;
  if (typeof text === "string") {
    const json = parseJsonMaybe(text);
    if (json) collectSemanticFields(json, fields);
  }
  if (Array.isArray(postData.params)) {
    for (const param of postData.params) {
      if (SEMANTIC_KEYS.includes(param.name)) fields[param.name] = String(param.value);
    }
  }
  return fields;
}

function mergeSemanticFields(...sources) {
  return Object.assign({}, ...sources.filter(Boolean));
}

function semanticSuffix(fields) {
  const parts = [];
  for (const key of SEMANTIC_KEYS) {
    if (fields && fields[key] != null && fields[key] !== "") parts.push(`${key}=${fields[key]}`);
  }
  return parts.join("&");
}

function requestSignature(rawUrl, semanticFields = {}) {
  const parsed = safeUrl(rawUrl);
  if (!parsed) return rawUrl || "(unknown)";
  const pathname = parsed.protocol === "ipc:" ? parsed.hostname + parsed.pathname : parsed.pathname;
  const fields = mergeSemanticFields(semanticFieldsFromUrl(rawUrl), semanticFields);
  const suffix = semanticSuffix(fields);
  return suffix ? `${pathname}?${suffix}` : pathname;
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
    console: [],
    dom: [],
    script: [],
    render: [],
    focusHits: [],
    anomalies: [],
    extractedScreenshots: [],
    evidenceQuality: null,
  };
}

function analyzeFile(file, opts, sidecars) {
  const data = readJson(file);
  const format = detectFormat(data);
  const result = baseSummary(file, data, format);

  if (format === "chromium-trace") analyzeChromiumTrace(data, result, opts);
  else if (format === "devtools-recording") analyzeDevtoolsRecording(data, result, opts);
  else if (format === "har") analyzeHar(data, result);
  else {
    result.warnings.push("Unsupported JSON shape. Expected traceEvents, recording.records, or log.entries.");
  }

  result.console = sidecars.console;
  result.dom = sidecars.dom;
  result.visual.push(...sidecars.visual);
  result.focusHits.push(...sidecars.focusHits);

  findNetworkAnomalies(result);
  result.evidenceQuality = buildEvidenceQuality(result);
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
      const bodyFields = collectSemanticFields(dataArg.request || {});
      const semanticFields = mergeSemanticFields(semanticFieldsFromUrl(url), bodyFields);
      const requestId = dataArg.requestId || url || `${name}:${index}`;
      const current = chromeRequests.get(requestId) || { index, t: null, end: null, duration: null, method: "", status: null, url: null, encodedBytes: 0, semanticFields: {} };
      current.index = Math.min(current.index, index);
      current.semanticFields = mergeSemanticFields(current.semanticFields, semanticFields);
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
      result.visual.push({ t, label: "Screenshot", detail: hasSnapshot ? "embedded JPEG snapshot" : "no snapshot payload", index, source: "trace" });
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
      result.focusHits.push({ t, label: name, detail: extractEventDetail(event), index, source: "trace" });
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
      signature: requestSignature(request.url, request.semanticFields),
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
      const semanticFields = mergeSemanticFields(
        semanticFieldsFromUrl(url),
        semanticFieldsFromPostData(entry.request?.postData),
        collectSemanticFields(entry.request || {}),
      );
      result.network.push({
        t,
        end: Number.isFinite(t) && Number.isFinite(entry.time) ? t + entry.time : null,
        duration: Number.isFinite(entry.time) ? entry.time : null,
        method: entry.request?.method || "",
        status: entry.response?.status || null,
        url,
        signature: requestSignature(url, semanticFields),
        resource: logicalResource(url),
        semanticFields,
        index,
        timingConfidence: Number.isFinite(t) ? "record-time" : "record-order",
      });
    }

    if (/screenshot/i.test(record.type || record.eventType || "")) {
      result.visual.push({ t, label: record.type, detail: record.eventType || "", index, source: "trace" });
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
      result.focusHits.push({ t, label: record.type || "(record)", detail: record.eventType || extractEntryUrl(record.entry) || "", index, source: "trace" });
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
    const semanticFields = mergeSemanticFields(
      semanticFieldsFromUrl(url),
    );
    result.network.push({
      t,
      end: Number.isFinite(t) && Number.isFinite(duration) ? t + duration : null,
      duration,
      method: entry.request?.method || "",
      status: entry.response?.status || null,
      url,
      signature: requestSignature(url, semanticFields),
      resource: logicalResource(url),
      semanticFields,
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

function buildSidecarEvidence(opts) {
  const evidence = { console: [], dom: [], visual: [], focusHits: [] };
  for (const file of opts.consoleFiles) {
    const items = parseConsoleFile(file, opts.focus);
    evidence.console.push(...items.console);
    evidence.focusHits.push(...items.focusHits);
  }
  for (const file of opts.domFiles) {
    const items = parseDomFile(file, opts.focus);
    evidence.dom.push(items.dom);
    evidence.focusHits.push(...items.focusHits);
  }
  for (const inputPath of opts.visualPaths) {
    evidence.visual.push(...collectVisualEvidence(inputPath, opts.focus, evidence.focusHits));
  }
  return evidence;
}

function parseConsoleFile(file, focus) {
  const text = fs.readFileSync(file, "utf8");
  const parsed = parseJsonMaybe(text);
  const entries = [];
  if (Array.isArray(parsed)) {
    parsed.forEach((entry, index) => entries.push(consoleEntryFromValue(file, entry, index)));
  } else if (parsed && typeof parsed === "object") {
    const list = Array.isArray(parsed.logs) ? parsed.logs : Array.isArray(parsed.entries) ? parsed.entries : [parsed];
    list.forEach((entry, index) => entries.push(consoleEntryFromValue(file, entry, index)));
  } else {
    text.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const lineJson = parseJsonMaybe(line);
      entries.push(consoleEntryFromValue(file, lineJson || line, index));
    });
  }

  const focusHits = [];
  for (const entry of entries) {
    if (focus && focus.test(`${entry.level} ${entry.message}`)) {
      focusHits.push({ label: "console", detail: `${entry.level}: ${entry.message}`, index: entry.index, source: file });
    }
  }
  return { console: entries, focusHits };
}

function consoleEntryFromValue(file, value, index) {
  if (typeof value === "string") {
    return { file, index, level: inferLogLevel(value), message: value.slice(0, 300), timestamp: null };
  }
  const message = value.message || value.text || value.args?.join?.(" ") || JSON.stringify(value);
  return {
    file,
    index,
    level: inferLogLevel(value.level || value.type || message),
    message: String(message).slice(0, 300),
    timestamp: value.timestamp || value.time || value.date || null,
  };
}

function inferLogLevel(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("error") || text.includes("exception") || text.includes("failed")) return "error";
  if (text.includes("warn")) return "warning";
  return "info";
}

function parseDomFile(file, focus) {
  const text = fs.readFileSync(file, "utf8");
  const stat = fs.statSync(file);
  const parsed = parseJsonMaybe(text);
  const searchable = parsed ? JSON.stringify(parsed) : text;
  const dom = {
    file,
    bytes: stat.size,
    format: parsed ? "json" : path.extname(file).replace(/^\./, "") || "text",
    focusMatched: Boolean(focus && focus.test(searchable)),
  };
  const focusHits = [];
  if (dom.focusMatched) {
    focusHits.push({ label: "dom", detail: file, index: 0, source: file });
  }
  return { dom, focusHits };
}

function collectVisualEvidence(inputPath, focus, focusHits) {
  const stat = fs.statSync(inputPath);
  const files = stat.isDirectory()
    ? fs.readdirSync(inputPath).map((name) => path.join(inputPath, name))
    : [inputPath];
  const evidence = [];
  for (const file of files) {
    const fileStat = fs.statSync(file);
    if (fileStat.isDirectory()) continue;
    const ext = path.extname(file).toLowerCase();
    if (!VISUAL_EXTENSIONS.has(ext)) continue;
    evidence.push({ label: "sidecar visual", detail: file, index: evidence.length, source: "sidecar", bytes: fileStat.size });
    if (focus && focus.test(path.basename(file))) {
      focusHits.push({ label: "visual", detail: file, index: evidence.length - 1, source: file });
    }
  }
  return evidence;
}

function buildEvidenceQuality(result) {
  const hasTrace = result.format !== "unknown-json";
  const hasNetwork = result.network.length > 0;
  const hasComparableTiming = result.network.some((item) => item.timingConfidence && item.timingConfidence !== "record-order");
  const hasRecordOrderOnly = hasNetwork && result.network.every((item) => item.timingConfidence === "record-order");
  const hasTraceScreenshots = result.visual.some((item) => item.source === "trace" || item.label === "Screenshot");
  const hasSidecarVisuals = result.visual.some((item) => item.source === "sidecar");
  const hasDom = result.dom.length > 0;
  const hasConsole = result.console.length > 0;
  let confidence = "inferred";
  if ((hasTraceScreenshots || hasSidecarVisuals || hasDom) && hasNetwork && hasComparableTiming) confidence = "strong";
  else if ((hasTraceScreenshots || hasSidecarVisuals || hasDom || hasConsole) && (hasNetwork || result.navigation.length > 0)) confidence = "partial";
  else if (hasRecordOrderOnly) confidence = "record-order-only";

  const missing = [];
  if (!hasNetwork) missing.push("network");
  if (!hasComparableTiming && hasNetwork) missing.push("comparable timing");
  if (!hasTraceScreenshots && !hasSidecarVisuals) missing.push("screenshots or screen recording");
  if (!hasDom) missing.push("DOM snapshot");
  if (!hasConsole) missing.push("console logs");
  if (missing.length > 0) {
    result.warnings.push(`Evidence gaps: missing ${missing.join(", ")}.`);
  }

  return {
    confidence,
    lanes: {
      trace: hasTrace,
      network: hasNetwork,
      comparableTiming: hasComparableTiming,
      recordOrderOnly: hasRecordOrderOnly,
      traceScreenshots: hasTraceScreenshots,
      sidecarVisuals: hasSidecarVisuals,
      dom: hasDom,
      console: hasConsole,
    },
    missing,
  };
}

function compareResults(results) {
  if (results.length < 2) return null;
  const [before, after] = results;
  const beforeSet = new Map(before.anomaliesUntrimmed.map((item) => [anomalyFingerprint(item), item]));
  const afterSet = new Map(after.anomaliesUntrimmed.map((item) => [anomalyFingerprint(item), item]));
  const disappeared = [...beforeSet.keys()].filter((key) => !afterSet.has(key)).map((key) => beforeSet.get(key));
  const persisted = [...beforeSet.keys()].filter((key) => afterSet.has(key)).map((key) => afterSet.get(key));
  const added = [...afterSet.keys()].filter((key) => !beforeSet.has(key)).map((key) => afterSet.get(key));
  const comparable = before.evidenceQuality?.lanes.network === after.evidenceQuality?.lanes.network
    && before.evidenceQuality?.lanes.comparableTiming === after.evidenceQuality?.lanes.comparableTiming
    && before.evidenceQuality?.lanes.traceScreenshots === after.evidenceQuality?.lanes.traceScreenshots;
  return {
    baseline: before.file,
    candidate: after.file,
    confidence: comparable ? "partial" : "weak",
    warning: comparable ? null : "Captures have different evidence lanes; treat before/after claims cautiously.",
    disappeared: disappeared.slice(0, 24),
    persisted: persisted.slice(0, 24),
    added: added.slice(0, 24),
  };
}

function anomalyFingerprint(item) {
  return `${item.kind}:${item.resource || ""}:${item.signature || ""}:${item.detail.replace(/\d+(\.\d+)?(ms|s)/g, "?")}`;
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
      result.anomalies.push({ severity: "high", kind: "http-error", detail: `${item.status} ${item.method} ${shortUrl(item.url)}`, t: item.t, index: item.index, resource: item.resource, signature: item.signature });
    }
    if (Number.isFinite(item.duration) && item.duration >= 1000) {
      result.anomalies.push({ severity: "medium", kind: "slow-request", detail: `${fmtMs(item.duration)} ${item.method} ${shortUrl(item.url)}`, t: item.t, index: item.index, resource: item.resource, signature: item.signature });
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
            resource,
            signature: newer.signature,
          });
        }
        if (Math.abs(newer.t - older.t) <= 50) {
          result.anomalies.push({
            severity: "medium",
            kind: "duplicate-or-burst-request",
            detail: `${resource}: ${older.signature} and ${newer.signature} start ${fmtMs(Math.abs(newer.t - older.t))} apart`,
            t: newer.t,
            index: newer.index,
            resource,
            signature: newer.signature,
          });
        }
      } else if (Math.abs((newer.index ?? 0) - (older.index ?? 0)) <= 20) {
        result.anomalies.push({
          severity: "low",
          kind: "nearby-repeat-record-order",
          detail: `${resource}: repeated requests near records #${older.index} and #${newer.index}`,
          t: newer.t,
          index: newer.index,
          resource,
          signature: newer.signature,
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
  for (const key of ["navigation", "network", "visual", "console", "script", "render", "focusHits", "anomalies"]) {
    result[key].sort(compareTimeline);
  }
  result.anomaliesUntrimmed = [...result.anomalies];
  result.networkTop = [...result.network]
    .sort((a, b) => (b.duration || 0) - (a.duration || 0))
    .slice(0, limit);
  for (const key of ["navigation", "network", "visual", "console", "script", "render", "focusHits", "anomalies"]) {
    result[key] = result[key].slice(0, limit);
  }
}

function printMarkdown(results, comparison) {
  for (const result of results) {
    console.log(`## ${result.file}`);
    console.log("");
    console.log(`- Format: ${result.format}`);
    console.log(`- Size: ${(result.bytes / 1024 / 1024).toFixed(2)} MiB`);
    console.log(`- Duration: ${result.durationMs == null ? "unknown" : fmtMs(result.durationMs)}`);
    console.log(`- Timing: ${result.timing}`);
    printCounts(result.counts);
    if (result.warnings.length > 0) {
      console.log(`- Warnings: ${dedupe(result.warnings).join(" ")}`);
    }
    if (result.extractedScreenshots.length > 0) {
      console.log(`- Extracted screenshots: ${result.extractedScreenshots.join(", ")}`);
    }
    console.log("");

    printEvidenceQuality(result.evidenceQuality);
    printSection("Narrative anchors", result.navigation, itemLine);
    printSection("Visual evidence", result.visual, visualLine);
    printSection("DOM evidence", result.dom, domLine);
    printSection("Console evidence", result.console, consoleLine);
    printSection("Network order", result.network, networkLine);
    printSection("Network longest", result.networkTop, networkLine);
    printSection("Focus hits", result.focusHits, itemLine);
    printSection("Script/input markers", result.script, itemLineWithDuration);
    printSection("Render/perf signals", result.render, itemLineWithDuration);
    printSection("Anomalies", result.anomalies, anomalyLine);
    console.log("");
  }
  if (comparison) printComparison(comparison);
}

function printCounts(counts) {
  if (counts.events) console.log(`- Events: ${counts.events}`);
  if (counts.records) console.log(`- Records: ${counts.records}`);
  if (counts.entries) console.log(`- HAR entries: ${counts.entries}`);
  if (counts.recordTypes) console.log(`- Record types: ${counts.recordTypes.map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (counts.topNames) console.log(`- Top event names: ${counts.topNames.map(([k, v]) => `${k}=${v}`).join(", ")}`);
}

function printEvidenceQuality(quality) {
  console.log("### Evidence quality");
  if (!quality) {
    console.log("- unknown");
  } else {
    const lanes = Object.entries(quality.lanes).filter(([, value]) => value).map(([key]) => key);
    console.log(`- confidence=${quality.confidence}`);
    console.log(`- present=${lanes.length > 0 ? lanes.join(", ") : "none"}`);
    console.log(`- missing=${quality.missing.length > 0 ? quality.missing.join(", ") : "none"}`);
  }
  console.log("");
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
  const source = item.source ? ` [${item.source}]` : "";
  const detail = item.detail ? ` - ${String(item.detail).slice(0, 180)}` : "";
  return `${formatRel(item)} ${item.label}${source}${detail}`;
}

function itemLineWithDuration(item) {
  const duration = Number.isFinite(item.duration) ? ` (${fmtMs(item.duration)})` : "";
  const detail = item.detail ? ` - ${String(item.detail).slice(0, 180)}` : "";
  return `${formatRel(item)} ${item.label}${duration}${detail}`;
}

function visualLine(item) {
  const bytes = Number.isFinite(item.bytes) ? ` ${(item.bytes / 1024).toFixed(1)}KiB` : "";
  return `${itemLine(item)}${bytes}`;
}

function domLine(item) {
  return `${path.basename(item.file)} ${item.format} ${(item.bytes / 1024).toFixed(1)}KiB focus=${item.focusMatched ? "yes" : "no"}`;
}

function consoleLine(item) {
  const stamp = item.timestamp ? ` ${item.timestamp}` : "";
  return `${path.basename(item.file)}#${item.index}${stamp} ${item.level}: ${item.message}`;
}

function networkLine(item) {
  const duration = Number.isFinite(item.duration) ? ` ${fmtMs(item.duration)}` : "";
  const status = item.status ? ` status=${item.status}` : "";
  const method = item.method ? `${item.method} ` : "";
  const semantics = semanticSuffix(item.semanticFields) ? ` {${semanticSuffix(item.semanticFields)}}` : "";
  const confidence = item.timingConfidence ? ` [${item.timingConfidence}]` : "";
  return `${formatRel(item)}${duration}${status} ${method}${shortUrl(item.url)}${semantics}${confidence}`;
}

function anomalyLine(item) {
  return `${formatRel(item)} ${item.severity} ${item.kind}: ${item.detail}`;
}

function printComparison(comparison) {
  console.log("## Before/after comparison");
  console.log("");
  console.log(`- Baseline: ${comparison.baseline}`);
  console.log(`- Candidate: ${comparison.candidate}`);
  console.log(`- Confidence: ${comparison.confidence}`);
  if (comparison.warning) console.log(`- Warning: ${comparison.warning}`);
  console.log("");
  printSection("Disappeared patterns", comparison.disappeared, anomalyLine);
  printSection("Persisted patterns", comparison.persisted, anomalyLine);
  printSection("New patterns", comparison.added, anomalyLine);
}

function dedupe(items) {
  return [...new Set(items)];
}

const opts = parseArgs(process.argv.slice(2));
const sidecars = buildSidecarEvidence(opts);
const results = opts.files.map((file) => analyzeFile(file, opts, sidecars));
const comparison = compareResults(results);
if (opts.json) console.log(JSON.stringify({ results, comparison }, null, 2));
else printMarkdown(results, comparison);
