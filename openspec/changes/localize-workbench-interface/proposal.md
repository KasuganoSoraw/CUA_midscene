# Proposal

## Why

The workbench currently exposes implementation-specific vocabulary and developer-oriented controls in ordinary user flows, which makes recording, reviewing, and running tasks harder to understand. The same interface also needs a consistent Chinese and English experience so it can be used across different language environments without maintaining separate frontends.

## What Changes

- Replace implementation names and protocol terminology in ordinary workbench modes with user-facing language centered on recording workflows, reviewing tasks, and running tasks.
- Keep engine details, raw task assets, invocation diagnostics, and the Agent test surface behind development mode.
- Add a Chinese and English language switch that updates the interface immediately without reloading or discarding current work.
- Resolve the initial language from an explicit URL preference, then a saved preference, then the browser language, and persist subsequent user choices.
- Localize visible labels, actions, statuses, empty states, validation guidance, page title, document language, and locale-sensitive date formatting.
- Preserve exact configuration keys and file locations when they are required for actionable setup or troubleshooting guidance.
- Name the product surface around desktop tasks instead of its local deployment or automation implementation.
- Detect available displays when the recording workflow opens so the primary user journey starts with screen selection; retain manual detection as a recovery action.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-task-review-app`: Define the user-facing terminology boundary, development-only technical surfaces, and bilingual workbench behavior.

## Impact

- Affects the Vue review frontend under `execution/review/web`, its frontend tests, and the local task review specification.
- Does not change review server APIs, runtime bridge contracts, recorded task formats, or execution behavior.
- Introduces no external internationalization dependency; locale resources remain part of the frontend bundle.
