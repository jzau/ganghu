# GANGRAM design migration

Updated 2026-09-06. The local `gangram-new-ui/` reference is ignored by Git. Application code and builds do not import or depend on it.

## Approved and implemented

### In-conversation model switching

- The composer lets users select another enabled model for the next turn without creating a new conversation. Existing messages remain in the same history.
- Selection is disabled while a response is running or conversation messages are loading.
- Opening an existing conversation initializes the selector from its most recent assistant model. A manual selection is not immediately reset by that initialization.
- **Backend change required and implemented:** removed the `/api/chat/stream` rejection that locked a conversation to its first assistant model.
- No schema migration is needed: messages already store their own model IDs, history is model-independent, and the selected model's existing pricing and balance checks still apply. Ownership, enabled-model and provider checks remain intact.
- Deploy the API change with the frontend; an older API still rejects model switches with HTTP 409.

### Web toggle

- Added the reference-style globe, Web label and state indicator to the composer.
- Off sends `searchMode: "off"`; On sends `searchMode: "explicit"`. The choice applies to the next message and cannot be changed during generation.
- Defaults to Off, matching the reference. This intentionally replaces the frontend's previous always-automatic search setting. It is session UI state, not a saved conversation preference.
- **No backend code changes required for the toggle.** Both request modes already exist. Web On requires a configured active search provider and uses the existing provider/error handling. It requests search explicitly rather than relying on the automatic planner's decision.
- The existing backend still runs its planning step; Web Off disables web retrieval, not all internal model planning.

### Account settings design

- Replaced the small account popover with the reference's glass settings dialog: 800px maximum width, 248px navigation pane, section headings, profile detail cards and mobile section navigation.
- Added Profile, Recharge, Redeem, Usage & Billing, Feedback, Terms, Privacy and Language navigation, plus logout.
- Profile displays the actual account name and bound phone. Nickname editing, phone changes and account deletion are visibly inactive pending separate functionality decisions; no simulated successful changes are shown.
- Existing server-backed token redemption, language preference and logout actions remain connected. Legal links open the existing policy pages; their legal content is unchanged. Feedback submission remains inactive.
- Dialog supports Escape, backdrop dismissal, keyboard focus trapping and focus restoration.

### Payments and usage: UI only

- Recharge includes the reference's 500 / 1,000 / 2,500 / 5,000 credit presets, custom amount, WeChat Pay / Ali Pay / Card selection, and order summary.
- The reference's display conversion of ¥1 per credit is used only for preview; it is not a configured live price.
- The action is labeled “Preview payment” and explicitly confirms that no payment occurred. It does not create an order, call a payment API, modify balances or persist a simulated transaction.
- Credit balance is shown as unavailable (—), not fabricated or confused with the real token balance.
- Usage offers Balance and Toking Wallet views with clearly labeled sample history. It does not call billing APIs or present sample rows as real account activity.
- **No payment, usage or account backend code changes were made.** Existing real gift-code redemption is separate and retained.

## Other decisions still pending

| Area | Current behavior retained | Reference behavior not yet adopted |
| --- | --- | --- |
| Messages | Existing send, stop, stream and Markdown | Edit/resend, copy actions, reasoning disclosure, math rendering and View latest |
| Drafts | Existing draft lifecycle | Per-conversation persisted drafts and different textarea growth limits |
| History | Existing list and delete interaction | Search, keyboard shortcut, date groups and conversation action menus |
| Login | Existing modal, supported countries and sequential SMS verification | Dedicated login screens and different resend/countdown flow |
| Profile actions | Actual account details displayed | Nickname update, phone change and account deletion |
| Support and legal | Existing policy pages | Feedback submission and embedded policy panels |
| Payments and usage | Preview screens only | Real checkout, credit balance, orders, billing history and payment notifications |
| Sharing | Server-backed snapshots at existing URLs | Reference snapshot reuse/revocation behavior |

## Verification

- Web production build and API TypeScript checks pass.
- Chat-route regression test verifies switching from an existing model to another enabled model reaches message persistence; insufficient balance, unavailable models and another user's conversation remain rejected. Database and inference calls are stubbed in this test.
- The 34 existing search tests pass, including explicit/off mode preservation.
- Browser checks with isolated sample data verified Model A → Model B in one conversation, preserving the conversation ID, and outgoing `explicit` / `off` Web request values. No live inference or paid search was performed.
- Desktop account layout and 390px mobile usage/recharge layouts visually inspected. Payment preset/method selection, preview-only confirmation, usage source switching and settings navigation verified.
- Temporary browser fixtures are removed from the app before delivery. No test login, fake authentication bypass or fixture route is included in the production app.
- Full live payment flows are intentionally absent; live model/search-provider inference was not exercised. Pixel-perfect parity across unapproved reference features is not claimed.
