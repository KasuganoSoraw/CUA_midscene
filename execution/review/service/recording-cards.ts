import { randomUUID } from 'node:crypto';
import type {
  RecordingCard,
  RecordingCardInput,
  RecordingCardPage,
  RecentRecordingCard,
} from '../shared/recording-cards.js';
import type { RecordingEntry } from '../../cua/recording/recording-catalog.js';
import { JsonStore } from './json-store.js';

const failure = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

interface CardState {
  version: number;
  cards: RecordingCard[];
  visits: Record<string, string>;
  imports: string[];
  session: string | null;
}

const CURRENT_VERSION = 1;

const emptyState = (): CardState => ({
  version: CURRENT_VERSION,
  cards: [],
  visits: {},
  imports: [],
  session: null,
});

/**
 * 流程卡片存储。
 *
 * 原实现基于 better-sqlite3；原生模块绑定编译期 Node ABI，与宿主运行时
 * （Electron 内置 Node）不一致时会加载失败，故改为 JSON 文件存储，
 * 对外方法签名与语义保持不变。
 */
export class RecordingCardStore {
  private readonly store: JsonStore<CardState>;

  constructor(filename: string) {
    this.store = new JsonStore(filename, emptyState);
    if (this.store.value.version > CURRENT_VERSION) {
      throw new Error('工作台数据库版本高于当前程序支持的版本');
    }
  }

  close(): void {
    // JSON 存储无连接需要释放，保留方法以维持调用方契约。
  }

  get(id: string): RecordingCard {
    const card = this.store.value.cards.find((item) => item.id === id);
    if (!card) throw failure('流程卡片不存在', 404);
    return { ...card };
  }

  create(input: RecordingCardInput): RecordingCard {
    const now = new Date().toISOString();
    const card: RecordingCard = {
      id: randomUUID(),
      name: input.name.trim(),
      description: input.description.trim(),
      recordingId: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.store.update((state) => {
      state.cards.push(card);
    });
    return { ...card };
  }

  update(
    id: string,
    input: RecordingCardInput,
    version: number,
  ): RecordingCard {
    this.get(id);
    const target = this.store.value.cards.find((item) => item.id === id)!;
    if (target.version !== version) {
      throw failure('卡片已更新，请刷新后重试', 409);
    }
    this.store.update((state) => {
      const card = state.cards.find((item) => item.id === id)!;
      card.name = input.name.trim();
      card.description = input.description.trim();
      card.updatedAt = new Date().toISOString();
      card.version += 1;
    });
    return this.get(id);
  }

  list(query: string, page: number, pageSize: number): RecordingCardPage {
    const needle = query.trim().toLowerCase();
    const matched = this.store.value.cards
      .filter(
        (card) =>
          !needle ||
          card.name.toLowerCase().includes(needle) ||
          card.description.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        if (a.updatedAt === b.updatedAt) return a.id < b.id ? 1 : -1;
        return a.updatedAt < b.updatedAt ? 1 : -1;
      });
    const total = matched.length;
    const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const start = (current - 1) * pageSize;
    return {
      cards: matched.slice(start, start + pageSize).map((card) => ({ ...card })),
      total,
      page: current,
      pageSize,
    };
  }

  visit(id: string): void {
    this.get(id);
    this.store.update((state) => {
      state.visits[id] = new Date().toISOString();
    });
  }

  recent(): RecentRecordingCard[] {
    const { cards, visits } = this.store.value;
    return Object.entries(visits)
      .map(([cardId, lastVisitedAt]) => {
        const card = cards.find((item) => item.id === cardId);
        return card ? { ...card, lastVisitedAt } : null;
      })
      .filter((item): item is RecentRecordingCard => item !== null)
      .sort((a, b) => {
        if (a.lastVisitedAt === b.lastVisitedAt) return a.id < b.id ? 1 : -1;
        return a.lastVisitedAt < b.lastVisitedAt ? 1 : -1;
      })
      .slice(0, 10);
  }

  remove(id: string): void {
    this.get(id);
    if (this.activeCard() === id) {
      throw failure('该卡片正在录制，请先结束录制', 409);
    }
    this.store.update((state) => {
      state.cards = state.cards.filter((item) => item.id !== id);
      delete state.visits[id];
    });
  }

  importRecordings(entries: RecordingEntry[]): void {
    this.store.update((state) => {
      for (const entry of entries) {
        if (state.imports.includes(entry.id)) continue;
        state.imports.push(entry.id);
        if (state.cards.some((card) => card.recordingId === entry.id)) continue;
        const now = new Date().toISOString();
        const createdAt = recordingDate(entry, now);
        state.cards.push({
          id: randomUUID(),
          name: entry.id,
          description: '',
          recordingId: entry.id,
          createdAt,
          updatedAt: createdAt,
          version: 1,
        });
      }
    });
  }

  activeCard(): string | undefined {
    return this.store.value.session ?? undefined;
  }

  beginRecording(id: string): void {
    this.get(id);
    if (this.activeCard()) throw failure('已有卡片正在录制', 409);
    this.store.update((state) => {
      state.session = id;
    });
  }

  clearSession(): void {
    this.store.update((state) => {
      state.session = null;
    });
  }

  completeRecording(recordingId: string): void {
    const id = this.activeCard();
    if (!id) return;
    this.store.update((state) => {
      const card = state.cards.find((item) => item.id === id);
      if (card) {
        card.recordingId = recordingId;
        card.updatedAt = new Date().toISOString();
        card.version += 1;
      }
      if (!state.imports.includes(recordingId)) state.imports.push(recordingId);
      state.session = null;
    });
  }
}

function recordingDate(entry: RecordingEntry, fallback: string): string {
  const date = Date.parse(entry.startedAt ?? '');
  return Number.isFinite(date) ? new Date(date).toISOString() : fallback;
}
