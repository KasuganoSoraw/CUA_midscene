import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 极小的同步 JSON 持久化助手。
 *
 * Workbench 的元数据（卡片 / 最近访问 / 导入记录 / 当前录制会话 / 工作流状态）
 * 原先存放在 better-sqlite3 里。原生模块会绑定编译期的 Node ABI，而运行时由
 * 宿主决定（Electron 内置 Node 的 ABI 与独立 Node 不同），因此改用无原生依赖的
 * JSON 文件存储，避免 ABI 不匹配。
 *
 * 写入采用「临时文件 + rename」保证原子性；workbench 服务是单进程访问，
 * 不需要跨进程锁。
 */
export class JsonStore<T> {
  private readonly filename: string;
  private state: T;

  constructor(filename: string, createDefault: () => T) {
    this.filename = filename;
    mkdirSync(path.dirname(filename), { recursive: true });
    this.state = this.load(createDefault);
  }

  get value(): T {
    return this.state;
  }

  /** 就地修改并落盘。 */
  update(mutate: (state: T) => void): void {
    mutate(this.state);
    this.flush();
  }

  private load(createDefault: () => T): T {
    try {
      const raw = readFileSync(this.filename, 'utf8');
      return JSON.parse(raw) as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        // 文件损坏时不能静默丢数据，但也不能让 workbench 起不来：
        // 备份原文件后从默认状态继续，便于事后人工恢复。
        try {
          renameSync(this.filename, `${this.filename}.corrupt-${Date.now()}`);
        } catch {
          /* 备份失败时忽略，继续以默认状态启动 */
        }
        console.error(`[workbench] 元数据文件无法解析，已备份并从空状态启动：${this.filename}`);
      }
      return createDefault();
    }
  }

  private flush(): void {
    const temp = `${this.filename}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state), 'utf8');
    renameSync(temp, this.filename);
  }
}
