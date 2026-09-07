# GANGRAM design migration

Updated 2026-09-08. The local `gangram-new-ui/` reference is ignored by Git. Application code and builds do not import or depend on it.

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
- Profile displays the actual account name and bound phone. Nickname editing uses the existing profile endpoint. Phone changes verify the new number through the same OTP service as login before replacing it. Account deletion requires typing `DELETE`, then permanently removes the local user, sessions, conversations, usage records, token ledger and redemptions.
- **Backend changes required and implemented:** authenticated phone-change OTP request/verification endpoints and `DELETE /api/me` were added. When the external auth service is enabled, its existing OTP endpoints prove ownership of the new number.
- Account deletion affects only this service. The chatbot API deletes the user's server-side conversations, usage records, token ledger, redemptions, sessions and user row; it does not modify the shared auth service.
- The auth service remains the OTP verifier. If the same phone number signs in later, successful OTP verification registers a fresh GANGRAM account with a new local user record, starting balance and no previous conversations.
- Existing server-backed token redemption, language preference and logout actions remain connected.
- Dialog supports Escape, backdrop dismissal, keyboard focus trapping and focus restoration.

### Payments and usage: UI only

- Recharge includes the reference's 500 / 1,000 / 2,500 / 5,000 credit presets, custom amount, WeChat Pay / Ali Pay / Card selection, and order summary.
- The reference's display conversion of ¥1 per credit is used only for preview; it is not a configured live price.
- The action is labeled “Preview payment” and explicitly confirms that no payment occurred. It does not create an order, call a payment API, modify balances or persist a simulated transaction.
- Credit balance is shown as unavailable (—), not fabricated or confused with the real token balance.
- Usage offers Balance and Toking Wallet views with clearly labeled sample history. It does not call billing APIs or present sample rows as real account activity.
- **No payment or usage backend code changes were made.** Existing real gift-code redemption is separate and retained.

### Conversation search

- Added the reference-style Search icon beside the sidebar collapse control and the `Command/Ctrl + K` shortcut. The dialog shows recent conversations before typing, waits briefly while typing, supports arrow-key selection and opens the selected conversation.
- The desktop dialog follows the reference's measured 640px floating panel, 40px blue-focused search field, 12vh placement, softened background overlay and plain title/snippet rows. Extra row icons, dates, close control and keyboard footer are omitted to match the supplied reference.
- Sidebar copy uses “New conversation” and “Recent”, with the measured 14px header/action icons and reference spacing.
- Search covers both conversation titles and message content. Matching message text is returned as a short preview, with a maximum of 30 recent results.
- **Backend change required and implemented:** `GET /api/conversations/search?q=` performs a case-insensitive database search scoped to the authenticated user. Deleted conversations and every other user's content are excluded.

### Dedicated login screen

- Login now lives at `/login` instead of opening over the chat. Guest actions preserve the current path and return there after successful login.
- The existing country list, validation, OTP request/verification endpoints, session cookie and legal consent text remain in use. An already signed-in user who visits `/login` is returned to the requested page.
- **No new login backend behavior is required.** Production OTP continues through the configured auth service. Local development uses `000000` when that service is disabled; a separately configured `AUTH_TEST_OTP` is also accepted for controlled integration testing.

### Feedback page

- Feedback matches the reference as a simple support page with a direct `support@gangram.com` email link.
- **No backend change is required.** The app does not collect, store, or simulate feedback submissions.

### Terms and privacy

- Login-page Terms of Service and Privacy Policy links open standalone reading pages in a new browser tab. These pages follow the reference's white full-height layout, sticky 56px header, close control and centered 760px document column.
- Account settings renders the same terms and privacy content directly inside the settings content pane. It no longer sends users to a separate page from those two settings sections.
- Both presentations share one legal-content component, including localized copy, update date and support address, so their text cannot drift apart.
- The legal copy continues to describe current GANGRAM behavior. Reference statements about connecting personal provider accounts and live credit purchases were not copied because those functions are not implemented.

## Other decisions still pending

| Area | Current behavior retained | Reference behavior not yet adopted |
| --- | --- | --- |
| Messages | Existing send, stop, stream and Markdown | Edit/resend, copy actions, reasoning disclosure, math rendering and View latest |
| Drafts | Existing draft lifecycle | Per-conversation persisted drafts and different textarea growth limits |
| History | List, delete, server-backed search and keyboard shortcut | Date groups and conversation action menus |
| Login | Dedicated phone/OTP screen using existing authentication | Different resend/countdown flow |
| Profile actions | Nickname update, verified phone change and API-backed GANGRAM data deletion | — |
| Support and legal | Standalone and embedded policy views, plus email feedback page | — |
| Payments and usage | Preview screens only | Real checkout, credit balance, orders, billing history and payment notifications |
| Sharing | Server-backed snapshots at existing URLs | Reference snapshot reuse/revocation behavior |

## Verification

- Web production build, API build, Prisma validation and all workspace TypeScript checks pass.
- Chat-route regression test verifies switching from an existing model to another enabled model reaches message persistence; insufficient balance, unavailable models and another user's conversation remain rejected. Database and inference calls are stubbed in this test.
- All 43 API tests pass. New route checks verify that conversation search is scoped to the authenticated user and that account deletion removes dependent records before the user.
- Dedicated login renders at the reference 390px card width on desktop and retains the existing real OTP form. The sidebar Search icon and shortcut are present in the current local build.
- Browser checks verify that both standalone legal pages use the shared reference layout and current localized content. Login links open `/terms-of-use` and `/privacy-policy` in new tabs; account settings embeds the same shared content component.
- Browser checks with isolated sample data verified Model A → Model B in one conversation, preserving the conversation ID, and outgoing `explicit` / `off` Web request values. No live inference or paid search was performed.
- Desktop account layout and 390px mobile usage/recharge layouts visually inspected. Payment preset/method selection, preview-only confirmation, usage source switching and settings navigation verified.
- Temporary browser fixtures are removed from the app before delivery. No test login, fake authentication bypass or fixture route is included in the production app.
- Full live payment flows are intentionally absent; live model/search-provider inference was not exercised. Pixel-perfect parity across unapproved reference features is not claimed.
