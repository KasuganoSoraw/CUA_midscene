# Design

## Context

The review frontend is a single Vue application that combines task review, recording discovery, execution, and a development-only Agent surface. Visible strings and transient statuses are currently embedded in components, while technical editors and diagnostics are mixed into the ordinary review view. The server contracts and task formats remain unchanged.

## Goals / Non-Goals

**Goals:**

- Establish one locale source for all workbench components and browser metadata.
- Keep language switching synchronous and independent from server requests or route reloads.
- Separate ordinary product language from development-only task assets and Agent diagnostics.
- Keep exact configuration identifiers available where they are required to resolve a local setup problem.

**Non-Goals:**

- Translating server-generated exception details or third-party execution logs.
- Changing task schemas, review APIs, runtime events, or report contents.
- Adding locale-specific routes or an external translation service.

## Decisions

### Use an in-bundle typed locale module

The frontend will own a small locale module with `zh-CN` and `en-US` message maps, parameter interpolation, locale resolution, persistence, and document metadata synchronization. This keeps the behavior deterministic and avoids adding a dependency for a two-locale local application. An external i18n framework was considered, but its routing, pluralization, and remote catalog features are not needed here.

### Resolve locale with an explicit precedence

The initial locale is resolved in this order: valid `lang` query parameter, persisted preference, then browser language. A Chinese browser locale selects `zh-CN`; all other locales select `en-US`. The query parameter controls the initial selection without remaining a permanent override after the user uses the switch.

### Store translatable status descriptors instead of rendered strings

Static text is translated during rendering. Client-generated transient states use message keys and parameters so an already visible status changes language immediately. Raw server error details remain raw text and are placed beneath localized headings, preserving diagnostic accuracy.

### Treat development mode as the technical disclosure boundary

Raw task asset editors, revision identifiers, internal invocation state, and the Agent test surface are rendered only when development mode is enabled. Ordinary task editing continues to use semantic fields and user-facing change descriptions. Configuration keys and paths are exempt because users need their exact values to repair a local setup.

### Keep locale state outside workflow state

Changing locale only updates the locale reference, saved preference, document language, and title. It does not recreate components, mutate selected scenes or tasks, restart execution, or fetch data, so drafts and in-progress state remain intact.

### Make display discovery an entry effect of the recording workflow

The recording component will load recorder status and recording catalog first. When the recorder is idle or failed, it will immediately request display previews, reuse the existing primary-display selection rule, and expose the same request as “Detect screens again” for recovery. Active recorder phases skip discovery so entering the page cannot interfere with an armed or running recording. This reuses the existing endpoint and state model without adding a server contract.

## Risks / Trade-offs

- [New copy can be added without an English counterpart] → Type the English catalog against the Chinese message keys and cover catalog parity in tests.
- [Server errors can contain implementation names] → Preserve them only as diagnostic detail and keep surrounding UI labels localized.
- [Hidden advanced editors reduce discoverability for developers] → Keep them available through the existing development parameter alongside the Agent surface.
- [Locale-sensitive text can become wider] → Reuse responsive layout rules and allow the language control and navigation to wrap on narrow screens.
- [Automatic display capture adds work when the recording page opens] → Run it only when the recording workflow is mounted and the recorder is inactive; keep failures local to the preview area.

## Migration Plan

1. Add the locale module and tests for resolution, interpolation, and catalog parity.
2. Replace visible component strings with locale keys and move technical review controls behind development mode.
3. Update document metadata and responsive styles for the language control.
4. Run frontend type checks, review tests, production build, and strict OpenSpec validation.

Rollback consists of reverting the frontend and delta specification together; no persisted task data or server migration is involved.
