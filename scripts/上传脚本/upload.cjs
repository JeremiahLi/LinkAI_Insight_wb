const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'upload.log');
const LOCK_FILE = path.join(__dirname, '.uploader.lock');
const CHECKPOINT_FILE = path.join(__dirname, 'uploader_checkpoint.json');
// 检查点条目保留时长（天），超过则视为陈旧并剪枝；可用环境变量覆盖
const CHECKPOINT_TTL_MS =
  (Number(process.env.PI_CAPTURE_CHECKPOINT_TTL_DAYS) > 0
    ? Number(process.env.PI_CAPTURE_CHECKPOINT_TTL_DAYS)
    : 30) *
  24 *
  60 *
  60 *
  1000;

function log(msg) {
  console.log(msg);
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch (e) {}
}

function safeJsonParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function readJsonl(file) {
  const records = [];
  try {
    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      const obj = safeJsonParse(line);
      if (obj) records.push(obj);
    }
  } catch (e) {
    log('readJsonl.error file=' + file + ' ' + (e.message || e));
  }
  return records;
}

// 为记录生成一个稳定、与遍历顺序无关的排序键：
// 优先用 spanId / toolCallId，最后回退到整条记录的序列化
function recordSortKey(r) {
  const id = r.spanId || (r.payload && r.payload.toolCallId) || '';
  let body = '';
  try { body = JSON.stringify(r); } catch (e) { body = String(r); }
  return id + '\u0000' + body;
}

// 按「时间 + 稳定键」做全序排序，消除 readdir 顺序抖动，
// 保证同一份源数据每次生成的 rawData / 签名完全一致
function sortRecordsDeterministic(records) {
  const decorated = records.map(function (rec) {
    const t = new Date(rec.t).getTime();
    return { rec: rec, t: Number.isFinite(t) ? t : 0, key: recordSortKey(rec) };
  });
  decorated.sort(function (a, b) {
    if (a.t !== b.t) return a.t - b.t;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return 0;
  });
  return decorated.map(function (d) { return d.rec; });
}

function mergeToolCalls(records) {
  const toolCallMap = new Map();
  const result = [];
  for (const r of records) {
    if (r.kind === 'tool_execution') {
      const tcId = r.payload && r.payload.toolCallId;
      if (tcId && toolCallMap.has(tcId)) {
        const existing = toolCallMap.get(tcId);
        if (r.payload && r.payload.duration != null) {
          existing.payload = existing.payload || {};
          existing.payload.toolDuration = r.payload.duration;
        }
        if (r.payload && r.payload.isError) {
          existing.status = 'failed';
        }
      }
      continue;
    }
    if (r.kind !== 'tool_call') { result.push(r); continue; }
    const tcId = r.payload && r.payload.toolCallId;
    if (!tcId) { result.push(r); continue; }
    if (!toolCallMap.has(tcId)) {
      toolCallMap.set(tcId, { ...r });
    } else {
      const existing = toolCallMap.get(tcId);
      const mergedInput = existing.payload && existing.payload.input !== undefined ? existing.payload.input : (r.payload ? r.payload.input : undefined);
      const merged = { ...existing, ...r, payload: { ...existing.payload, ...r.payload } };
      if (mergedInput !== undefined && merged.payload && merged.payload.input === undefined) {
        merged.payload.input = mergedInput;
      }
      toolCallMap.set(tcId, merged);
    }
  }
  for (const [, merged] of toolCallMap) { result.push(merged); }
  return sortRecordsDeterministic(result);
}

function stringifyIfExists(val) {
  if (val == null || val === undefined) return null;
  if (typeof val === 'string') return val;
  try { return JSON.stringify(val); } catch { return String(val); }
}

function buildSessionPayload(records) {
  const now = new Date().toISOString();
  const session = {
    sessionID: null, userId: null, projectId: null,
    startedAt: null, endedAt: null, model: '',
    rawData: JSON.stringify(records), spans: [], piPid: null,
  };
  const modelEvents = [];
  for (const r of records) {
    if (!session.sessionID) session.sessionID = r.sessionID;
    if (!session.userId) session.userId = r.userId;
    if (!session.projectId) session.projectId = r.projectId;
    const ts = r.t || now;
    if (r.kind === 'session_start') {
      session.startedAt = ts;
      if (r.payload && r.payload.pid) session.piPid = r.payload.pid;
      continue;
    }
    if (r.kind === 'session_shutdown') { session.endedAt = ts; continue; }
    if (r.kind === 'model_select') { modelEvents.push(r); continue; }
    const span = {
      spanId: r.spanId, kind: r.kind, name: r.name, status: r.status,
      roundIndex: r.roundIndex, turnId: r.turnId,
      input: null, output: null, tokens: null, model: null,
      toolCallId: null, toolName: null, isError: false, duration: null,
      llmThinkDuration: null, agentReplyDuration: null, toolDuration: null, details: null, content: null, createdAt: ts,
    };
    if (r.kind === 'user') {
      span.input = r.payload && r.payload.text ? r.payload.text : '';
    } else if (r.kind === 'system_prompt') {
      span.input = r.payload && r.payload.systemPrompt ? r.payload.systemPrompt : '';
    } else if (r.kind === 'llm_thinking') {
      span.input = r.payload && r.payload.thinking ? r.payload.thinking : '';
      span.output = r.payload && r.payload.text ? r.payload.text : '';
      span.tokens = r.payload && r.payload.tokens ? r.payload.tokens : null;
      span.model = r.payload && r.payload.model ? r.payload.model : null;
      if (r.payload && r.payload.timings) {
        span.llmThinkDuration = r.payload.timings.llmThink != null ? r.payload.timings.llmThink : null;
        span.agentReplyDuration = r.payload.timings.agentReply != null ? r.payload.timings.agentReply : null;
      }
    } else if (r.kind === 'answer') {
      span.input = r.payload && r.payload.thinking ? r.payload.thinking : '';
      span.output = r.payload && r.payload.text ? r.payload.text : '';
      span.tokens = r.payload && r.payload.tokens ? r.payload.tokens : null;
      span.model = r.payload && r.payload.model ? r.payload.model : null;
      if (r.payload && r.payload.timings) {
        span.llmThinkDuration = r.payload.timings.llmThink != null ? r.payload.timings.llmThink : null;
        span.agentReplyDuration = r.payload.timings.agentReply != null ? r.payload.timings.agentReply : null;
      }
    } else if (r.kind === 'tool_call') {
      span.toolCallId = r.payload && r.payload.toolCallId ? r.payload.toolCallId : null;
      span.toolName = r.name && r.name !== 'tool_call' ? r.name : (r.payload && r.payload.toolName ? r.payload.toolName : null);
      span.input = stringifyIfExists(r.payload && r.payload.input !== undefined ? r.payload.input : null);
      span.output = stringifyIfExists(r.payload && r.payload.output !== undefined ? r.payload.output : null);
      span.isError = r.payload && r.payload.isError ? true : false;
      if (r.payload && r.payload.error) span.output = stringifyIfExists(r.payload.error);
      if (r.payload && r.payload.toolDuration != null) span.toolDuration = r.payload.toolDuration;
      if (r.payload && r.payload.details) span.details = stringifyIfExists(r.payload.details);
      if (r.payload && r.payload.content) span.content = stringifyIfExists(r.payload.content);
    }
    session.spans.push(span);
  }
  session.spans.sort(function(a, b) { return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); });
  for (var i = 0; i < session.spans.length; i++) {
    var s = session.spans[i];
    if ((s.kind === 'llm_thinking' || s.kind === 'answer') && s.agentReplyDuration != null) {
      s.duration = s.agentReplyDuration;
    } else if (s.kind === 'tool_call' && s.toolDuration != null) {
      s.duration = s.toolDuration;
    } else if (i < session.spans.length - 1) {
      var next = session.spans[i + 1];
      var diff = new Date(next.createdAt).getTime() - new Date(s.createdAt).getTime();
      s.duration = diff > 0 && diff < 3600000 ? diff : 0;
    } else {
      s.duration = 0;
    }
  }
  var model = '';
  if (modelEvents.length > 0) { model = (modelEvents[modelEvents.length - 1].payload && modelEvents[modelEvents.length - 1].payload.model) || ''; }
  if (!model) { for (const s of session.spans) { if (s.model) { model = s.model; break; } } }
  session.model = model;
  session.endedAt = session.endedAt || now;
  return session;
}

function postJson(targetUrl, payload) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(targetUrl); } catch { resolve({ ok: false, status: 0, body: 'bad url' }); return; }
    const body = Buffer.from(JSON.stringify(payload));
    const options = {
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/api/sessions/upload', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    };
    const reqModule = url.protocol === 'https:' ? https : http;
    const req = reqModule.request(options, (res) => {
      let resBody = '';
      res.on('data', (chunk) => { resBody += chunk; });
      res.on('end', () => { resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: resBody }); });
    });
    req.on('error', (err) => { resolve({ ok: false, status: 0, body: err.message }); });
    req.setTimeout(15000, () => { try { req.destroy(); } catch {} resolve({ ok: false, status: 0, body: 'timeout' }); });
    req.end(body);
  });
}

function findAllSessionRecords(jsonlFile) {
  const fileName = path.basename(jsonlFile);
  const m = fileName.match(/^pi-(.+)-(\d{8})-(\d{6})\.jsonl$/);
  const sessionId = m ? m[1] : fileName.replace(/^pi-/, '').replace(/-\d{8}-\d{6}\.jsonl$/, '').replace(/\.jsonl$/, '');
  const projectIdDir = path.dirname(path.dirname(jsonlFile));
  const filePattern = new RegExp('^pi-' + sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-\\d{8}-\\d{6}\\.jsonl$');
  const allRecords = [];
  try {
    const dayDirs = fs.readdirSync(projectIdDir, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => path.join(projectIdDir, d.name));
    for (const dir of dayDirs) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()); } catch { continue; }
      for (const entry of entries) {
        if (filePattern.test(entry.name)) {
          const recs = readJsonl(path.join(dir, entry.name));
          for (const r of recs) allRecords.push(r);
        }
      }
    }
  } catch (e) { log('findAllSessionRecords.error ' + (e.message || e)); }
  const ordered = sortRecordsDeterministic(allRecords);
  var globalRound = -1;
  for (var i = 0; i < ordered.length; i++) {
    var r = ordered[i];
    if (r.kind === 'user') globalRound++;
    if (globalRound >= 0) r.roundIndex = globalRound;
  }
  return { sessionId, records: ordered };
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch { return false; }
}

// 直接对内容做哈希：rawData 是全量记录的序列化，
// 不含 endedAt=now 之类的运行时刻，因此内容不变则签名恒定、内容一变则签名必变
function computeSignature(session) {
  return crypto.createHash('sha1').update(String(session.rawData || '')).digest('hex');
}

function loadCheckpoint() {
  try {
    if (!fs.existsSync(CHECKPOINT_FILE)) return {};
    const txt = fs.readFileSync(CHECKPOINT_FILE, 'utf8');
    if (!txt || !txt.trim()) return {};
    const obj = JSON.parse(txt);
    return obj && typeof obj === 'object' ? obj : {};
  } catch { return {}; }
}

function saveCheckpoint(ckpt) {
  try {
    fs.mkdirSync(path.dirname(CHECKPOINT_FILE), { recursive: true });
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(ckpt, null, 2));
  } catch {}
}

// 剪掉陈旧条目：超过 TTL 的，以及旧格式（值为字符串、没有 updatedAt）的条目
function pruneCheckpoint(ckpt) {
  const now = Date.now();
  const pruned = {};
  let removed = 0;
  for (const id of Object.keys(ckpt)) {
    const entry = ckpt[id];
    const updatedAt =
      entry && typeof entry === 'object' && entry.updatedAt ? Date.parse(entry.updatedAt) : NaN;
    if (Number.isFinite(updatedAt) && now - updatedAt <= CHECKPOINT_TTL_MS) {
      pruned[id] = entry;
    } else {
      removed++;
    }
  }
  if (removed > 0) {
    log('checkpoint.prune removed=' + removed + ' kept=' + Object.keys(pruned).length);
  }
  return { ckpt: pruned, removed: removed };
}

function acquireLock() {
  try {
    const prevPid = Number((fs.readFileSync(LOCK_FILE, 'utf8') || '').trim());
    if (prevPid && prevPid !== process.pid) {
      try {
        process.kill(prevPid, 0);
        log('lock.skip alreadyRunning pid=' + prevPid);
        return false;
      } catch { /* prevPid dead, takeover */ }
    }
  } catch { /* no lock file */ }
  try { fs.writeFileSync(LOCK_FILE, String(process.pid)); } catch {}
  return true;
}

function releaseLock() {
  try {
    if (Number((fs.readFileSync(LOCK_FILE, 'utf8') || '').trim()) === process.pid) {
      fs.rmSync(LOCK_FILE, { force: true });
    }
  } catch {}
}

async function main() {
  const jsonlFile = process.argv[2];
  const backendUrl = process.argv[3] || 'http://localhost:3002';

  if (!jsonlFile) { log('upload.error missing jsonlFile argument'); process.exit(1); }
  if (!fs.existsSync(jsonlFile)) { log('upload.skip fileNotFound file=' + jsonlFile); process.exit(0); }

  if (!acquireLock()) { log('upload.skip lockNotAcquired'); process.exit(0); }
  process.on('exit', releaseLock);

  log('upload.start file=' + jsonlFile + ' backend=' + backendUrl);

  const { sessionId, records: allRecords } = findAllSessionRecords(jsonlFile);
  log('upload.found sessionId=' + sessionId + ' totalRecords=' + allRecords.length);

  let records = mergeToolCalls(allRecords);
  log('upload.merged records=' + records.length);

  if (records.length === 0) { log('upload.skip empty'); process.exit(0); }

  const session = buildSessionPayload(records);
  log('upload.payload sessionID=' + session.sessionID + ' spans=' + session.spans.length + ' piPid=' + session.piPid);

  const pruned = pruneCheckpoint(loadCheckpoint());
  const ckpt = pruned.ckpt;
  if (pruned.removed > 0) saveCheckpoint(ckpt);

  const sig = computeSignature(session);
  const prevEntry = ckpt[sessionId];
  const prevSig = prevEntry && typeof prevEntry === 'object' ? prevEntry.sig : prevEntry;
  if (prevSig && prevSig === sig) {
    log('upload.skip checkpoint unchanged sessionId=' + sessionId + ' sig=' + sig);
    process.exit(0);
  }

  const piAlive = isPidAlive(session.piPid);
  log('upload.pidCheck piPid=' + session.piPid + ' alive=' + piAlive);

  const res = await postJson(backendUrl, session);
  if (res.ok) {
    log('upload.success status=' + res.status + ' body=' + String(res.body).slice(0, 200));
    ckpt[sessionId] = { sig: sig, updatedAt: new Date().toISOString() };
    saveCheckpoint(ckpt);
    log('upload.checkpointUpdated sessionId=' + sessionId + ' sig=' + sig);
  } else {
    log('upload.failed status=' + res.status + ' body=' + String(res.body).slice(0, 500));
  }
}

main().catch((err) => {
  log('upload.error ' + (err && err.stack ? err.stack : String(err)));
  process.exit(0);
});
