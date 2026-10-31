# Inbox quick snippets

The lightning shortcut beside Send inserts `/` in an empty composer and focuses the
textarea with the cursor at the end. Staff type a shortcut such as `bantu`, then
Enter selects the matching snippet into the composer. The normal next Enter or
Send action sends the prepared message through the existing sender.

Existing drafts are preserved: a separating space and `/` are appended when needed.
An existing trailing slash/query is reused when the lightning button is pressed
again. Selection replaces that trailing query, with the existing variable and image
handling. Enter with no matching snippet stays in the chooser; it cannot accidentally
send a literal shortcut. Shift+Enter and IME composition retain normal text entry.

31 October 2026: actual enhancer plus a controlled React textarea passed desktop
1280×844 and mobile 390×844 checks for slash insertion/focus, repeated click,
typing/Enter expansion, React state synchronization, existing draft preservation,
existing query reuse, no-match Enter and the normal send handler. No customer test
message was sent. Inbox TypeScript/build pass; hosted release is checked separately.
