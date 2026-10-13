# Shopee SG token delivery from the existing refresh flow

The owner approved importing the existing SG Access Token and Partner Key to Inbox configuration on 13 October 2026. Shop 1635364464 is isolated from primary MY shop 188218638. Current SG signed escrow/refund reads and CHAT_READ_VERIFIED are observed; no customer send was performed.

The existing Activepieces refresh producer must deliver each new SG token to iCetak after it updates ClickUp task 86d2e0xh4. Do not create a competing provider refresh loop. The connected v2taskmagic team lists no Shopee refresh flow, and prior context contains no URL/project/flow ID for the real producer. Its link is required before editing that automation. No automatic future SG push is claimed.

In Admin V2 Settings, select Shopee SG, then generate its dedicated rotation key when connecting the flow. Do not reuse the MY key. Keep the returned key in the automation connection/secret store, never in the URL, commit, logs or chat. Do not generate a key without delivering it to the intended producer, because it is returned only once.

Add an HTTP POST after the existing SG ClickUp update:

```
POST https://uujcqcsfghqkukaydruc.supabase.co/functions/v1/shopee-token-rotate
Content-Type: application/json
x-icetak-shopee-key: <SG rotation key from owner Settings>
```

```json
{
  "partner_id": "2005777",
  "shop_id": "1635364464",
  "access_token": "<access_token from the existing refresh step>"
}
```

Only these three body fields are required. Keep absent expiry unknown; do not manufacture issue/expiry times from a ClickUp task update time. Use one serialized source and retry the same token if a request fails. The receiver rejects known retired-token replay and validates the configured shop/app under its row lock. A read check follows and failed readiness blocks sending.

Validation after wiring: observe one actual scheduled fresh-token push with sanitized applied/duplicate result, CHAT_READ_VERIFIED and unchanged MY credential version/token fingerprints. Retry the same payload and verify no token/version/audit rewrite or extra provider send. Do not claim automatic rotation complete before this outcome is observed.
