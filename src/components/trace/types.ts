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

export interface SessionOverviewData {
  id: string;
  totalRounds: number;
  totalSpans: number;
  errorCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalTokens: number;
  totalDuration: number;
  model: string;
  status: string;
  rounds: Array<{
    index: number;
    turns: Array<{
      turnId: number;
      spans: Array<{
        id: string;
        tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
        kind: string;
        name: string;
        status: string;
        error?: string;
      }>;
    }>;
    branches?: Array<{
      spans: Array<{
        id: string;
        tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
        kind: string;
        name: string;
        status: string;
        error?: string;
      }>;
    }>;
  }>;
}
