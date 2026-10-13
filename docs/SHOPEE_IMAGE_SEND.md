# Shopee image sends from Unified Inbox

Status: VERIFIED in controlled desktop/mobile UI and mocked provider integration; real customer delivery is not exercised.

Frontend: apps/inbox on production; https://shop.decocake.my/inbox/.
Backend: Inbox project uujcqcsfghqkukaydruc, shopee-chat-send with staff authentication and JWT retained.

Paste an image or use the image picker. A preview appears; Enter/Send submits, Shift+Enter creates a new line. Switching customer removes the queued image. Shopee accepts JPG/JPEG, PNG and GIF up to 10 MB; the backend checks content signatures and size. Existing file-picker normalization remains in place.

The server resolves the customer/shop from the existing conversation/order contract, claims a unique request ID, uploads multipart file data through sellerchat/upload_image, persists the returned image URL on the pending local message, and sends sellerchat/send_message with message_type=image and content.image_url. Failed uploads never call send_message. Duplicate request IDs never re-upload/re-send. Uncertain send results remain unknown; do not automatically retry.

Optional text is sent separately after the image, with its own audited request ID. If that text fails, the error explicitly says the image already went through and only text should be retried. Pending/sent/failed/unknown bubbles consume the existing status mapping.

Successful replies call sellerchat/read_conversation using the inbound message ID snapshotted before the send. Conversation int64 IDs are serialized exactly. Provider read failures are logged without turning an already successful send into a failed send.

Verification: Inbox typecheck/build; node scripts/test-shopee-image.mjs; controlled Chromium component at 1280x900 and 390x844 for paste/preview/Enter, Shift+Enter, file picker, invalid format, customer switch, duplicate empty Enter, no app errors/overflow. Hosted signed-in staff/provider customer delivery remains unexercised.
