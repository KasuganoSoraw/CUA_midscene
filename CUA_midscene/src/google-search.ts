import { agentForComputer } from '@midscene/computer';
import { execFile } from 'node:child_process';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';

const GOOGLE_URL = 'https://www.google.com';
const DEFAULT_QUERY = 'GUI agent';

type ComputerAgent = Awaited<ReturnType<typeof agentForComputer>>;

async function press(agent: ComputerAgent, keyName: string): Promise<void> {
  await agent.callActionInActionSpace('KeyboardPress', { keyName });
}

async function typeText(agent: ComputerAgent, value: string): Promise<void> {
  await agent.callActionInActionSpace('Input', { value, mode: 'typeOnly' });
}

async function sleep(agent: ComputerAgent, timeMs: number): Promise<void> {
  await agent.callActionInActionSpace('Sleep', { timeMs });
}

async function launchChromeApplication(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (process.platform === 'win32') {
      execFile('cmd.exe', ['/c', 'start', '""', 'chrome', '--new-window', 'about:blank'], (error) => {
        if (error) reject(error);
        else resolve();
      });
      return;
    }

    const command = process.platform === 'darwin' ? 'open' : 'google-chrome';
    const args = process.platform === 'darwin' ? ['-a', 'Google Chrome', 'about:blank'] : ['--new-window', 'about:blank'];
    execFile(command, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function navigateToGoogleWithKeyboard(agent: ComputerAgent): Promise<void> {
  await press(agent, 'Control+L');
  await sleep(agent, 300);
  await typeText(agent, GOOGLE_URL);
  await press(agent, 'Enter');
  await sleep(agent, 3000);
}

async function main(): Promise<void> {
  warnIfNodeVersionIsOld();
  checkRequiredModelEnv();

  const query = process.env.GOOGLE_SEARCH_QUERY || DEFAULT_QUERY;
  const agent = await agentForComputer({
    generateReport: true,
    groupName: 'local-chrome-google-search',
    groupDescription: 'Open Chrome through desktop GUI and search Google with Midscene computer use.',
  });

  try {
    await launchChromeApplication();
    await sleep(agent, 1500);
    await navigateToGoogleWithKeyboard(agent);

    await agent.aiWaitFor('Chrome is open and Google search page is visible');
    await agent.aiInput('Google search input box', { value: query, mode: 'replace' });
    await agent.aiKeyboardPress('Google search input box', { keyName: 'Enter' });
    await agent.aiWaitFor(`Google search results for "${query}" are visible`);

    const title = await agent.aiString('What is the main visible search result page title or heading?');
    console.log(`Google search completed. Visible heading: ${title}`);
  } finally {
    await agent.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
