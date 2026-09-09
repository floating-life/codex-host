# Prompt Enhance latency and sent-message editing

## Observed latency

Two synthetic draft requests used the user's configured `gpt-5.6-luna`, Responses protocol and WorkBuddy mode. No real conversation, attachments or repository content was sent. Provider/model/configuration and system template were not changed.

| Measurement | Original reader | Reader returning at completion |
| --- | ---: | ---: |
| Response headers | 6.027 s | 8.326 s |
| First received byte | 6.174 s | 8.335 s |
| First text delta observed | 6.286 s | 8.374 s |
| Completion event observed | 8.416 s | 11.953 s |
| HTTP EOF observed | 8.420 s | Not waited for |
| Total | 8.429 s | 11.960 s |
| Output characters | 202 | 300 |

These are individual requests with different generated lengths and server conditions, not a controlled strength/quality or throughput comparison. They do **not** establish a live end-to-end speedup. Most observed time precedes response headers (about 70%); this includes gateway/provider queueing, request processing, model first-output latency and possible buffering. The local client cannot distinguish these upstream components from the exposed protocol alone. After completion, local return overhead was only a few milliseconds.

Evidence files are local-only `.local-install/enhance-latency-before.json` and `.local-install/enhance-latency-after.json`. The diagnostic records timings and output length, not keys or output text.

## Implemented optimizations

- `packages/host-runtime/src/prompt-enhance.ts`: return on successful Responses `response.completed` or Chat `finish_reason:stop` plus `[DONE]`, without waiting for transport EOF. Cancel/release the response reader and remove abort listeners. This eliminates avoidable long-tail waiting when a gateway keeps a completed stream open. Complete-result, error, cancellation and whitespace protections remain.
- `packages/renderer-extension/src/renderer-prompt-enhance.ts` and `renderer-enhancement-targets.ts`: ignore ordinary transcript/text mutations for target discovery, coalesce structural updates by animation frame, and update only the affected editor's undo state after text changes. Remove the duplicate enhancement scan from the main binding scanner. Button replacement/remount remains supported.

No prompt shortening, hard output truncation, automatic retries, response cache, model switch, or reasoning downgrade was introduced. Those choices could change results or request semantics.

For further real latency reduction, compare first-response latency across supported enhancement Providers with the same small prompt set. Keep enhancement independent from the coding Harness. If the Provider supports a lower reasoning setting, assess it as an opt-in quality/latency tradeoff, not a transparent performance fix. Streaming progress can improve perceived responsiveness, but partial output must stay separate from the draft until completion. Preserve the working Clash routing configuration; changing global proxy settings is outside this change.

## Sent-message edit entry

The desktop's actual edit component was inspected: a native form with a ProseMirror editor, Cancel/Send actions, `initialMessage`, `onCancel`, `onDraftChange` and `onSubmit` component props, with thread/turn ownership above it. `renderer-enhancement-targets.ts` recognizes that scoped contract without depending on localized button text or generated CSS names.

Edit forms receive the same enhance/stop/undo controls, right-click settings and dismissible feedback as the main Composer. Both entry points share the existing controller, Host RPC, Provider configuration, native editor adapter and result validation. Only text in the selected editing surface is enhanced; this feature never invokes Send or changes committed message history itself.

An edit target is bound to Host/thread/turn and live editing scope. Conflicting primary/alternate React identities fail closed. Changed drafts, IME composition, disabled submission, closed/replaced forms and changed Host/turn identities cannot receive a late result. Undo is restricted to the latest unchanged enhancement in that surface. Unknown forms receive no controls.

## Validation scope

Focused Host tests include non-closing successful streams (settle within a 100 ms test deadline without EOF), explicit cancellation of an open reader, incomplete/error terminals, fragmented UTF-8 and exact output preservation. Browser tests cover independent main/edit enhancement and undo without submit; pending draft edits, Host/turn changes and form removal; remount uniqueness, unrelated/disabled forms; stale React alternate identity; manual settings and dismissible errors; and zero discovery scans for ordinary content mutations.

Browser fixtures model the inspected Desktop edit-form contract. The native ProseMirror transaction adapter has separate unit coverage. Real request timings used the configured live Provider; real user message drafts/history were not modified for acceptance testing. A newly installed Host bundle takes effect after a full CodexHost exit/reopen; existing credentials and settings are preserved.

Final checks: 83 focused Vitest cases across six files and eight browser cases passed. Repository `npm run typecheck`, changed-file ESLint, package boundary checks, release Host build and production Renderer build passed. `git diff --check` passed and no unmerged index entries exist. Independent review findings about stale React alternate identity and excess mutation scanning were addressed with regression coverage.

The installed `app/host-runtime.mjs` and `app/renderer-extension.js` match the final build artifacts. Previous files are retained under `.local-install/backup-before-latency-edit/`. After the interrupted handoff, hashes were checked again and still matched; no installation write failure or overwritten unrelated working-tree change was found. The running Desktop was not forcibly restarted.
