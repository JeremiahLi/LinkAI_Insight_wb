/**
 * 离线根因诊断报告：对全库「待处理失败链」逐条跑 Diagnoser，输出可标注的 markdown。
 *
 * 用法：
 *   npm run detect:build
 *   node scripts/diagnose-cli.cjs                # 全库
 *   node scripts/diagnose-cli.cjs pptagent1022   # 指定 Agent
 *   node scripts/diagnose-cli.cjs all 5          # 只跑前 5 条（试水/省钱）
 *
 * 可选覆盖：
 *   --api-key/--base-url/--model   覆盖设置页的模型配置
 *   --timeout 180000               单条超时（ms，默认 180000；小模型在 8K 证据下可能 60s+）
 *   --concurrency 2                并发（默认 2；4B 模型并发高会被拖慢甚至超时）
 *   --no-cache                     忽略已诊断缓存，全部重跑
 *
 * 产出：.tmp-verify/diagnosis-report.md（含每条的对/错/半对勾选框）
 * 缓存：.tmp-verify/diagnosis-cache.json，按「模型::spanId」索引。超时/断跑后重跑只补失败的那几条，
 *       不重复花钱，也不会让报告里出现两条重复的诊断。
 * 依赖 .tmp-verify 下的编译产物（见 detect:build）。
 */
const fs = require("node:fs");
const path = require("node:path");
const { PrismaClient } = require("@prisma/client");
const { extractFailureChains } = require("../.tmp-verify/failure-chain.js");
const { ERROR_KIND_LABEL } = require("../.tmp-verify/error-signature.js");
const { suggestRemediation, isActionable } = require("../.tmp-verify/remediation.js");
const { diagnose, ROOT_CAUSE_LABEL } = require("../.tmp-verify/diagnoser.js");
const { buildRecurrence, weekBuckets } = require("../.tmp-verify/recurrence.js");

const prisma = new PrismaClient();
const OUT_DIR = path.join(__dirname, "..", ".tmp-verify");
let OUT = path.join(OUT_DIR, "diagnosis-report.md");
const CACHE_FILE = path.join(__dirname, "..", ".tmp-verify", "diagnosis-cache.json");
// 报告里的会话深链要能直接点开，必须是完整 origin
const TRACE_BASE = process.env.TRACE_BASE_URL || "http://localhost:3010";
let CONCURRENCY = 2;

// node 不会自动读 .env（那是 Next 运行时的事）。这里手动加载，好让 DIAG_LLM_* 放在 .env 里，
// 而不是写进被 git 跟踪的 dev.db —— 否则 key 会随提交进仓库历史。
(function loadDotEnv() {
  try {
    const p = path.join(__dirname, "..", ".env");
    if (!fs.existsSync(p)) return;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const v = m[2].trim().replace(/^["']|["']$/g, "");
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {
    /* .env 缺失或不可读都不影响：还有命令行与设置页两条路 */
  }
})();

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1));
  } catch (e) {
    console.warn(`缓存写入失败（不影响报告）：${e.message}`);
  }
}

function clip(s, n) {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return t.length > n ? t.slice(0, n) + "…" : t;
}

/**
 * 配置来源优先级：命令行 > 环境变量 > 设置页 activeConfig。
 * 加覆盖是为了「余额不足时换一个 key 直接跑」，不必动数据库里的设置。
 *   node scripts/diagnose-cli.cjs --api-key sk-xxx --base-url https://xxx/v1 --model gpt-4o-mini
 */
async function loadLlmConfig(cli) {
  const env = process.env;
  const pick = (k, e) => cli[k] || env[e] || "";
  const timeoutMs = Number(cli.timeoutMs) > 0 ? Number(cli.timeoutMs) : 180_000;
  let base = {
    apiKey: pick("apiKey", "DIAG_LLM_API_KEY"),
    baseUrl: pick("baseUrl", "DIAG_LLM_BASE_URL"),
    model: pick("model", "DIAG_LLM_MODEL"),
  };
  if (base.apiKey && base.baseUrl && base.model) return { ...base, timeoutMs };

  const s = await prisma.userSettings.findUnique({ where: { user: "default" } });
  if (!s) throw new Error("没有 UserSettings 记录，先用 --api-key/--base-url/--model 指定模型");
  const j = JSON.parse(s.settingsJson || "{}");
  const cfg = (j.configs || []).find((c) => c.id === j.activeConfigId);
  if (!cfg || !cfg.apiKey) throw new Error("activeConfig 未配置 apiKey");
  return {
    apiKey: base.apiKey || cfg.apiKey,
    baseUrl: base.baseUrl || cfg.baseUrl,
    model: base.model || cfg.model,
    timeoutMs,
  };
}

/** 简单的并发池 */
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (e) {
        // 必须把原 item 一起带上，否则报告里读 r.input 会炸
        out[i] = { ...items[i], error: e instanceof Error ? e.message : String(e) };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  const noCache = process.argv.includes("--no-cache");
  // --flag value 形式的覆盖项单独摘出，避免它的值被当成 Agent 名
  const VALUE_FLAGS = {
    "--api-key": "apiKey",
    "--base-url": "baseUrl",
    "--model": "model",
    "--timeout": "timeoutMs",
    "--concurrency": "concurrency",
    "--out": "out",
  };
  const cli = {};
  const positional = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (VALUE_FLAGS[a]) {
      cli[VALUE_FLAGS[a]] = argv[++i] ?? "";
      continue;
    }
    if (a.startsWith("--")) continue;
    positional.push(a);
  }
  const argAgent = positional[0] && positional[0] !== "all" ? positional[0] : null;
  const limitArg = Number(positional[1] ?? 0);
  if (Number(cli.concurrency) > 0) CONCURRENCY = Number(cli.concurrency);
  const timeoutMs = Number(cli.timeoutMs) > 0 ? Number(cli.timeoutMs) : 180_000;
  // 允许指定输出文件：报告一旦交付就要被人手写标注（[x]），重跑不能覆盖它
  if (cli.out) OUT = path.isAbsolute(cli.out) ? cli.out : path.join(OUT_DIR, cli.out);

  const cfg = dryRun
    ? { model: "(dry-run 不调模型)", baseUrl: "" }
    : await loadLlmConfig({ ...cli, timeoutMs });
  console.log(dryRun ? "模式：dry-run（只装配证据，不调用模型）" : `模型：${cfg.model} @ ${cfg.baseUrl}`);
  if (!dryRun) console.log(`超时 ${cfg.timeoutMs}ms / 并发 ${CONCURRENCY}${noCache ? " / 忽略缓存" : ""}`);

  const agents = await prisma.agent.findMany({
    where: argAgent ? { name: argAgent } : {},
    select: { id: true, name: true },
  });
  if (agents.length === 0) {
    console.error(`未找到 Agent: ${argAgent}`);
    process.exit(1);
  }
  const agentNameById = new Map(agents.map((a) => [a.id, a.name]));

  // 一次性拉全量关键 span：判定链需要 answer，取证需要 user 诉求与入参
  const spans = await prisma.span.findMany({
    where: {
      session: { agentId: { in: agents.map((a) => a.id) } },
      kind: { in: ["tool_call", "command", "user", "answer"] },
    },
    select: {
      id: true,
      sessionId: true,
      roundIndex: true,
      turnId: true,
      kind: true,
      name: true,
      status: true,
      input: true,
      output: true,
      error: true,
      startTime: true,
    },
    orderBy: [{ sessionId: "asc" }, { roundIndex: "asc" }, { turnId: "asc" }],
  });

  const sessions = await prisma.session.findMany({
    where: { agentId: { in: agents.map((a) => a.id) } },
    select: { id: true, startTime: true, agentId: true },
  });
  const sessionAgent = new Map(sessions.map((s) => [s.id, agentNameById.get(s.agentId) ?? "?"]));

  const bySession = new Map();
  for (const sp of spans) {
    const arr = bySession.get(sp.sessionId) ?? [];
    arr.push(sp);
    bySession.set(sp.sessionId, arr);
  }

  // 复发上下文：每个 Agent 近 8 周，家族 → 描述
  const recurrenceByAgent = new Map();
  for (const ag of agents) {
    const ids = new Set(sessions.filter((s) => s.agentId === ag.id).map((s) => s.id));
    const list = spans
      .filter((s) => ids.has(s.sessionId) && (s.kind === "tool_call" || s.kind === "command"))
      .map((s) => ({
        id: s.id,
        sessionId: s.sessionId,
        name: s.name,
        status: s.status,
        error: s.error,
        at: s.startTime * 1000,
      }));
    const ws = weekBuckets(8);
    const rep = buildRecurrence(list.filter((x) => x.at >= ws[0]), 8);
    const m = new Map();
    for (const row of rep.rows) {
      m.set(row.family, `近 8 周出现 ${row.total} 次，涉及 ${row.sessionCount} 个会话，跨 ${row.activeWeeks} 周`);
    }
    recurrenceByAgent.set(ag.id, m);
  }

  // 收 actionable 链
  const targets = [];
  for (const [sessionId, list] of bySession) {
    for (const chain of extractFailureChains(list)) {
      if (!isActionable(chain.signature, chain.outcome, chain.severity)) continue;
      const idx = list.findIndex((s) => s.id === chain.firstSpanId);
      if (idx < 0) continue;
      const span = list[idx];
      const agentId = sessions.find((s) => s.id === sessionId)?.agentId;
      const agentName = sessionAgent.get(sessionId) ?? "?";

      // 该轮用户诉求：同 roundIndex 内、失败点之前最后一个 user span
      // 注意：user span 的正文在 input 字段，output 恒为空（实测 23/23 全空）
      const sameRound = list.filter((s) => s.roundIndex === span.roundIndex);
      const failIdxInRound = sameRound.findIndex((s) => s.id === span.id);
      const pickIntent = (arr) =>
        [...arr].reverse().find((s) => s.kind === "user" && String(s.input ?? "").trim());
      let intentSpan = pickIntent(sameRound.slice(0, failIdxInRound + 1));
      // 续跑轮次常常没有 user span，回退到本会话此前最近的用户诉求（并标注来源轮次）
      let intentFrom = "本轮";
      if (!intentSpan) {
        const earlier = list.filter((s) => s.roundIndex < span.roundIndex);
        intentSpan = pickIntent(earlier);
        if (intentSpan) intentFrom = `第 ${intentSpan.roundIndex + 1} 轮（本轮无用户发言，继承上文）`;
      }
      const intent = intentSpan
        ? `[${intentFrom}] ${String(intentSpan.input ?? "").trim()}`
        : "";
      // 该轮失败之前的工具序列。整轮可能上百步，只保留失败前最近 20 步（越近越相关）
      const seqAll = sameRound
        .slice(0, failIdxInRound + 1)
        .filter((s) => s.kind === "tool_call" || s.kind === "command")
        .map((s) => `${s.name}${s.status === "success" ? "" : "(失败)"}`);
      const seqTail = seqAll.slice(-20);
      const seqDropped = seqAll.length - seqTail.length;
      const seq = `${seqDropped > 0 ? `（前 ${seqDropped} 步略）… → ` : ""}${seqTail.join(" → ")}`;

      // 会话起始任务：第一个有内容的 user span，用来补齐「继续」「好」这类无信息轮次
      const firstUser = list.find((s) => s.kind === "user" && String(s.input ?? "").trim());
      const taskIntent = firstUser ? String(firstUser.input).trim() : "";

      const prev = list[idx - 1];
      const next = list[idx + 1];
      const brief = (s) =>
        s ? `${s.kind}/${s.name} [${s.status}] ${clip(s.error || s.output || "", 200)}` : "（无）";

      targets.push({
        sessionId,
        spanId: span.id,
        agentName,
        chain,
        input: {
          agentName,
          tool: chain.tool,
          errorKind: chain.signature.kind,
          errorKindLabel: ERROR_KIND_LABEL[chain.signature.kind] ?? chain.signature.kind,
          outcome: chain.outcome,
          attempts: chain.attempts,
          errorText: span.error || chain.signature.summary,
          spanInput: span.input || "",
          spanOutput: span.output || "",
          roundIntent: intent,
          taskIntent,
          toolSequence: seq,
          prevSpan: brief(prev),
          nextSpan: brief(next),
          recurrence: recurrenceByAgent.get(agentId)?.get(chain.signature.family) ?? "",
        },
        rule: suggestRemediation(chain.signature),
      });
    }
  }

  targets.sort((a, b) => b.chain.attempts - a.chain.attempts);
  const list = limitArg > 0 ? targets.slice(0, limitArg) : targets;
  console.log(`待诊断 ${targets.length} 条，本次跑 ${list.length} 条（并发 ${CONCURRENCY}）`);

  let done = 0;
  const cache = noCache || dryRun ? {} : loadCache();
  const cacheKey = (t) => `${cfg.model}::${t.spanId}`;
  const cachedCount = dryRun ? 0 : list.filter((t) => cache[cacheKey(t)]).length;
  if (cachedCount > 0) console.log(`命中缓存 ${cachedCount} 条，需新跑 ${list.length - cachedCount} 条`);

  const results = dryRun
    ? list.map((t) => ({ ...t, diagnosis: null, ms: 0 }))
    : await mapPool(list, CONCURRENCY, async (t) => {
        const hit = cache[cacheKey(t)];
        // 失败也缓存：这条模型跑不通（超时/网关断连），重跑只会再等十几分钟。
        // 缓存键含模型名，换模型会自然重跑；要强制重试用 --no-cache。
        if (hit && hit.__error) return { ...t, error: hit.__error, ms: 0, cached: true };
        if (hit) return { ...t, diagnosis: hit, ms: 0, cached: true };
        const t0 = Date.now();
        try {
          const d = await diagnose(t.input, cfg);
          cache[cacheKey(t)] = d;
          saveCache(cache); // 每跑完一条就落盘，中途断掉不用重跑已完成的
          done += 1;
          process.stderr.write(`\r  进度 ${done}/${list.length - cachedCount}  最近 ${Date.now() - t0}ms      `);
          return { ...t, diagnosis: d, ms: Date.now() - t0 };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          cache[cacheKey(t)] = { __error: msg };
          saveCache(cache);
          done += 1;
          process.stderr.write(`\r  进度 ${done}/${list.length - cachedCount}  最近失败 ${Date.now() - t0}ms      `);
          throw e;
        }
      });
  if (!dryRun) process.stderr.write("\n");

  /* ---------------- 产出报告 ---------------- */
  const now = new Date().toISOString().replace("T", " ").slice(0, 16);
  const ok = dryRun ? [] : results.filter((r) => !r.error);
  const failed = dryRun ? [] : results.filter((r) => r.error);

  const dist = new Map();
  for (const r of ok) {
    const k = r.diagnosis.rootCause;
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }

  const lines = [];
  lines.push(`# ${dryRun ? "诊断证据包（dry-run）" : "根因诊断报告"}`);
  lines.push("");
  lines.push(`- 生成时间：${now}`);
  lines.push(`- 模型：${cfg.model}`);
  lines.push(`- 范围：${argAgent ?? "全部 Agent"}｜待处理失败链 ${targets.length} 条，本次${dryRun ? "装配" : "诊断"} ${list.length} 条`);
  if (!dryRun) {
    const deg = ok.filter((r) => r.diagnosis?.degraded).length;
    lines.push(`- 成功 ${ok.length} 条，失败 ${failed.length} 条${deg > 0 ? `（其中 ${deg} 条证据被裁剪，结论可信度偏低）` : ""}`);
    lines.push(`- ⚠️ 失败 ≠ 没有根因：这些是模型处理不了的输入，不计入你的标注，但也不该当成已解决。`);
  }
  lines.push("");
  if (dist.size > 0) {
    lines.push(`## 根因分布`);
    lines.push("");
    for (const [k, v] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- \`${k}\`（${ROOT_CAUSE_LABEL[k] ?? k}）：${v} 条`);
    }
    lines.push("");
  }
  if (!dryRun) {
    lines.push(`## 怎么标注`);
    lines.push("");
    lines.push(`每条下面有三个勾选框，选一个改成 \`[x]\`：**对**（根因判断正确）/ **半对**（沾边但不准）/ **错**（方向错误）。`);
    lines.push(`不需要写理由；如果某条你想补一句，直接写在"备注"后面。`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");

  results.forEach((r, i) => {
    const t = `第 ${i + 1} 条`;
    lines.push(`### ${t}`);
    lines.push("");
    lines.push(`- Agent：\`${r.agentName}\``);
    if (r.error) {
      // 失败条目也要给全身份，否则看不出漏掉的是哪一次失败、也没法补跑
      lines.push(`- 接口：\`${r.input.tool}\`｜错误形态：${r.input.errorKindLabel}（\`${r.input.errorKind}\`）｜结局：${r.input.outcome}（尝试 ${r.input.attempts} 次）`);
      lines.push(`- 会话：[${r.sessionId.slice(0, 8)}](${TRACE_BASE}/trace/${r.sessionId}?spanId=${encodeURIComponent(r.spanId)})`);
      lines.push("");
      lines.push(`> 模型未能给出结论：${r.error}${r.cached ? "（缓存自上次失败，未重试）" : ""}`);
      lines.push(`> 这一条**不计入**你的标注，但也不能当成"没有根因"——是模型处理不了这条输入。`);
      lines.push("");
      lines.push("---");
      lines.push("");
      return;
    }
    lines.push(`- 接口：\`${r.input.tool}\`｜错误形态：${r.input.errorKindLabel}（\`${r.input.errorKind}\`）｜结局：${r.input.outcome}（尝试 ${r.input.attempts} 次）`);
    // 必须带 origin：markdown 预览里相对路径 /trace/... 点不开，会落到编辑器本地文件协议
    lines.push(`- 会话：[${r.sessionId.slice(0, 8)}](${TRACE_BASE}/trace/${r.sessionId}?spanId=${encodeURIComponent(r.spanId)})`);
    if (r.input.recurrence) lines.push(`- 复发：${r.input.recurrence}`);

    if (dryRun) {
      // dry-run 只检查证据装配：模型会看到的每一块都摊开，便于发现「诉求取空/序列错位」
      lines.push("");
      lines.push(`**会话起始任务**（${(r.input.taskIntent || "").length} 字）：`);
      lines.push("");
      lines.push("```");
      lines.push(clip(r.input.taskIntent, 500) || "（空 —— 整个会话没有 user span，任务背景缺失）");
      lines.push("```");
      lines.push("");
      lines.push(`**该轮用户诉求**（${r.input.roundIntent.length} 字）：`);
      lines.push("");
      lines.push("```");
      lines.push(clip(r.input.roundIntent, 600) || "（空 —— 说明该轮没有 user span，模型会缺关键上下文）");
      lines.push("```");
      lines.push("");
      lines.push(`**工具序列**：\`${r.input.toolSequence || "（空）"}\``);
      lines.push("");
      lines.push(`**前一个 span**：${clip(r.input.prevSpan, 200)}`);
      lines.push("");
      lines.push(`**后一个 span**：${clip(r.input.nextSpan, 200)}`);
      lines.push("");
      lines.push(`**失败入参**：`);
      lines.push("");
      lines.push("```");
      lines.push(clip(r.input.spanInput, 600) || "（空 —— 该 span 没有 input，模型将只能看错误原文）");
      lines.push("```");
      lines.push("");
      lines.push(`**错误原文**：`);
      lines.push("");
      lines.push("```");
      lines.push(clip(r.input.errorText, 500));
      lines.push("```");
      lines.push("");
      lines.push("---");
      lines.push("");
      return;
    }

    const d = r.diagnosis;
    lines.push("");
    lines.push(`**LLM 判定**：\`${d.rootCause}\`（${ROOT_CAUSE_LABEL[d.rootCause] ?? d.rootCause}）　置信度 ${d.confidence.toFixed(2)}　耗时 ${r.cached ? "缓存" : `${r.ms}ms`}${d.degraded ? "　⚠️ 证据被裁剪（原证据超时）" : ""}`);
    lines.push("");
    lines.push(`> ${d.narrative.replace(/\n/g, " ")}`);
    lines.push("");
    if (d.evidenceRefs.length > 0) {
      lines.push(`**引用证据**`);
      lines.push("");
      for (const e of d.evidenceRefs) lines.push(`- \`${clip(e, 200)}\``);
      lines.push("");
    }
    lines.push(`**建议**：${d.suggestion.replace(/\n/g, " ")}`);
    lines.push("");
    lines.push(`**规则版对照**（仅供参考）：${r.rule.rootCause}`);
    lines.push("");
    lines.push(`**错误原文**：`);
    lines.push("");
    lines.push("```");
    lines.push(clip(r.input.errorText, 500));
    lines.push("```");
    lines.push("");
    lines.push(`**失败入参**：`);
    lines.push("");
    lines.push("```");
    lines.push(clip(r.input.spanInput, 400) || "（空）");
    lines.push("```");
    lines.push("");
    lines.push(`**标注**：- [ ] 对　- [ ] 半对　- [ ] 错　　备注：`);
    lines.push("");
    lines.push("---");
    lines.push("");
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n"), "utf8");
  console.log(`\n报告已写出：${OUT}`);
  console.log(`成功 ${ok.length} / 失败 ${failed.length}；根因分布：${[...dist.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);

  await prisma.$disconnect();
})();
