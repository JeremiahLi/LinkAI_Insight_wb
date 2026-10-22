export interface SpanNode {
  id: string;
  roundIndex: number;
  turnId: number;
  parentId: string | null;
  branchId: string | null;
  kind: string;
  name: string;
  status: string;
  startTime: number;
  duration: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  model?: string;
  input?: string;
  output?: string;
  error?: string;
  llmThinkDuration?: number;
  agentReplyDuration?: number;
  toolDuration?: number;
  details?: string;
  content?: string;
  isForkPoint: boolean;
}

export interface TurnNode {
  id: string;
  roundIndex: number;
  turnId: number;
  spans: SpanNode[];
}

export interface RoundNode {
  id: string;
  sessionId: string;
  index: number;
  inputSpan?: SpanNode;
  systemPromptSpan?: SpanNode;
  answerSpan?: SpanNode;
  turns: TurnNode[];
  isForkPoint?: boolean;
  branches?: BranchNode[];
}

export interface BranchNode {
  id: string;
  roundId: string;
  name: string;
  spans: SpanNode[];
  isActive: boolean;
}

export interface SessionNode {
  id: string;
  totalRounds: number;
  totalSpans: number;
  rounds: RoundNode[];
}

export interface SessionDetail {
  id: string;
  projectId: string;
  projectName: string;
  userId: string;
  userName: string;
  userOrg: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  status: string;
  /** 会话标题（首条用户诉求），空串表示采集端未提供且无法派生 */
  title: string;
  /** success / partial / failed / 空串=未知 */
  outcome: string;
  model: string;
  startTime: string;
  endTime: string | null;
  totalRounds: number;
  totalSpans: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  totalDuration: number;
  forkCount: number;
  rounds: RoundNode[];
}
