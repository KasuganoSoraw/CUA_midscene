export function deriveInputLocatePrompt(inputPrompt: string): string {
  const normalizedPrompt = inputPrompt.trim();
  const match = normalizedPrompt.match(/^在\s*(.+?)\s*中(?:继续)?(?:输入|键入|录入)\s*\{\{value\}\}/);

  if (!match?.[1]?.trim()) {
    throw new Error(`无法从 input prompt 推导 locatePrompt：${inputPrompt}`);
  }

  return match[1].trim();
}
