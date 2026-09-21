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
import { useI18n } from '../i18n';

const { t, formatTime } = useI18n();

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
  return ({
    completed: t('agent.completed'),
    'needs-input': t('agent.needsInput'),
    failed: t('agent.failed'),
    cancelled: t('agent.cancelled'),
  })[status];
}

function toolStatusLabel(status: AgentToolTrace['status']): string {
  return status === 'succeeded' ? t('agent.toolSucceeded') : t('agent.toolFailed');
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
        <div><p class="eyebrow">{{ t('agent.endpoint') }}</p><h2>{{ t('agent.entry') }}</h2></div>
      </div>
      <div class="agent-identity-content">
        <div class="agent-availability" :class="{ available: agentStatus?.available }">
          <span></span>
          <div>
            <strong>{{ agentStatus?.available ? t('agent.available') : t('agent.unavailable') }}</strong>
            <small>{{ agentStatus?.reason ?? (statusError || t('agent.ready')) }}</small>
          </div>
        </div>

        <div class="agent-definition-card">
          <small>{{ t('agent.definition') }}</small>
          <strong>{{ agentStatus?.name ?? 'Computer-Use' }}</strong>
          <p>{{ t('agent.definitionHelp') }}</p>
        </div>

        <div class="agent-tools">
          <small>{{ t('agent.runtimeBoundary') }}</small>
          <code>{{ agentStatus?.runtime ?? 'python' }}</code>
          <code>{{ agentStatus?.modelConfigured ? t('agent.modelConfigured') : t('agent.modelMissing') }}</code>
        </div>

        <button class="secondary" :disabled="busy" @click="refreshStatus">{{ t('agent.refresh') }}</button>
      </div>
    </aside>

    <section class="panel agent-invocations">
      <div class="panel-heading agent-heading">
        <div><p class="eyebrow">{{ t('agent.invocations') }}</p><h2>{{ t('agent.invocations') }}</h2></div>
        <span>{{ t('agent.count', { count: records.length }) }}</span>
      </div>

      <div class="agent-records">
        <div v-if="!records.length" class="agent-empty">
          <span>◎</span>
          <strong>{{ t('agent.emptyTitle') }}</strong>
          <p>{{ t('agent.emptyHelp') }}</p>
        </div>

        <article v-for="record in records" :key="record.submittedAt" class="agent-record">
          <header>
            <div><span class="agent-record-mark">USER</span><time>{{ formatTime(record.submittedAt) }}</time></div>
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
                    {{ t('agent.openWorkbench') }}
                  </a>
                </div>
              </details>
            </div>
            <p v-else class="agent-no-tools">{{ t('agent.noTools') }}</p>
          </div>
          <div v-else class="agent-pending">
            <div class="agent-pending-label"><span></span>{{ t('agent.pending') }}</div>
            <p v-if="record.liveText" class="agent-reply">{{ record.liveText }}</p>
          </div>
          <details v-if="record.visibleEvents.length" class="agent-event-log" open>
            <summary>{{ t('agent.events', { count: record.visibleEvents.length }) }}</summary>
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
        <label for="agent-message">{{ t('agent.task') }}</label>
        <textarea
          id="agent-message"
          v-model="message"
          rows="4"
          :disabled="!agentStatus?.available || busy"
          :placeholder="t('agent.placeholder')"
          @keydown="handleComposerKeydown"
        ></textarea>
        <div>
          <span>{{ agentStatus?.available ? t('agent.submitHint') : t('agent.notReadyHint') }}</span>
          <button class="primary" :disabled="!canSubmit" @click="submit">{{ busy ? t('agent.submitting') : t('agent.submit') }}</button>
        </div>
      </div>
    </section>
  </section>
</template>
