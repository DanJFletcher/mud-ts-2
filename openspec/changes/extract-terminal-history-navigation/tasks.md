# Tasks

## 1. Extract terminal navigation state

- [ ] 1.1 Add a `useTerminalHistoryNavigation` hook that owns the terminal element ref, follow-latest state, visible-row anchor and offset, scroll availability, and scroll callbacks; add focused tests for the 32-pixel threshold, first-visible-row selection, anchor restoration, and return-to-latest behavior.
- [ ] 1.2 Keep the hook instance alive across play-screen changes by invoking it at the persistent `WorldClient` level; test that inactive screens preserve the reading anchor and reactivation restores it to a replacement terminal element.

## 2. Integrate the navigation model

- [ ] 2.1 Replace the inline scroll state, layout effect, and callbacks in `WorldClient` with the hook result; pass a focused navigation model to `PlayScreen` and verify the web typecheck plus existing terminal-history integration tests.
- [ ] 2.2 Replace `PlayScreen`'s inline scroll handler with the hook callback, preserve the existing `ActivityHistoryWindow` and target-action behavior, and add an integration regression for switching away from and back to the play screen while reading older activity.
- [ ] 2.3 Update the world feature ownership documentation to identify the hook as owner of terminal viewport navigation; verify the documentation matches the implementation and does not assign history data or announcement ownership to the hook.

## 3. Validate the refactor

- [ ] 3.1 Run the full web test suite, web typecheck, lint, and `openspec validate extract-terminal-history-navigation --strict`; resolve introduced failures and confirm the existing `refactor-world-client` artifacts were not changed.
