# Shopee SG token delivery from the existing refresh flow

The owner approved importing the existing SG Access Token and Partner Key to Inbox configuration on 13 October 2026. Shop 1635364464 is isolated from primary MY shop 188218638. Current SG signed escrow/refund reads and CHAT_READ_VERIFIED are observed; no customer send was performed.

The existing refresh automation must deliver each new SG token to iCetak after it updates ClickUp task 86d2e0xh4. Do not create a competing provider refresh loop. The connected v2taskmagic team lists no Shopee refresh flow. The owner configured the HTTP module independently; its actual request is now verified at the receiver. A producer flow link is only needed if an agent must inspect or edit that external automation.

## Receiver verification — 13 October 2026, 11:00 MYT

The first SG attempt failed with 401 because its slot had no dedicated rotation key. The owner generated the SG key at 10:58:47 MYT and retried the POST. Its new token was persisted at 10:59:25 MYT with credential version 2; the provider read succeeded at 10:59:26 with CHAT_READ_VERIFIED / READY. MY independently rotated at 10:53:31 to version 20 and is also READY. Read-only database checks prove that the shops have different access tokens and different rotation-key hashes. No credential values are in this document.

This proves actual SG token delivery and read readiness. It does not prove the external scenario's enabled schedule or its next scheduled refresh; those were not inspected. Historical notes stating that the SG HTTP push still needs connecting are superseded by this receiver evidence.

## Request contract

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

Validation after wiring: observe each actual fresh-token push with sanitized applied/duplicate result and CHAT_READ_VERIFIED. Compare MY state against a snapshot immediately around the SG push; MY may also legitimately refresh through its own automation. Same-token retry guards have controlled integration/SQL coverage; an actual replay from the owner's external scenario was not performed here. Do not claim the next scheduled refresh was observed before it occurs.
