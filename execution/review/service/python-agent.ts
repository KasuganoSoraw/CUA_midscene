import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentEvent,
  AgentInvocationRequest,
  AgentInvocationResult,
  AgentStatus,
} from '../shared/agent.js';

export interface PythonAgentControl {
  status(): Promise<AgentStatus>;
  invoke(request: AgentInvocationRequest): Promise<AgentInvocationResult>;
  close(): Promise<void>;
}

interface PythonAgentLaunch {
  agentRoot: string;
  pythonExecutable: string;
  nodeExecutable: string;
  runtimeBridge: string;
}

interface PythonAgentInvokerOptions {
  executionRoot: string;
  dataRoot: string;
  agentRoot?: string;
  pythonExecutable?: string;
  nodeExecutable?: string;
  runtimeBridge?: string;
  timeoutMs?: number;
  spawnProcess?: typeof spawn;
}

interface AgentProtocolFrame {
  type?: unknown;
  event?: unknown;
  result?: unknown;
  error?: unknown;
}

const maxStdoutBytes = 4 * 1024 * 1024;
const maxDiagnosticsBytes = 32 * 1024;

function limitedAppend(current: string, chunk: Buffer | string, limit: number): string {
  return `${current}${chunk.toString()}`.slice(-limit);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function modelConfigured(): boolean {
  const configured = (primary: string, fallback: string) =>
    Boolean(process.env[primary]?.trim() || process.env[fallback]?.trim());
  return configured('CUA_AGENT_MODEL_BASE_URL', 'MIDSCENE_MODEL_BASE_URL')
    && configured('CUA_AGENT_MODEL_NAME', 'MIDSCENE_MODEL_NAME')
    && configured('CUA_AGENT_MODEL_API_KEY', 'MIDSCENE_MODEL_API_KEY');
}

export function pythonAgentPaths(options: PythonAgentInvokerOptions): PythonAgentLaunch {
  const executionRoot = path.resolve(options.executionRoot);
  const agentRoot = path.resolve(
    options.agentRoot ?? process.env.CUA_AGENT_ROOT ?? path.join(executionRoot, '..', 'agent'),
  );
  const defaultPython = process.platform === 'win32'
    ? path.join(agentRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(agentRoot, '.venv', 'bin', 'python');
  return {
    agentRoot,
    pythonExecutable: path.resolve(
      options.pythonExecutable ?? process.env.CUA_AGENT_PYTHON_EXECUTABLE ?? defaultPython,
    ),
    nodeExecutable: path.resolve(
      options.nodeExecutable ?? process.env.CUA_AGENT_NODE_EXECUTABLE ?? process.execPath,
    ),
    runtimeBridge: path.resolve(
      options.runtimeBridge
        ?? process.env.CUA_AGENT_RUNTIME_BRIDGE
        ?? path.join(executionRoot, 'dist', 'runtime-bridge', 'worker.js'),
    ),
  };
}

export class PythonAgentInvoker implements PythonAgentControl {
  private child?: ChildProcessWithoutNullStreams;

  constructor(private readonly options: PythonAgentInvokerOptions) {}

  async status(): Promise<AgentStatus> {
    const launch = pythonAgentPaths(this.options);
    const [agentRootReady, pythonReady, nodeReady, bridgeReady] = await Promise.all([
      fileExists(path.join(launch.agentRoot, 'pyproject.toml')),
      fileExists(launch.pythonExecutable),
      fileExists(launch.nodeExecutable),
      fileExists(launch.runtimeBridge),
    ]);
    const hasModel = modelConfigured();
    const reasons = [
      ...(!agentRootReady ? [`找不到 Python Agent：${launch.agentRoot}`] : []),
      ...(!pythonReady ? [`找不到 Agent Python executable：${launch.pythonExecutable}`] : []),
      ...(!nodeReady ? [`找不到 Node executable：${launch.nodeExecutable}`] : []),
      ...(!bridgeReady ? [`找不到已构建 Runtime bridge：${launch.runtimeBridge}`] : []),
      ...(!hasModel ? ['未配置 CUA_AGENT_MODEL_* 或兼容的 MIDSCENE_MODEL_*'] : []),
    ];
    return {
      available: reasons.length === 0,
      name: 'Computer-Use',
      invocationMode: 'stateless-task',
      runtime: 'python',
      modelConfigured: hasModel,
      ...(reasons.length ? { reason: reasons.join('；') } : {}),
    };
  }

  async invoke(request: AgentInvocationRequest): Promise<AgentInvocationResult> {
    if (this.child) {
      throw Object.assign(new Error('已有 CUA Agent invocation 正在执行，请等待完成'), {
        statusCode: 409,
      });
    }
    const status = await this.status();
    if (!status.available) {
      throw Object.assign(new Error(status.reason ?? 'Python CUA Agent 不可用'), {
        statusCode: 503,
      });
    }
    const task = typeof request.task === 'string' ? request.task.trim() : '';
    if (!task) throw new Error('Subagent task 必须是非空字符串');
    const invocationId = request.invocationId?.trim() || randomUUID();
    const launch = pythonAgentPaths(this.options);
    const timeoutMs = this.options.timeoutMs ?? 30 * 60 * 1000;

    return new Promise<AgentInvocationResult>((resolve, reject) => {
      let stdout = '';
      let diagnostics = '';
      let settled = false;
      const child = (this.options.spawnProcess ?? spawn)(
        launch.pythonExecutable,
        ['-m', 'cua_agent', 'invoke'],
        {
          cwd: launch.agentRoot,
          env: {
            ...process.env,
            PYTHONUTF8: '1',
            CUA_AGENT_NODE_EXECUTABLE: launch.nodeExecutable,
            CUA_AGENT_RUNTIME_BRIDGE: launch.runtimeBridge,
            CUA_DATA_ROOT: this.options.dataRoot,
          },
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      this.child = child;
      const timeout = setTimeout(() => child.kill(), timeoutMs);

      const finish = (error?: Error, result?: AgentInvocationResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.child = undefined;
        if (error) reject(error);
        else if (result) resolve(result);
        else reject(new Error('Python CUA Agent 未返回结果'));
      };

      child.stdout.on('data', (chunk) => {
        stdout = limitedAppend(stdout, chunk, maxStdoutBytes);
      });
      child.stderr.on('data', (chunk) => {
        diagnostics = limitedAppend(diagnostics, chunk, maxDiagnosticsBytes);
      });
      child.once('error', (error) => finish(new Error(`无法启动 Python CUA Agent：${error.message}`)));
      child.once('close', (code, signal) => {
        const frames: AgentProtocolFrame[] = [];
        try {
          for (const line of stdout.split(/\r?\n/u).filter((item) => item.trim())) {
            const frame: unknown = JSON.parse(line);
            if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
              throw new Error('Agent protocol frame 必须是 object');
            }
            frames.push(frame as AgentProtocolFrame);
          }
        } catch (error) {
          finish(new Error(`无法解析 Python CUA Agent 输出：${String(error)}\n${diagnostics.trim()}`));
          return;
        }
        const errorFrame = frames.find((frame) => frame.type === 'error');
        if (errorFrame) {
          const value = errorFrame.error as { message?: unknown } | undefined;
          finish(new Error(String(value?.message ?? diagnostics.trim() ?? 'Python Agent 启动失败')));
          return;
        }
        const rawResult = [...frames].reverse().find((frame) => frame.type === 'result')?.result;
        if (code !== 0 || !rawResult || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
          finish(new Error(
            diagnostics.trim()
              || `Python CUA Agent 未正常完成：exit=${String(code)} signal=${signal ?? '-'}`,
          ));
          return;
        }
        const events = frames
          .filter((frame) => frame.type === 'event')
          .map((frame) => frame.event)
          .filter((event): event is AgentEvent => Boolean(event && typeof event === 'object'));
        finish(undefined, { ...(rawResult as Omit<AgentInvocationResult, 'events'>), events });
      });

      child.stdin.end(JSON.stringify({ task, invocationId }));
    });
  }

  async close(): Promise<void> {
    this.child?.kill();
    this.child = undefined;
  }
}
