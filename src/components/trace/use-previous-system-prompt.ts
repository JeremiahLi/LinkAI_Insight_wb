"use client";

import { useMemo } from "react";

/**
 * Checks whether the current round's system prompt content is the same
 * as the previous round's system prompt content.
 *
 * @param content - The current round's system prompt content.
 * @param roundIndex - The current round index (0-based).
 * @param allRounds - Optional list of all rounds (used by detail panel).
 * @returns true if content matches the previous round's system prompt.
 */
export function usePreviousSystemPrompt(
  content: string,
  roundIndex: number,
  allRounds?: Array<{ index: number; systemPromptSpan?: { input?: string } }>,
): boolean {
  return useMemo(() => {
    if (roundIndex <= 0) return false;

    const rounds = allRounds;
    if (!rounds || rounds.length === 0) return false;

    // Find the previous round by index
    const prevRound = rounds.find((r) => r.index === roundIndex - 1);
    if (!prevRound?.systemPromptSpan?.input) return false;

    return prevRound.systemPromptSpan.input === content;
  }, [content, roundIndex, allRounds]);
}