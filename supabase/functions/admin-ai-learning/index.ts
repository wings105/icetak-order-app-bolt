import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization,apikey,x-client-info",
};

type JsonObject = Record<string, unknown>;
type Admin = { username: string; role: string; permissions: string[] };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function digits(value: unknown) {
  let phone = text(value).replace(/\D/g, "");
  if (phone.startsWith("0")) phone = `60${phone.slice(1)}`;
  else if (phone.startsWith("1")) phone = `60${phone}`;
  return phone;
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

async function currentAdmin(req: Request): Promise<Admin | null> {
  const token = text(req.headers.get("authorization")).replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user?.id) return null;

  const { data: admin, error: adminError } = await db
    .from("admin_users")
    .select("username,role,is_active")
    .eq("auth_user_id", auth.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (adminError || !admin?.username) return null;

  const { data: permissions } = await db
    .from("admin_permissions")
    .select("permissions")
    .eq("username", admin.username)
    .maybeSingle();

  return {
    username: String(admin.username),
    role: String(admin.role || "staff"),
    permissions: Array.isArray(permissions?.permissions)
      ? permissions.permissions.map(String)
      : [],
  };
}

async function validScheduleToken(req: Request) {
  const supplied = text(req.headers.get("x-ai-learning-token"));
  if (!supplied) return false;

  const { data, error } = await db
    .from("private_runtime_settings")
    .select("setting_value")
    .eq("setting_key", "qrpay_ai_worker_token")
    .maybeSingle();

  return !error && Boolean(data?.setting_value) && supplied === data.setting_value;
}

function canView(admin: Admin) {
  return admin.role === "owner" || ["view_finance", "manage_finance", "manage_admins"]
    .some((permission) => admin.permissions.includes(permission));
}

function canManage(admin: Admin) {
  return admin.role === "owner" || ["manage_finance", "manage_admins"]
    .some((permission) => admin.permissions.includes(permission));
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data as T;
}

async function overview() {
  const [settings, rules, runs, history, corrections] = await Promise.all([
    db.from("qrpay_ai_learning_settings").select("*").eq("singleton", true).single(),
    db.from("qrpay_ai_learning_rules")
      .select("id,signature,strategy_key,field_group,title,lesson,status,occurrence_count,first_seen_at,last_seen_at,activated_at,activated_by,updated_at,auto_update_locked,auto_update_locked_at,auto_update_locked_by,last_auto_updated_at,rule_version")
      .order("occurrence_count", { ascending: false })
      .order("last_seen_at", { ascending: false }),
    db.from("qrpay_ai_learning_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(30),
    db.from("qrpay_ai_learning_rule_history")
      .select("id,rule_id,run_id,action,actor,details,rolled_back_at,rolled_back_by,created_at,before_snapshot,after_snapshot,qrpay_ai_learning_rules(title,strategy_key)")
      .order("created_at", { ascending: false })
      .limit(60),
    db.from("qrpay_ai_corrections")
      .select("id,draft_id,field_path,correction_type,ai_value,human_value,strategy_key,learning_rule_id,created_at,qrpay_order_drafts(customer_name,request_key,order_no),qrpay_ai_learning_rules(title,status,auto_update_locked)")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const settingsData = unwrap(settings, "Settings");
  const ruleRows = unwrap(rules, "Rules") || [];
  const runRows = unwrap(runs, "Runs") || [];
  const historyRows = unwrap(history, "History") || [];
  const correctionRows = unwrap(corrections, "Corrections") || [];

  return {
    settings: settingsData,
    rules: ruleRows,
    runs: runRows,
    history: historyRows,
    corrections: correctionRows,
    summary: {
      total_rules: ruleRows.length,
      active_rules: ruleRows.filter((rule) => rule.status === "active").length,
      candidate_rules: ruleRows.filter((rule) => rule.status === "candidate").length,
      rejected_rules: ruleRows.filter((rule) => rule.status === "rejected").length,
      locked_rules: ruleRows.filter((rule) => rule.auto_update_locked).length,
      latest_correction_at: correctionRows[0]?.created_at || null,
    },
  };
}

async function whatsappSettings() {
  const result = await db
    .from("whatsapp_settings")
    .select("key,text_value,secret_value")
    .in("key", [
      "base_url",
      "partner_key",
      "waba_id",
      "admin_order_notify_phone",
      "customer_app_base_url",
    ]);

  const rows = unwrap(result, "WhatsApp settings") || [];
  return new Map(rows.map((row) => [String(row.key), text(row.secret_value || row.text_value)]));
}

function notificationMessage(run: JsonObject, appBase: string) {
  const time = new Intl.DateTimeFormat("ms-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(String(run.completed_at || run.started_at || new Date().toISOString())));

  const summary = (run.summary || {}) as JsonObject;
  const changes = Array.isArray(summary.changes) ? summary.changes as JsonObject[] : [];
  const ruleLines = changes.slice(0, 8).map((rule, index) =>
    `${index + 1}. ${text(rule.title)} — ${rule.action === "activated" ? "AKTIF" : "UPDATE"}`
  );

  return [
    "🤖 AI DRAFT LEARNING — AUTO UPDATE",
    `Tarikh: ${time}`,
    `Jenis: ${run.trigger_source === "manual" ? "Manual admin" : "Mingguan automatik"}`,
    "",
    `Pembetulan admin: ${Number(run.corrections_reviewed || 0)}`,
    `Draft disemak: ${Number(run.drafts_reviewed || 0)}`,
    `Rule baru aktif: ${Number(run.activated_rules || 0)}`,
    `Rule dikemas kini: ${Number(run.updated_rules || 0)}`,
    `Rule locked dilangkau: ${Number(run.skipped_locked_rules || 0)}`,
    `Rule aktif sekarang: ${Number(summary.active_rules || 0)}`,
    ...(ruleLines.length ? ["", "PERUBAHAN", ...ruleLines] : []),
    "",
    "Semak log, lock atau rollback:",
    `${appBase.replace(/\/$/, "")}/?admin=v2&view=ai-learning`,
  ].join("\n");
}

async function sendNotification(run: JsonObject) {
  const settings = await whatsappSettings();
  const partner = text(settings.get("partner_key"));
  const waba = text(settings.get("waba_id"));
  const adminPhone = digits(settings.get("admin_order_notify_phone") || "60129554732");
  const base = text(settings.get("base_url")) || "https://officialapi.wasapflow.com/bridge/v1";
  const appBase = text(settings.get("customer_app_base_url")) || "https://shop.decocake.my";

  if (!partner || !waba || !adminPhone) {
    throw new Error("WasapFlow/admin WhatsApp belum lengkap");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response: Response;

  try {
    response = await fetch(`${base.replace(/\/$/, "")}/messages/send`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-partner-key": partner,
        "x-waba-id": waba,
      },
      body: JSON.stringify({
        to: adminPhone,
        text: notificationMessage(run, appBase),
        preview_url: false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json().catch(() => ({})) as JsonObject;
  if (!response.ok || payload.success === false) {
    const nested = payload.error as JsonObject | undefined;
    throw new Error(text(nested?.message || payload.message) || `WasapFlow ${response.status}`);
  }

  const providerMessageId = text(payload.message_id || payload.id) || null;
  const { error } = await db.from("qrpay_ai_learning_runs")
    .update({
      notification_status: "sent",
      notification_sent_at: new Date().toISOString(),
      notification_error: null,
      provider_message_id: providerMessageId,
    })
    .eq("id", run.id);

  if (error) throw new Error(error.message);
  return { sent: true, provider_message_id: providerMessageId };
}

async function notifyRun(run: JsonObject) {
  if (run.notification_status === "disabled") return { sent: false, disabled: true };

  try {
    return await sendNotification(run);
  } catch (error) {
    const message = errorMessage(error).slice(0, 1000);
    await db.from("qrpay_ai_learning_runs")
      .update({ notification_status: "failed", notification_error: message })
      .eq("id", run.id);
    return { sent: false, error: message };
  }
}

async function runLearning(triggerSource: "scheduled" | "manual", actor: string) {
  const result = await db.rpc("icetak_ai_learning_run", {
    p_trigger_source: triggerSource,
    p_actor: actor,
  });

  const payload = unwrap(result, "Learning update") as JsonObject;
  if (payload.skipped) return payload;

  const run = payload.run as JsonObject;
  return {
    ...payload,
    notification: await notifyRun(run),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "Runtime not configured" }, 500);
  }

  try {
    const body = await req.json().catch(() => ({})) as JsonObject;
    const action = text(body.action);

    if (action === "scheduled_run") {
      if (!await validScheduleToken(req)) {
        return json({ ok: false, error: "Unauthorized scheduler" }, 401);
      }
      return json(await runLearning("scheduled", "weekly-auto"));
    }

    const admin = await currentAdmin(req);
    if (!admin) return json({ ok: false, error: "Admin authentication required" }, 401);
    if (!canView(admin)) return json({ ok: false, error: "Admin permission required" }, 403);

    if (action === "overview") {
      return json({ ok: true, data: await overview(), can_manage: canManage(admin) });
    }

    if (!canManage(admin)) {
      return json({ ok: false, error: "Manage Admins / Finance permission required" }, 403);
    }

    if (action === "run_now") {
      return json(await runLearning("manual", admin.username));
    }

    if (action === "set_settings") {
      const patch: JsonObject = {
        updated_at: new Date().toISOString(),
        updated_by: admin.username,
      };

      for (const key of ["auto_update_enabled", "notify_admin_enabled", "auto_promote_candidates"]) {
        if (typeof body[key] === "boolean") patch[key] = body[key];
      }

      if (body.minimum_occurrences !== undefined) {
        const threshold = Number(body.minimum_occurrences);
        if (!Number.isInteger(threshold) || threshold < 2 || threshold > 100) {
          return json({ ok: false, error: "Minimum occurrence mesti antara 2 hingga 100" }, 400);
        }
        patch.minimum_occurrences = threshold;
      }

      const result = await db.from("qrpay_ai_learning_settings")
        .update(patch)
        .eq("singleton", true)
        .select()
        .single();

      const settings = unwrap(result, "Save settings");
      await db.from("admin_audit").insert({
        action: "ai_learning_settings_updated",
        actor: admin.username,
        payload: patch,
      });
      return json({ ok: true, settings });
    }

    if (action === "rule_action") {
      const ruleId = text(body.rule_id);
      const ruleAction = text(body.rule_action);
      const historyId = text(body.history_id);

      if (!/^[0-9a-f-]{36}$/i.test(ruleId)) {
        return json({ ok: false, error: "Rule ID tidak sah" }, 400);
      }
      if (historyId && !/^[0-9a-f-]{36}$/i.test(historyId)) {
        return json({ ok: false, error: "History ID tidak sah" }, 400);
      }

      const result = await db.rpc("icetak_ai_learning_rule_action", {
        p_rule_id: ruleId,
        p_action: ruleAction,
        p_actor: admin.username,
        p_history_id: historyId || null,
      });
      return json(unwrap(result, "Rule action"));
    }

    if (action === "retry_notification") {
      const runId = text(body.run_id);
      if (!/^[0-9a-f-]{36}$/i.test(runId)) {
        return json({ ok: false, error: "Run ID tidak sah" }, 400);
      }

      const result = await db.from("qrpay_ai_learning_runs")
        .select("*")
        .eq("id", runId)
        .single();
      const run = unwrap(result, "Run") as JsonObject;
      return json({ ok: true, notification: await notifyRun(run) });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (error) {
    return json({ ok: false, error: errorMessage(error) }, 400);
  }
});
