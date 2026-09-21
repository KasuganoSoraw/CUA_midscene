# Tasks

## 1. Locale Foundation

- [x] 1.1 Add the typed Chinese and English locale catalog, locale resolution, persistence, interpolation, and document metadata synchronization; verify unit tests cover precedence and catalog parity.
- [x] 1.2 Add a persistent language control to the workbench shell and verify switching languages updates visible content without remounting workflow components.

## 2. User-Facing Workbench

- [x] 2.1 Localize the task review workflow and replace ordinary implementation terminology with product language; verify raw task assets and revision diagnostics only render in development mode.
- [x] 2.2 Localize recording discovery, execution, selectors, empty states, and the development Agent surface; verify all ordinary navigation and workflow states have Chinese and English text.
- [x] 2.3 Update responsive styling and page metadata for the language control; verify the production frontend build succeeds.

## 3. Verification

- [x] 3.1 Add regression coverage for workbench terminology and bilingual behavior, then run the review test suite and TypeScript checks.
- [x] 3.2 Run strict OpenSpec validation and inspect the final diff for user-facing implementation vocabulary and unrelated changes.

## 4. Recording Entry Experience

- [x] 4.1 Rename the workbench surface to Desktop Task Center in both locales and verify the browser title and header use the same name.
- [x] 4.2 Automatically detect displays when the inactive recording workflow opens, replace the screenshot-first prompt with progress and recovery copy, and verify active recording phases do not trigger detection.
- [x] 4.3 Extend regression tests for the recording entry journey, then run type checks, the full test suite, the production build, and strict OpenSpec validation.
