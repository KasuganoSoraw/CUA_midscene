import { agentForComputer } from '@midscene/computer';
import { createKeyboardTypeTextAction } from './keyboard-type-action.js';

export type ComputerAgent = Awaited<ReturnType<typeof agentForComputer>>;
export type ComputerAgentOptions = NonNullable<Parameters<typeof agentForComputer>[0]>;

export const keyboardInputAiActContext = `文本输入必须遵守以下规则：
1. 仅使用 KeyboardTypeText 输入 ASCII 文本，不使用默认 Input 或剪贴板。
2. 待输入文本包含 KeyboardTypeText 不支持的字符时直接失败，不切换输入动作。
3. 不得因为定位失败或一般执行失败改用其他输入方式。`;

export async function createKeyboardEnabledComputerAgent(
  options: ComputerAgentOptions,
): Promise<ComputerAgent> {
  const keyboardTypeText = createKeyboardTypeTextAction();
  const customActions = [...(options.customActions ?? []), keyboardTypeText.action];
  const agent = await agentForComputer({ ...options, customActions });
  const keyboard = agent.interface.inputPrimitives?.keyboard;
  if (!keyboard?.keyboardPress) {
    await agent.destroy();
    throw new Error('当前 Midscene computer interface 不支持底层 keyboardPress 输入');
  }
  keyboardTypeText.setPressKey(async (keyName, target) => {
    await keyboard.keyboardPress(keyName, { target });
  });
  return agent;
}
