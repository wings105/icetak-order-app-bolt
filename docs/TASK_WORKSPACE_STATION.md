# Task Workspace for a trusted PC

The `/task-workspace/` entry mounts the same Task Workspace component, without Admin V2, sidebar or person-login bootstrap. The owner-provided URL includes an unguessable workstation capability in its fragment. The credential is never in tracked source, static assets, query strings, access logs or public roadmap notes. A bare URL shows a missing-link message rather than exposing customer tasks.

## Access and operations

The browser sends the capability only to `task-workspace-station` as a bearer credential. Its SHA-256 digest, enabled flag and device actor live in service-only `private_runtime_settings` under `task_workspace_station`. Every request checks that setting and an active staff device identity without an Auth user; permissions are clamped to `view_orders` and `edit_order`. This identity is recorded in the existing task/brief/ClickUp action audit records. Disabling the setting or device revokes the link on the next request.

Only the existing Task Workspace and task ClickUp operations are routed. Connection/key management, other admin services and arbitrary actions are rejected. Multipart requests retain exact original bytes. Existing task membership, actor permissions, stale revision, idempotency, unknown delivery recovery, review-only field writes and file guards remain authoritative. No browser database grant/RLS policy is widened. The new gateway performs capability authentication itself; the original admin gateways retain JWT verification and person-auth checks.

The complete sidepanel remains available: live status, Review customer, Complete, all original attachments, copyable fields, direct design POST, original customer chat/brief, internal work/QC and existing AWB/reference printing. Task deep links retain the workstation fragment. The original Admin and Acrylic routes continue to work.

## Verification

- Controlled gateway checks cover absent/wrong/revoked tokens, inactive/owner/person-bound identities, permissions clamp, actor spoofing, action/service/origin/size guards, no credential forwarding, unchanged binary multipart and immediate revocation. The real workspace factory reads under the verified station actor; original admin factories reject anonymous requests.
- Full actual standalone desktop/mobile browser checks run with an empty Auth session and controlled transport. No Auth/Admin bootstrap occurs. List/panel switching, original 1200×800 displayed/clipboard bytes, SKU/wording, task links, status/review/Complete, direct upload, native file download, AWB/reference frames, dirty-navigation guards and read-only UI behavior pass without page errors.
- Full production build, Admin TypeScript, backend TypeScript and existing workspace/readiness/automation/media/ClickUp regressions pass.
- Live backend: station v1 with capability authentication, Task Workspace v19 and task-clickup v4 with JWT true. Device configuration has no person-login binding. A native transaction proves server actor/audit and exact replay, then rolls back with zero retained station QA events.
- Hosted release and actual no-login read/copy observations are recorded in the release PR. Native Photoshop paste and physical printer output remain outside browser evidence.

## Revocation / replacement

Use the service-only runtime setting to set `enabled` false, or deactivate its device actor. Generate a new cryptographically random capability and store only its digest to replace a lost/shared URL; deliver the new complete link privately to the owner. Do not add the credential to documentation, roadmap content or Git history. This URL is intended for the owner's trusted production PCs and ClickUp embed.
