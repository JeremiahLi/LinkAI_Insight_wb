const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const SPOOL_DIR = process.env.PI_BIZ_CAPTURE_SPOOL_DIR || path.join(process.env.USERPROFILE, '.pi-biz-capture');
const LOG_DIR = path.join(SPOOL_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'upload-biz.log');
const LOCK_FILE = path.join(SPOOL_DIR, '.upload-biz.lock');
const CHECKPOINT_FILE = path.join(SPOOL_DIR, 'upload-biz-checkpoint.json');

function log(msg) {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    fs.appendFileSync(LOG_FILE, '[' + new Date().toISOString() + '] ' + msg + '\n');
  } catch {}
}

function safeJsonParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function readJsonl(file) {
  const records = [];
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const obj = safeJsonParse(line);
      if (obj) records.push(obj);
    }
  } catch (e) {
    log('readJsonl.error file=' + file + ' ' + (e.message || e));
  }
  return records;
}

function findAllBizFiles() {
  const files = [];
  try {
    const userDirs = fs.readdirSync(SPOOL_DIR, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'logs');
    for (const uDir of userDirs) {
      const projectDirs = fs.readdirSync(path.join(SPOOL_DIR, uDir.name), { withFileTypes: true }).filter(d => d.isDirectory());
      for (const pDir of projectDirs) {
        const dateDirs = fs.readdirSync(path.join(SPOOL_DIR, uDir.name, pDir.name), { withFileTypes: true }).filter(d => d.isDirectory());
        for (const dDir of dateDirs) {
          const dirPath = path.join(SPOOL_DIR, uDir.name, pDir.name, dDir.name);
          let entries;
          try { entries = fs.readdirSync(dirPath, { withFileTypes: true }).filter(f => f.isFile()); } catch { continue; }
          for (const entry of entries) {
            if (/^biz-.*\.jsonl$/.test(entry.name)) {
              files.push(path.join(dirPath, entry.name));
            }
          }
        }
      }
    }
  } catch (e) {
    log('scan.error ' + (e.message || e));
  }
  return files;
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

function acquireLock() {
  try {
    const prevPid = Number((fs.readFileSync(LOCK_FILE, 'utf8') || '').trim());
    if (prevPid && prevPid !== process.pid) {
      try {
        process.kill(prevPid, 0);
        log('lock.skip alreadyRunning pid=' + prevPid);
        return false;
      } catch {}
    }
  } catch {}
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

function postJson(targetUrl, payload) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(targetUrl); } catch { resolve({ ok: false, status: 0, body: 'bad url' }); return; }
    const body = Buffer.from(JSON.stringify(payload));
    const options = {
      hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/api/biz-metrics/upload', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    };
    const reqModule = url.protocol === 'https:' ? require('node:https') : http;
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

async function uploadFile(jsonlFile, backendUrl) {
  const records = readJsonl(jsonlFile);
  if (records.length === 0) { log('upload.skip empty file=' + jsonlFile); return; }

  const sessionId = records[0].sessionId || 'unknown';
  const userId = records[0].userId || 'unknown';
  const projectId = records[0].projectId || 'unknown';

  const payload = {
    sessionId,
    userId,
    projectId,
    metrics: records.map(r => {
      const tokens = r.metrics?.tokens || {};
      return {
        agentId: r.agentId,
        taskId: r.taskId,
        durationMs: r.metrics?.durationMs ?? 0,
        success: r.metrics?.success ?? true,
        inputTokens: tokens.inputTokens ?? 0,
        outputTokens: tokens.outputTokens ?? 0,
        totalTokens: tokens.totalTokens ?? ((tokens.inputTokens ?? 0) + (tokens.outputTokens ?? 0)),
        callCount: tokens.callCount ?? 0,
        models: tokens.models ?? [],
        customData: r.metrics?.customData ?? r.metrics?.custom ?? null,
        createdAt: r.t,
      };
    }),
  };

  log('payload customData=' + (payload.metrics[0]?.customData ? 'present' : 'NULL') + ' file=' + jsonlFile);

  const ckpt = loadCheckpoint();
  const fileKey = path.basename(jsonlFile);
  const fileSig = records.length + '|' + (records[records.length - 1]?.t || '');
  if (ckpt[fileKey] === fileSig) {
    log('upload.skip checkpoint unchanged file=' + fileKey);
    return;
  }

  const res = await postJson(backendUrl, payload);
  if (res.ok) {
    log('upload.success file=' + fileKey + ' records=' + records.length + ' status=' + res.status);
    ckpt[fileKey] = fileSig;
    saveCheckpoint(ckpt);
  } else {
    log('upload.failed file=' + fileKey + ' status=' + res.status + ' body=' + String(res.body).slice(0, 300));
  }
}

async function scanAll(backendUrl) {
  const files = findAllBizFiles();
  log('scanall.found files=' + files.length);
  for (const file of files) {
    await uploadFile(file, backendUrl);
  }
}

async function main() {
  const jsonlFile = process.argv[2];
  const backendUrl = process.argv[3] || 'http://localhost:3000';

  if (!acquireLock()) { log('upload.skip lockNotAcquired'); process.exit(0); }
  process.on('exit', releaseLock);

  if (jsonlFile === '--scan-all') {
    log('upload.scanAll backend=' + backendUrl);
    await scanAll(backendUrl);
    process.exit(0);
  }

  if (!jsonlFile) { log('upload.error missing argument'); process.exit(1); }
  if (!fs.existsSync(jsonlFile)) { log('upload.skip fileNotFound file=' + jsonlFile); process.exit(0); }

  log('upload.start file=' + jsonlFile + ' backend=' + backendUrl);
  await uploadFile(jsonlFile, backendUrl);
}

main().catch((err) => {
  log('upload.error ' + (err && err.stack ? err.stack : String(err)));
  process.exit(0);
});
