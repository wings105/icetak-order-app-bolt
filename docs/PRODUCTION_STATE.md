# 2026-11-07 — MCP consent origin handling

MCP Edge Function v4 adds signed browser/request-bound consent tokens before password
authentication. Opaque/missing Origin no longer fails solely on that header; invalid
origin or CSRF evidence still blocks. Current actual-handler regressions pass. Owner
credential login and complete ChatGPT linking remain separate acceptance work. See
[contract](ICETAK_MCP.md#7-november--oauth-consent-form-origin-handling).

# 2026-11-07 — Default shared name for two custom sets

Order worker v75 applies one unambiguous note/chat name to both custom sets by
owner policy unless item-specific/conflicting instructions exist. Two-unit and
custom-task mapping guards remain; ready stock is excluded. Actual-worker tests
verify both custom task paths. Live mixed-order custom-task recovery verifies92%,
Ai Check, Confirmed and original scope/proof summary; no sends or ready-stock
change. Multiline proof is deduplicated by message ID. See
[contract](AUTOBRIEF_PRODUCT_CONTEXT.md#one-name-defaults-across-two-custom-sets--7-november-2026).
