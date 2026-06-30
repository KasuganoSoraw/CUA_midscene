import { agentForComputer } from '@midscene/computer';
import { execFile } from 'node:child_process';
import { checkRequiredModelEnv, warnIfNodeVersionIsOld } from './env.js';

type ComputerAgent = Awaited<ReturnType<typeof agentForComputer>>;

const GOOGLE_URL = 'https://www.google.com';
const QATAR_HOME_URL = 'https://www.qatarairways.com/en-sg/homepage.html';

async function press(agent: ComputerAgent, keyName: string): Promise<void> {
  await agent.callActionInActionSpace('KeyboardPress', { keyName });
}

async function typeText(agent: ComputerAgent, value: string): Promise<void> {
  await agent.callActionInActionSpace('Input', { value, mode: 'typeOnly' });
}

async function sleep(agent: ComputerAgent, timeMs: number): Promise<void> {
  await agent.callActionInActionSpace('Sleep', { timeMs });
}

async function launchChrome(): Promise<void> {
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

async function openUrlWithKeyboard(agent: ComputerAgent, url: string): Promise<void> {
  await press(agent, 'Control+L');
  await sleep(agent, 300);
  await typeText(agent, url);
  await press(agent, 'Enter');
  await sleep(agent, 3000);
}

async function optionalAiAct(agent: ComputerAgent, prompt: string): Promise<void> {
  try {
    await agent.aiAct(prompt);
  } catch (error) {
    console.warn(`Optional step skipped: ${prompt}`);
    console.warn(error instanceof Error ? error.message : String(error));
  }
}

async function waitFor(agent: ComputerAgent, prompt: string): Promise<boolean> {
  try {
    await agent.aiWaitFor(prompt, { timeoutMs: 15000 });
    return true;
  } catch (error) {
    console.warn(`Wait condition not met: ${prompt}`);
    console.warn(error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function main(): Promise<void> {
  warnIfNodeVersionIsOld();
  checkRequiredModelEnv();

  const agent = await agentForComputer({
    generateReport: true,
    groupName: 'showui-aloha-air-tickets-replay',
    groupDescription:
      'Replay a ShowUI-Aloha air-ticket trace with Midscene computer use: Qatar Airways, Singapore to Los Angeles, one-way.',
  });

  try {
    await launchChrome();
    await sleep(agent, 1500);
    await openUrlWithKeyboard(agent, GOOGLE_URL);

    await agent.aiWaitFor('Google search page is visible in Chrome');
    await agent.aiInput('Google search input box', { value: 'Qatar Airways', mode: 'replace' });
    await agent.aiKeyboardPress('Google search input box', { keyName: 'Enter' });
    await agent.aiWaitFor('Google search results for Qatar Airways are visible');

    await agent.aiTap('the official Qatar Airways website result, preferably qatarairways.com');
    await sleep(agent, 5000);
    if (!(await waitFor(agent, 'Qatar Airways official website homepage or booking page is visible'))) {
      console.warn('Falling back to direct Qatar Airways URL because the search result click did not navigate.');
      await openUrlWithKeyboard(agent, QATAR_HOME_URL);
      await agent.aiWaitFor('Qatar Airways official website homepage or booking page is visible');
    }

    await optionalAiAct(agent, 'If a cookie consent banner is visible, click the Accept all button. If no banner is visible, do nothing.');

    await agent.aiAct(
      'Following the recorded trace: in the Qatar Airways Book a flight widget, set the From/origin field to Singapore. If an autocomplete appears, choose Singapore Changi Airport or SIN.',
    );

    await agent.aiAct(
      'Following the recorded trace: in the Qatar Airways Book a flight widget, set the To/destination field to Los Angeles. If an autocomplete appears, choose Los Angeles LAX.',
    );

    await optionalAiAct(agent, 'Select the One way trip type in the Book a flight widget if it is not already selected.');

    await agent.aiAssert(
      'The Qatar Airways booking widget is populated with Singapore or SIN as the origin, Los Angeles or LAX as the destination, and One way trip type selected',
      'Aloha trace replay did not reach the populated booking widget state',
    );

    console.log('Aloha trace replay reached the populated Qatar Airways booking widget.');
  } finally {
    await agent.destroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
