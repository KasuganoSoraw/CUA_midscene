import type { JsonObject } from '../../cua/contracts/types.js';

export interface AgentInvocationRequest {
  task: string;
  invocationId?: string;
}

export type AgentInvocationStatus = 'completed' | 'needs-input' | 'failed' | 'cancelled';

export interface AgentToolTrace {
  callId: string;
  tool: string;
  input: JsonObject;
  status: 'succeeded' | 'failed';
  output?: JsonObject;
  error?: string;
}

export interface AgentEvent {
  schemaVersion: '1.0';
  invocationId: string;
  type:
    | 'agent.started'
    | 'progress'
    | 'tool.started'
    | 'tool.completed'
    | 'execution.started'
    | 'agent.completed'
    | 'failed'
    | 'needs-input'
    | 'cancelled';
  timestamp: string;
  message?: string;
  data?: JsonObject;
}

export interface AgentInvocationResult {
  schemaVersion: '1.0';
  invocationId: string;
  status: AgentInvocationStatus;
  reply: string;
  toolCalls: AgentToolTrace[];
  data?: JsonObject;
  error?: string;
  events: AgentEvent[];
}

export interface AgentStatus {
  available: boolean;
  name: 'Computer-Use';
  invocationMode: 'stateless-task';
  runtime: 'python';
  modelConfigured: boolean;
  reason?: string;
}

