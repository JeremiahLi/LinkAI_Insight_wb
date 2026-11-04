/**
 * 为各 Agent 实例的工作目录创建/修补 .pi/agent.json（PLAN M0.3 配套）。
 *
 * 背景：采集端 session_start 的 agent_name / agent_version 读 `cwd/.pi/agent.json`，
 * 实测全盘一个都没有（149 个采集文件仅 1 个带 agent_version），导致版本维度
 * 完全为空、Agent 名靠 cwd 反推兜底。本脚本：
 *   1. 从 dev.db 按 Agent 分组，用与 derive.ts / backfill-sessions.cjs 完全同源的
 *      cwd 推导逻辑找出各实例的工作目录（众数）；
 *   2. 目录上没有 .pi/agent.json → 创建 { name, version }（name 用库内规范名，
 *      今后采集端直接上报，不再依赖反推）；
 *   3. 已有 → 只补 version（原文件备份为 .bak-<日期>）。
 *
 * 冲突保护：同一个目录被多个 Agent 声称（拆分前同 cwd 的变体），跳过并提示；
 * pi-coding-agent 是框架兜底名（cwd 各不相同），不写。
 *
 * 用法：
 *   node scripts/seed-agent-versions.cjs            # dry-run，只打印计划
 *   node scripts/seed-agent-versions.cjs --apply    # 真正写文件
 */
const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const FALLBACK_AGENT_NAME = "pi-coding-agent";

/* -------- cwd 推导（与 scripts/backfill-sessions.cjs 同规则） -------- */

function cwdCandidatesFrom(input) {
  if (!input) return [];
  const out = [];
  const piRe = /([A-Za-z]:[\\/][^\s"'<>|]*?)[\\/]\.pi[\\/]/g;
  let m;
  while ((m = piRe.exec(input)) !== null) out.push(m[1]);
  const piPosix = /(\/[^\s"'<>|]*?)\/\.pi\//g;
  while ((m = piPosix.exec(input)) !== null) out.push(m[1]);
  const cdRe = /cd\s+(?:"([^"]+)"|'([^']+)'|([^\s&;|]+))/g;
  while ((m = cdRe.exec(input)) !== null) {
    const p = m[1] || m[2] || m[3];
    if (p && (/^[A-Za-z]:[\\/]/.test(p) || /^\/[A-Za-z]?\//.test(p) || /^\/[a-z]\//.test(p))) out.push(p);
  }
  return out.map((s) => s.replace(/[\\/]+$/, "")).filter((s) => s.length > 2);
}

function deriveWorkspace(spans) {
  const counts = new Map();
  for (const sp of spans) {
    if (sp.kind !== "tool_call" && sp.kind !== "command") continue;
    for (const c of cwdCandidatesFrom(sp.input)) {
      const key = /^[A-Za-z]:/.test(c) ? c.toLowerCase() : c;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let best = null;
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/* --------------------------------- 主流程 --------------------------------- */

(async () => {
  console.log(APPLY ? "== 写入模式 ==" : "== DRY-RUN（只打印；加 --apply 执行）==");

  const agents = await prisma.agent.findMany({
    select: { id: true, name: true, version: true },
  });
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const sessions = await prisma.session.findMany({ select: { id: true, agentId: true } });
  const sessionsByAgent = new Map();
  for (const s of sessions) {
    if (!sessionsByAgent.has(s.agentId)) sessionsByAgent.set(s.agentId, []);
    sessionsByAgent.get(s.agentId).push(s.id);
  }

  const spans = await prisma.span.findMany({
    where: { kind: { in: ["tool_call", "command"] } },
    select: { sessionId: true, kind: true, input: true },
  });
  const spansBySession = new Map();
  for (const sp of spans) {
    if (!spansBySession.has(sp.sessionId)) spansBySession.set(sp.sessionId, []);
    spansBySession.get(sp.sessionId).push(sp);
  }

  // 目录存在性缓存：Windows 路径大小写不敏感，统一小写做键
  const dirClaims = new Map(); // lowerDir -> Set<agentName>
  const plan = [];

  for (const [agentId, sessionIds] of sessionsByAgent) {
    const agent = agentById.get(agentId);
    if (!agent || agent.name === FALLBACK_AGENT_NAME) continue;

    const counts = new Map();
    for (const sid of sessionIds) {
      const ws = deriveWorkspace(spansBySession.get(sid) || []);
      if (!ws) continue;
      counts.set(ws, (counts.get(ws) || 0) + 1);
    }
    if (counts.size === 0) continue;
    // 众数目录；并列时取会话数最多的
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [dirLower, hits] = sorted[0];
    const runnerUp = sorted[1];

    // 还原真实大小写：用 Node 在父目录里找匹配项
    const realDir = resolveCase(dirLower);
    if (!realDir || !fs.existsSync(realDir)) {
      console.log(`[skip] ${agent.name}：目录不存在 ${dirLower}`);
      continue;
    }
    const claims = dirClaims.get(dirLower.toLowerCase()) || new Set();
    claims.add(agent.name);
    dirClaims.set(dirLower.toLowerCase(), claims);

    plan.push({
      agentName: agent.name,
      version: agent.version || "1.0.0",
      dir: realDir,
      sessions: hits,
      ambiguous: runnerUp && runnerUp[1] === hits,
    });
  }

  // 冲突检查：一个目录多个 Agent 声称 → 都跳过（人工裁决）
  for (const p of plan) {
    const claims = dirClaims.get(p.dir.toLowerCase());
    if (claims && claims.size > 1) p.conflict = [...claims].join(" vs ");
  }

  console.log(`\n共 ${plan.length} 个 Agent 有可定位目录：`);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const p of plan) {
    const tag = p.conflict ? `冲突[${p.conflict}]` : p.ambiguous ? "并列众数" : `${p.sessions} 会话`;
    const jsonPath = path.join(p.dir, ".pi", "agent.json");
    if (p.conflict) {
      console.log(`  [冲突跳过] ${p.agentName} → ${p.dir}（${tag}）`);
      skipped++;
      continue;
    }
    if (fs.existsSync(jsonPath)) {
      try {
        const cur = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
        if (cur.version === p.version && cur.name === p.agentName) {
          console.log(`  [已是最新] ${p.agentName} → ${jsonPath}`);
          continue;
        }
        console.log(`  [改写] ${p.agentName} → ${jsonPath}（name:${cur.name ?? "?"}→${p.agentName}, version:${cur.version ?? "?"}→${p.version}）`);
        if (APPLY) {
          const bak = jsonPath + ".bak-" + new Date().toISOString().slice(0, 10);
          fs.copyFileSync(jsonPath, bak);
          cur.name = p.agentName;
          cur.version = p.version;
          fs.writeFileSync(jsonPath, JSON.stringify(cur, null, 2));
        }
        updated++;
      } catch (e) {
        console.log(`  [跳过] ${jsonPath} 解析失败：${e.message}`);
        skipped++;
      }
    } else {
      console.log(`  [新建] ${p.agentName} → ${jsonPath}（${tag}）`);
      if (APPLY) {
        fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
        fs.writeFileSync(
          jsonPath,
          JSON.stringify({ name: p.agentName, version: p.version }, null, 2),
        );
      }
      created++;
    }
  }

  console.log(`\n合计：新建 ${created} · 改写 ${updated} · 跳过 ${skipped}`);
  if (!APPLY) console.log("\nDRY-RUN 结束。确认无误后执行：node scripts/seed-agent-versions.cjs --apply");
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/** 把小写化的路径还原为磁盘上的真实大小写（逐段匹配；找不到返回 null） */
function resolveCase(lowerPath) {
  const normalized = lowerPath.replace(/\//g, "\\");
  const parts = normalized.split("\\").filter(Boolean);
  // 首段是盘符（如 e:）
  if (!/^[a-z]:$/.test(parts[0] || "")) return null;
  let cur = parts[0].toUpperCase() + "\\";
  for (let i = 1; i < parts.length; i++) {
    let entries;
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      return null;
    }
    const hit = entries.find((e) => e.name.toLowerCase() === parts[i]);
    if (!hit) return null;
    cur = path.join(cur, hit.name);
  }
  return cur;
}
