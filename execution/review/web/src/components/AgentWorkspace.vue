<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import type {
  AgentEvent,
  AgentInvocationResult,
  AgentStatus,
  AgentToolTrace,
} from '../../../shared/agent';
import { api } from '../api';
import { appendVisibleAgentEvent } from '../agent-progress';

interface InvocationRecord {
  task: string;
  submittedAt: string;
  events: AgentEvent[];
  visibleEvents: AgentEvent[];
  liveText: string;
  lastVisibleTurn?: number;
  result?: AgentInvocationResult;
  error?: string;
}

const agentStatus = ref<AgentStatus>();
const statusError = ref('');
const message = ref('');
const busy = ref(false);
const records = ref<InvocationRecord[]>([]);
const canSubmit = computed(() => Boolean(agentStatus.value?.available && message.value.trim() && !busy.value));

function statusLabel(status: AgentInvocationResult['status']): string {
  return ({ completed: '已完成', 'needs-input': '等待补充', failed: '未完成', cancelled: '已取消' })[status];
}

function toolStatusLabel(status: AgentToolTrace['status']): string {
  return status === 'succeeded' ? '成功' : '失败';
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function eventDetail(event: AgentEvent): string {
  if (event.type === 'assistant.delta') return String(event.data?.text ?? '');
  if (event.type === 'tool.started' || event.type === 'tool.completed') {
    return json(event.data).slice(0, 4000);
  }
  return event.message ?? '';
}

function progressStatus(event: AgentEvent): string {
  const status = event.data?.status;
  return typeof status === 'string' ? status : 'running';
}

function progressSymbol(event: AgentEvent): string {
  return ({ running: '●', succeeded: '✓', failed: '×', cancelled: '–' })[progressStatus(event)] ?? '●';
}

function progressAction(event: AgentEvent): string {
  const action = event.data?.action;
  return typeof action === 'string' ? action : (event.message ?? 'Action');
}

function progressDescription(event: AgentEvent): string | undefined {
  const description = event.data?.description;
  return typeof description === 'string' ? description : undefined;
}

function workbenchUrl(trace: AgentToolTrace): string | undefined {
  const value = trace.output?.url;
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : undefined;
}

async function refreshStatus(): Promise<void> {
  statusError.value = '';
  try {
    agentStatus.value = await api.agentStatus();
  } catch (error) {
    agentStatus.value = undefined;
    statusError.value = error instanceof Error ? error.message : String(error);
  }
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  const text = message.value.trim();
  const record = reactive<InvocationRecord>({
    task: text,
    submittedAt: new Date().toISOString(),
    events: [],
    visibleEvents: [],
    liveText: '',
  });
  records.value.unshift(record);
  message.value = '';
  busy.value = true;
  try {
    record.result = await api.streamAgent({ task: text }, (event) => {
      record.events.push(event);
      appendVisibleAgentEvent(record.visibleEvents, event);
      if (event.type === 'assistant.delta' && typeof event.data?.text === 'string') {
        const turn = typeof event.data.turn === 'number' ? event.data.turn : undefined;
        if (record.liveText && turn !== record.lastVisibleTurn) record.liveText += '\n\n';
        record.liveText += event.data.text;
        record.lastVisibleTurn = turn;
      }
    });
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    await refreshStatus();
  } finally {
    busy.value = false;
  }
}

function handleComposerKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void submit();
  }
}

onMounted(refreshStatus);
</script>

<template>
  <section class="agent-console">
    <aside class="panel agent-identity">
      <div class="panel-heading">
        <div><p class="eyebrow">SUBAGENT ENDPOINT</p><h2>统一调用入口</h2></div>
      </div>
      <div class="agent-identity-content">
        <div class="agent-availability" :class="{ available: agentStatus?.available }">
          <span></span>
          <div>
            <strong>{{ agentStatus?.available ? 'Python Agent 可用' : 'Python Agent 不可用' }}</strong>
            <small>{{ agentStatus?.reason ?? (statusError || '可以提交 Computer-Use 任务') }}</small>
          </div>
        </div>

        <div class="agent-definition-card">
          <small>CANONICAL AGENT</small>
          <strong>{{ agentStatus?.name ?? 'Computer-Use' }}</strong>
          <p>这里直接调用 canonical Python invocation；内部 Tool 不注册为 Host 公共 Tool，页面仅展示受控诊断摘要。</p>
        </div>

        <div class="agent-tools">
          <small>RUNTIME BOUNDARY</small>
          <code>{{ agentStatus?.runtime ?? 'python' }}</code>
          <code>{{ agentStatus?.modelConfigured ? 'model configured' : 'model missing' }}</code>
        </div>

        <button class="secondary" :disabled="busy" @click="refreshStatus">刷新连接状态</button>
      </div>
    </aside>

    <section class="panel agent-invocations">
      <div class="panel-heading agent-heading">
        <div><p class="eyebrow">INVOCATIONS</p><h2>Subagent 调用记录</h2></div>
        <span>{{ records.length }} 次</span>
      </div>

      <div class="agent-records">
        <div v-if="!records.length" class="agent-empty">
          <span>◎</span>
          <strong>提交一个完整的 Computer-Use 任务</strong>
          <p>每次提交都是不继承上下文的独立任务。页面实时展示调用事件，不选择执行策略，也不会绕过 Subagent 直接操作桌面。</p>
        </div>

        <article v-for="record in records" :key="record.submittedAt" class="agent-record">
          <header>
            <div><span class="agent-record-mark">USER</span><time>{{ new Date(record.submittedAt).toLocaleTimeString() }}</time></div>
            <p>{{ record.task }}</p>
          </header>

          <div v-if="record.error" class="agent-record-error">{{ record.error }}</div>
          <div v-else-if="record.result" class="agent-result">
            <div class="agent-result-heading">
              <span class="agent-record-mark subagent">SUBAGENT</span>
              <span class="agent-result-status" :class="record.result.status">{{ statusLabel(record.result.status) }}</span>
              <code>{{ record.result.invocationId }}</code>
            </div>
            <p class="agent-reply">{{ record.result.reply }}</p>

            <div v-if="record.result.toolCalls.length" class="agent-traces">
              <details v-for="trace in record.result.toolCalls" :key="trace.callId">
                <summary>
                  <code>{{ trace.tool }}</code>
                  <span :class="trace.status">{{ toolStatusLabel(trace.status) }}</span>
                </summary>
                <div class="agent-trace-grid">
                  <label>INPUT<pre>{{ json(trace.input) }}</pre></label>
                  <label v-if="trace.output">OUTPUT<pre>{{ json(trace.output) }}</pre></label>
                  <p v-if="trace.error" class="agent-trace-error">{{ trace.error }}</p>
                  <a v-if="workbenchUrl(trace)" :href="workbenchUrl(trace)" target="_blank" rel="noreferrer">
                    打开 Workbench ↗
                  </a>
                </div>
              </details>
            </div>
            <p v-else class="agent-no-tools">本次调用没有 Tool 轨迹。</p>
          </div>
          <div v-else class="agent-pending">
            <div class="agent-pending-label"><span></span>Subagent 正在处理这次任务…</div>
            <p v-if="record.liveText" class="agent-reply">{{ record.liveText }}</p>
          </div>
          <details v-if="record.visibleEvents.length" class="agent-event-log" open>
            <summary>实时事件 · {{ record.visibleEvents.length }}</summary>
            <div class="agent-trace-grid">
              <div v-for="(event, index) in record.visibleEvents" :key="index">
                <div v-if="event.type === 'execution.progress'" class="agent-progress-row">
                  <span class="agent-progress-mark" :class="progressStatus(event)">{{ progressSymbol(event) }}</span>
                  <div class="agent-progress-copy">
                    <strong>{{ progressAction(event) }}</strong>
                    <small v-if="progressDescription(event)">{{ progressDescription(event) }}</small>
                  </div>
                </div>
                <template v-else>
                  <code>{{ event.type }}</code>
                  <pre v-if="eventDetail(event)">{{ eventDetail(event) }}</pre>
                </template>
              </div>
            </div>
          </details>
        </article>
      </div>

      <div class="agent-composer">
        <label for="agent-message">本次任务</label>
        <textarea
          id="agent-message"
          v-model="message"
          rows="4"
          :disabled="!agentStatus?.available || busy"
          placeholder="例如：打开 Chrome，查询 NE001 的当前告警，并告诉我结果"
          @keydown="handleComposerKeydown"
        ></textarea>
        <div>
          <span>{{ agentStatus?.available ? 'Ctrl + Enter 提交 · 每次调用相互独立' : '准备 Python Agent、模型和 Runtime 后才可提交' }}</span>
          <button class="primary" :disabled="!canSubmit" @click="submit">{{ busy ? '正在调用…' : '提交任务' }}</button>
        </div>
      </div>
    </section>
  </section>
</template>
