import type { z } from 'zod';

export type MCP_Verdict = 'PASS' | 'AMBER' | 'ZERO';

export interface ToolResult {
  verdict: MCP_Verdict;
  reason_code: string | null;
}

export interface ToolError {
  message: string;
  code?: string;
}

export type ToolEntry = {
  input: z.ZodTypeAny;
  run: (args: unknown) => Promise<unknown>;
};
