# Make.com: ClickUp order creation gate

Deployed 2026-10-27 to project buivecgahhmrhlmfujgt.

Endpoint: https://buivecgahhmrhlmfujgt.supabase.co/functions/v1/clickup-order-gate
Method: POST
Content-Type: application/json
Header: x-order-gate-key (use the private value supplied in ChatGPT; never commit it)
Parse response: Yes. Timeout: 40 seconds where supported.
The Edge Function uses its own authentication; deploy with verify_jwt=false / --no-verify-jwt.

## Scenario placement
Full-order webhook (orderno + address + product[]) -> HTTP claim -> filter allow_create Boolean equals true -> existing router/iterator -> create ClickUp task -> fill mandatory Order ID custom field -> HTTP register_task per task -> existing required flow steps -> per-order aggregator -> HTTP finish.
Only gate task creation. Other independent delivery/status update routes should continue normally.
Existing gate table: public.clickup_order_creation_registry.
Order ID is the only order/customer business value stored; all other fields are operational metadata and task IDs.

## 1. Claim before every router/iterator that creates tasks
{"action":"claim","order_id":"MAP_ORDERNO"}
Map MAP_ORDERNO to the original webhook orderno. Do not shorten order IDs.
Optional expected_tasks is the planned number of tasks, not quantity.
New: {"ok":true,"allow_create":true,"run_id":"...","status":"processing"}
Existing (including incomplete): {"ok":true,"allow_create":false,"reason":"order_already_claimed",...}
Add an AND filter: ok = Boolean true AND allow_create = Boolean true.
Preserve run_id for the whole execution. Do not use a second exists-then-insert flow.
On timeout retry the same claim module, but do not bypass the filter. An uncertain claim is fail-closed and may need manual inspection.
If expected task count is known, action set_expected with order_id, run_id, expected_tasks may be called before the iterator.

## 2. Register each successfully created task
After the Order ID / customer name CF has been populated, POST:
{"action":"register_task","order_id":"MAP_ORDERNO","run_id":"MAP_CLAIM_RUN_ID","task_key":"MAP_STABLE_ITEM_KEY","clickup_task_id":"MAP_CREATE_TASK_ID"}
Use the returned task.id, not the ClickUp custom ID or order ID.
task_key must identify the task-producing item/group consistently: item ID + variation + original iterator position, or a fixed route/group identifier for grouped tasks. It must differ for two intended tasks. A quantity of 3 does not necessarily mean three tasks.
The endpoint reads ClickUp directly and validates the task's order CF and list before registering it. Allowed lists are ORDER LIST 18375902 and completed archive 901612769752.
Retried registration of the same key + task ID is safe.
409 TASK_KEY_CONFLICT means the same logical item is being registered with a different task ID; stop and inspect.
409 TASK_ORDER_MISMATCH can mean the CF is not populated yet. Retry registration after the CF write, never rerun Create Task to fix it.

## 3. Finish ONCE per order after the entire route is finished
Use an aggregator (group by order_id) or another once-per-order finalization point AFTER all expected branches/tasks.
{"action":"finish","order_id":"MAP_ORDERNO","run_id":"MAP_CLAIM_RUN_ID","expected_tasks":2}
Map 2 to the intended number of tasks from routing. Do not derive this solely from successful bundles if errors were ignored, because that could hide a missing item.
Do not put finish independently after each iteration.
Completion: {"ok":true,"status":"task_complete_created","complete":true,...}
If tasks are missing, complete=false; the order remains locked.

## Errors and status
POST {"action":"status","order_id":"MAP_ORDERNO"} to inspect.
For failure, use an error-handler route:
{"action":"fail","order_id":"MAP_ORDERNO","run_id":"MAP_CLAIM_RUN_ID","error":"MAKE_FLOW_FAILED"}
No automatic unlock / expiry / reset is exposed. needs_check blocks new creation.
Do not configure automatic retry of an uncertain Create Task request without first checking whether ClickUp created it. Retrying register_task/finish is safe; a new Create Task is a new remote write.
Updating an existing order and creation of tasks are separate concerns.

## ClickUp webhook
A database trigger on clickup_webhook_events records observed task IDs for matching Order ID CF a8996f77-fcf9-4804-84bb-89f97905473d. It supports taskUpdated payloads and taskCreated payloads that reach the existing ingest route.
The currently observed pipeline has taskUpdated events; no new ClickUp webhook subscription was registered by this change. register_task uses live API verification so completion does not depend on webhook delivery.
task_complete_created is registry status only; no production task status is changed.

## Bootstrap and verification
41 active-order records plus one two-task order were initialized: 42 pre-existing orders total at rollout.
Tests: 8 concurrent public HTTP claim calls allowed one execution and blocked seven; invalid API key ->401; 2-task verification remained partial after one and completed after two; repeated register did not inflate counts; conflicting task key and wrong run rejected; existing webhook observer tested in a rolled-back transaction; anon/authenticated table and RPC access denied.
No test ClickUp tasks were created, and synthetic registry rows were deleted.
