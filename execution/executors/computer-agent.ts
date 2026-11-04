import { agentForComputer } from '@midscene/computer';
import { createKeyboardTypeTextAction } from './keyboard-type-action.js';

export type ComputerAgent = Awaited<ReturnType<typeof agentForComputer>>;
export type ComputerAgentOptions = NonNullable<Parameters<typeof agentForComputer>[0]>;

export const keyboardInputAiActContext = `文本输入必须遵守以下规则：
1. 待输入文本全部属于 KeyboardTypeText 支持的 ASCII 字符时，必须使用 KeyboardTypeText，不使用默认 Input 或剪贴板。
2. 待输入文本包含中文等 KeyboardTypeText 无法直接键入的字符时，使用默认 Input。
3. 默认 Input 仅用于待输入字符本身不受 KeyboardTypeText 支持的情况。
4. 不得因为定位失败、输入失败或一般执行失败而从 KeyboardTypeText 切换为默认 Input。

读取界面信息时应遵守以下规则：
1. 对任务要求读取、查询或提取的信息，在操作过程中保留实际观察到的结果，并在本次 aiAct 的最终回答中返回。
2. 多个读取要求分别返回对应结果；保留必要的名称、数值、单位及关联关系。
3. 无法确认的信息应明确说明，不得猜测。
4. 完成读取后继续执行剩余步骤，不要为了形成回答而重复已完成的电脑操作。没有读取要求时，正常返回执行结果。`;

export async function createKeyboardEnabledComputerAgent(
  options: ComputerAgentOptions,
): Promise<ComputerAgent> {
  const keyboardTypeText = createKeyboardTypeTextAction();
  const customActions = [...(options.customActions ?? []), keyboardTypeText.action];
  // 显式传入的 cache / screenshotShrinkFactor 配置优先（例如 YAML agent 段），
  // 环境变量兜底
  const cacheOption =
    options.cache !== undefined ? {} : resolveCacheOption();
  const shrinkOption =
    options.screenshotShrinkFactor !== undefined
      ? {}
      : resolveScreenshotShrinkOption();
  const agent = await agentForComputer({
    ...options,
    customActions,
    ...cacheOption,
    ...shrinkOption,
  });
  const keyboard = agent.interface.inputPrimitives?.keyboard;
  if (!keyboard?.keyboardPress) {
    await agent.destroy();
    throw new Error('Midscene computer interface 不支持底层 keyboardPress 输入');
  }
  keyboardTypeText.setPressKey(async (keyName, target) => {
    await keyboard.keyboardPress(keyName, { target });
  });
  return agent;
}

/**
 * 读取缓存配置：设置 MIDSCENE_CACHE_ID 后为 Midscene agent 启用 plan/locate 缓存
 * （缓存文件落在 midscene_run/cache/<id>.cache.yaml）。
 * 可通过 MIDSCENE_CACHE_DIR 指定固定缓存目录（否则随 MIDSCENE_RUN_DIR 落在
 * 每次运行的随机 run 目录下，跨运行无法命中）。
 * 可通过 MIDSCENE_CACHE_STRATEGY 指定策略：read-write（默认，读写）/ read-only
 * （只读重放）/ write-only（只写积累，录缓存阶段用）。
 * 不设置该环境变量时保持默认（不开缓存）。
 */
type CacheStrategy = 'read-write' | 'read-only' | 'write-only';

const cacheStrategies: readonly CacheStrategy[] = [
  'read-write',
  'read-only',
  'write-only',
];

function resolveCacheOption(): {
  cache?: { id: string; cacheDir?: string; strategy?: CacheStrategy };
} {
  const cacheId = process.env.MIDSCENE_CACHE_ID?.trim();
  if (!cacheId) {
    return {};
  }
  const cacheDir = process.env.MIDSCENE_CACHE_DIR?.trim();
  const strategy = process.env.MIDSCENE_CACHE_STRATEGY?.trim() as
    | CacheStrategy
    | undefined;
  const base = cacheDir ? { id: cacheId, cacheDir } : { id: cacheId };
  if (strategy && cacheStrategies.includes(strategy)) {
    return { cache: { ...base, strategy } };
  }
  return { cache: base };
}

/**
 * 读取截图缩放配置：设置 MIDSCENE_SCREENSHOT_SHRINK_FACTOR 后为 Midscene
 * agent 等比缩小截图后送模型，降低图像 token 以加速推理。
 *
 * 支持的值：
 * - "auto"：智能缩放到 1080p。读取当前屏幕高度，计算 shrinkFactor = 屏幕高度 / 1080，
 *   保持原始长宽比。屏幕高度 ≤1080 时不缩放。
 * - 数字字符串（如 "2"、"4"）：固定倍数缩放，shrinkFactor = 该数字（支持小数）。
 * - "1" 或未设置：不缩放。
 */
function resolveScreenshotShrinkOption(): {
  screenshotShrinkFactor?: number;
} {
  const raw = process.env.MIDSCENE_SCREENSHOT_SHRINK_FACTOR?.trim();
  if (!raw || raw === '1') {
    return {};
  }

  // auto 模式：智能缩放到 1080p
  if (raw.toLowerCase() === 'auto') {
    const screenHeight = _readScreenHeight();
    if (screenHeight <= 0 || screenHeight <= 1080) {
      return {};
    }
    const factor = screenHeight / 1080;
    if (Number.isFinite(factor) && factor > 1) {
      // 把实际系数写回 env，供 report banner 注入逻辑读取
      // （report banner 调用处读 MIDSCENE_SCREENSHOT_SHRINK_FACTOR，
      // "auto" 字符串无法 Number() 解析，需替换为实际数值）
      process.env.MIDSCENE_SCREENSHOT_SHRINK_FACTOR = String(factor);
      return { screenshotShrinkFactor: factor };
    }
    return {};
  }

  // 固定倍数模式（支持小数，如 1.33）
  const value = Number(raw);
  return Number.isFinite(value) && value > 1
    ? { screenshotShrinkFactor: value }
    : {};
}

/**
 * 读取当前主屏幕高度（物理像素）。用于 auto 模式计算智能缩放系数。
 *
 * 优先从 MIDSCENE_SCREEN_HEIGHT 环境变量读取（由后端 runtime_env 注入），
 * 其次尝试 @midscene/computer 的 ComputerDevice.listDisplays()。
 * 读取失败时返回 0（auto 模式回退为不缩放）。
 */
function _readScreenHeight(): number {
  const fromEnv = process.env.MIDSCENE_SCREEN_HEIGHT?.trim();
  if (fromEnv) {
    const h = Number(fromEnv);
    if (Number.isFinite(h) && h > 0) {
      return Math.floor(h);
    }
  }
  // @midscene/computer 的 ComputerDevice 可能未加载或 listDisplays 不可用，
  // 不在此处做异步调用（resolveScreenshotShrinkOption 是同步函数）。
  // 屏幕高度由后端 runtime_env 通过 MIDSCENE_SCREEN_HEIGHT 注入。
  return 0;
}
