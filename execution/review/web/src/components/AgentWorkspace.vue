<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type {
  AgentInvocationResult,
  AgentStatus,
  AgentToolTrace,
} from '../../../shared/agent';
import { api } from '../api';

interface InvocationRecord {
  task: string;
  submittedAt: string;
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
  const record: InvocationRecord = { task: text, submittedAt: new Date().toISOString() };
  records.value.unshift(record);
  message.value = '';
  busy.value = true;
  try {
    record.result = await api.invokeAgent({ task: text });
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
          <p>每次提交都是不继承上下文的独立任务。当前 HTTP 调用在完成后一次性返回累计事件；页面不选择执行策略，也不会绕过 Subagent 直接操作桌面。</p>
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

            <details v-if="record.result.events.length" class="agent-event-log">
              <summary>调用事件 · {{ record.result.events.length }}</summary>
              <div class="agent-trace-grid">
                <pre>{{ json(record.result.events) }}</pre>
              </div>
            </details>

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
          <div v-else class="agent-pending"><span></span>Subagent 正在处理这次任务…</div>
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
