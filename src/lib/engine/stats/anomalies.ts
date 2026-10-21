/**
 * Agent 异常判定的统一口径。
 * 概览仪表盘的异常预警（/api/stats）与 Agent 性能看板的「异常 Agent」
 * （/api/agents/stats）都必须走这里的同一套阈值，避免两处各算各的。
 */

/** 单 Agent 错误率阈值（占比） */
export const AGENT_ERROR_RATE_THRESHOLD = 0.3;

/** 触发判定的最少 Session 数（样本过小不判异常） */
export const AGENT_ERROR_MIN_SESSIONS = 2;

export interface AgentErrorStat {
  total: number;
  errors: number;
}

/** 判定某 Agent 是否异常：错误率超过阈值且样本量足够 */
export function isAgentAnomalous({ total, errors }: AgentErrorStat): boolean {
  return total >= AGENT_ERROR_MIN_SESSIONS && errors / total > AGENT_ERROR_RATE_THRESHOLD;
}
