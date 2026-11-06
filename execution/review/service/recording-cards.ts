import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  RecordingCard,
  RecordingCardInput,
  RecordingCardPage,
  RecentRecordingCard,
} from '../shared/recording-cards.js';
import type { RecordingEntry } from '../../cua/recording/recording-catalog.js';

const columns = `id, name, description, recording_id AS recordingId,
  created_at AS createdAt, updated_at AS updatedAt, version`;
const failure = (message: string, statusCode: number) =>
  Object.assign(new Error(message), { statusCode });

export class RecordingCardStore {
  private readonly db: Database.Database;

  constructor(filename: string) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate(): void {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 1) throw new Error('工作台数据库版本高于当前程序支持的版本');
    if (version === 1) return;
    this.db.transaction(() => {
      this.db.exec(`
        CREATE TABLE recording_cards (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
          recording_id TEXT UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          version INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX cards_updated ON recording_cards(updated_at DESC, id);
        CREATE TABLE recent_visits (
          card_id TEXT PRIMARY KEY REFERENCES recording_cards(id) ON DELETE CASCADE,
          last_visited_at TEXT NOT NULL
        );
        CREATE INDEX visits_time ON recent_visits(last_visited_at DESC);
        CREATE TABLE recording_imports (recording_id TEXT PRIMARY KEY);
        CREATE TABLE recording_session (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
          card_id TEXT REFERENCES recording_cards(id) ON DELETE RESTRICT
        );
        PRAGMA user_version = 1;
      `);
    })();
  }

  close(): void {
    this.db.close();
  }

  get(id: string): RecordingCard {
    const card = this.db
      .prepare(`SELECT ${columns} FROM recording_cards WHERE id = ?`)
      .get(id) as RecordingCard | undefined;
    if (!card) throw failure('流程卡片不存在', 404);
    return card;
  }

  create(input: RecordingCardInput): RecordingCard {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO recording_cards
      (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, input.name.trim(), input.description.trim(), now, now);
    return this.get(id);
  }

  update(
    id: string,
    input: RecordingCardInput,
    version: number,
  ): RecordingCard {
    this.get(id);
    const changed = this.db
      .prepare(
        `UPDATE recording_cards SET name = ?, description = ?,
      updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
      )
      .run(
        input.name.trim(),
        input.description.trim(),
        new Date().toISOString(),
        id,
        version,
      );
    if (!changed.changes) throw failure('卡片已更新，请刷新后重试', 409);
    return this.get(id);
  }

  list(query: string, page: number, pageSize: number): RecordingCardPage {
    const needle = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const where = `WHERE name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'`;
    const { total } = this.db
      .prepare(`SELECT COUNT(*) AS total FROM recording_cards ${where}`)
      .get(needle, needle) as { total: number };
    const current = Math.min(page, Math.max(1, Math.ceil(total / pageSize)));
    const cards = this.db
      .prepare(
        `SELECT ${columns} FROM recording_cards ${where}
      ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`,
      )
      .all(
        needle,
        needle,
        pageSize,
        (current - 1) * pageSize,
      ) as RecordingCard[];
    return { cards, total, page: current, pageSize };
  }

  visit(id: string): void {
    this.get(id);
    this.db
      .prepare(
        `INSERT INTO recent_visits VALUES (?, ?)
      ON CONFLICT(card_id) DO UPDATE SET last_visited_at = excluded.last_visited_at`,
      )
      .run(id, new Date().toISOString());
  }

  recent(): RecentRecordingCard[] {
    return this.db
      .prepare(
        `SELECT ${columns
          .split(',')
          .map((value) => 'c.' + value.trim())
          .join(',')},
      v.last_visited_at AS lastVisitedAt FROM recording_cards c
      JOIN recent_visits v ON c.id = v.card_id ORDER BY v.last_visited_at DESC, c.id LIMIT 10`,
      )
      .all() as RecentRecordingCard[];
  }

  remove(id: string): void {
    this.get(id);
    if (this.activeCard() === id)
      throw failure('该卡片正在录制，请先结束录制', 409);
    this.db.prepare('DELETE FROM recording_cards WHERE id = ?').run(id);
  }

  importRecordings(entries: RecordingEntry[]): void {
    this.db.transaction(() => {
      for (const entry of entries) {
        const imported = this.db
          .prepare('INSERT OR IGNORE INTO recording_imports VALUES (?)')
          .run(entry.id);
        if (!imported.changes) continue;
        if (this.db.prepare('SELECT id FROM recording_cards WHERE recording_id = ?').get(entry.id)) continue;
        const card = this.create({ name: entry.id, description: '' });
        this.db
          .prepare(
            'UPDATE recording_cards SET recording_id = ?, created_at = ?, updated_at = ? WHERE id = ?',
          )
          .run(
            entry.id,
            recordingDate(entry, card.createdAt),
            recordingDate(entry, card.createdAt),
            card.id,
          );
      }
    })();
  }

  activeCard(): string | undefined {
    return (
      this.db
        .prepare('SELECT card_id FROM recording_session WHERE singleton = 1')
        .get() as { card_id?: string } | undefined
    )?.card_id;
  }

  beginRecording(id: string): void {
    this.get(id);
    if (this.activeCard()) throw failure('已有卡片正在录制', 409);
    this.db
      .prepare('INSERT OR REPLACE INTO recording_session VALUES (1, ?)')
      .run(id);
  }

  clearSession(): void {
    this.db.prepare('DELETE FROM recording_session').run();
  }

  completeRecording(recordingId: string): void {
    const id = this.activeCard();
    if (!id) return;
    this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE recording_cards SET recording_id = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
        )
        .run(recordingId, new Date().toISOString(), id);
      this.db
        .prepare('INSERT OR IGNORE INTO recording_imports VALUES (?)')
        .run(recordingId);
      this.clearSession();
    })();
  }
}

function recordingDate(entry: RecordingEntry, fallback: string): string {
  const date = Date.parse(entry.startedAt ?? '');
  return Number.isFinite(date) ? new Date(date).toISOString() : fallback;
}
