import { Prisma } from "@prisma/client";

/**
 * 会话成败口径的唯一来源（SQL 片段，均假设表别名是 s）。
 *
 * 为什么单独抽出来：agent-board / agent-detail / trend 三处都要算成功率，
 * 口径一旦分裂就会出现「看板 96%、下钻 91%」这类自相矛盾的数字。
 *
 * 规则（2026-11-04 修订）：
 * 1. 完成会话 = 非 active 且非空会话。空会话（采集端建了 session 但没上传 span）
 *    既没成功也没失败，不进分母。
 * 2. 失败会话 = outcome='failed' 或 'truncated'。truncated 是 2026-11-04 新增的
 *    假失败终态（末轮无输出但此前有交付、无新追问），观察期内暂按 failed 计入
 *    成功率分母，详情页单独标注；两周后再决定是否剔除。
 *    outcome='' 表示历史数据未回填，回退到旧口径（errorCount>0 或 status='error'），
 *    保证回填脚本执行前看板数字不跳变。
 * 3. 部分成功 = outcome='partial'，有交付且存在**未自愈**的失败（工具失败经
 *    failure-chain 判 retried_recovered 的不算，见 derive.computeOutcome）。
 *    折算权重在 TS 侧（health.ts 的 successRateOf，按半失败计）。
 */
export const SQL_FINISHED = Prisma.sql`(s.status <> 'active' AND (s.outcome <> '' OR s.totalSpans > 0))`;
export const SQL_BAD = Prisma.sql`(s.outcome IN ('failed', 'truncated') OR (s.outcome = '' AND (s.errorCount > 0 OR s.status = 'error')))`;
export const SQL_PARTIAL = Prisma.sql`(s.outcome = 'partial')`;
/** truncated 单列：详情页标注与体检脚本用，不参与 successRateOf 权重（暂并入 BAD） */
export const SQL_TRUNCATED = Prisma.sql`(s.outcome = 'truncated')`;
