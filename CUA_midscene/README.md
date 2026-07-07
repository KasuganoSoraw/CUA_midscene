# CUA Midscene

Local Midscene computer-use experiments. This repo intentionally uses `@midscene/computer` desktop automation instead of browser automation, so the same pattern can later be adapted to bastion-host or remote-desktop flows.

## Setup

```bash
npm install
```

Create `.env.local` from `.env.example`. The local file is ignored by git.

The current experiment is configured for Volcengine Ark's OpenAI-compatible endpoint:

- `MIDSCENE_MODEL_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3`
- `MIDSCENE_MODEL_NAME=minimax-m3`
- `MIDSCENE_MODEL_FAMILY=doubao-vision`

Midscene computer use requires a vision-capable model family for screen grounding. If `minimax-m3` is text/coding-only in your Ark plan, model calls may fail during locate or act steps even though the desktop health check passes.

## Run

```bash
npm run check
npm run google
```

`npm run google` starts the local Chrome application, then uses Midscene desktop keyboard input and visual grounding to navigate to Google, search `GUI agent`, and assert that results are visible. It does not use Playwright, Puppeteer, CDP, browser-use, or any browser automation protocol.

On Windows, run the terminal/Codex as Administrator if Midscene can move the cursor but clicks or key presses do not affect Chrome.

## Project flows

`projects/<project-name>/` stores workflow-specific artifacts. The first sample is `projects/air-tickets-demo/`.

```text
projects/<project-name>/
  source/      # ShowUI-Aloha trace, processed logs, screenshots
  ir/          # Midscene flow IR, for example midscene-flow.json
  generated/   # future generated run.ts scripts
  reports/     # execution reports or report references
```

Convert the sample ShowUI-Aloha trace into a Midscene flow:

```bash
npm run flow:convert:air
```

Run the generic flow runner:

```bash
npm run flow:run:air
```

The runner fails fast on `manual-review` steps before desktop execution. This is intentional: ambiguous recorded actions must be reviewed or given explicit fallback instructions before Midscene operates the computer.
