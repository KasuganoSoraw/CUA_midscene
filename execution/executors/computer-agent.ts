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
  // 显式传入的 cache 配置优先（例如 YAML agent 段），环境变量兜底
  const cacheOption =
    options.cache !== undefined ? {} : resolveCacheOption();
  const agent = await agentForComputer({
    ...options,
    customActions,
    ...cacheOption,
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
 * （read-write，缓存文件落在 midscene_run/cache/<id>.cache.yaml）。
 * 可通过 MIDSCENE_CACHE_DIR 指定固定缓存目录（否则随 MIDSCENE_RUN_DIR 落在
 * 每次运行的随机 run 目录下，跨运行无法命中）。
 * 不设置该环境变量时保持默认（不开缓存）。
 */
function resolveCacheOption(): { cache?: { id: string; cacheDir?: string } } {
  const cacheId = process.env.MIDSCENE_CACHE_ID?.trim();
  if (!cacheId) {
    return {};
  }
  const cacheDir = process.env.MIDSCENE_CACHE_DIR?.trim();
  return cacheDir ? { cache: { id: cacheId, cacheDir } } : { cache: { id: cacheId } };
}
