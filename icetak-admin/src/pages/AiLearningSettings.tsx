import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import './AiLearningSettings.css';

type JsonValue = unknown;
type RuleStatus = 'active' | 'candidate' | 'rejected';
type Tab = 'rules' | 'history' | 'corrections' | 'applications' | 'runs';

type RuleExample = {
  field_path?: string;
  ai_value?: JsonValue;
  human_value?: JsonValue;
  draft_id?: string;
  transaction_id?: string | null;
};

type AppliedChange = {
  field: string;
  before: JsonValue;
  after: JsonValue;
  reason: string;
  message_id?: string;
};

type Settings = {
  auto_update_enabled: boolean;
  notify_admin_enabled: boolean;
  auto_promote_candidates: boolean;
  minimum_occurrences: number;
  lookback_days: number;
  schedule_label: string;
  last_run_at: string | null;
  last_success_at: string | null;
};

type Rule = {
  id: string;
  strategy_key: string;
  field_group: string;
  title: string;
  lesson: string;
  status: RuleStatus;
  occurrence_count: number;
  last_seen_at: string;
  activated_at: string | null;
  activated_by: string | null;
  auto_update_locked: boolean;
  auto_update_locked_at: string | null;
  auto_update_locked_by: string | null;
  last_auto_updated_at: string | null;
  rule_version: number;
  examples: RuleExample[];
  instruction: string;
  applied_count: number;
  changed_draft_count: number;
  last_applied_at: string | null;
  application_method: string | null;
  last_changes: AppliedChange[];
};

type RuleChange = {
  rule_id: string;
  title: string;
  strategy_key: string;
  action: string;
  feedback_count?: number;
  occurrence_count?: number;
};

type Run = {
  id: string;
  trigger_source: 'scheduled' | 'manual';
  actor: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  corrections_reviewed: number;
  drafts_reviewed: number;
  activated_rules: number;
  updated_rules: number;
  skipped_locked_rules: number;
  skipped_candidate_rules: number;
  notification_status: string;
  notification_error: string | null;
  summary: { changes?: RuleChange[]; active_rules?: number };
};

type RuleHistory = {
  id: string;
  rule_id: string;
  run_id: string | null;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  rolled_back_at: string | null;
  rolled_back_by: string | null;
  created_at: string;
  before_snapshot: Partial<Rule>;
  after_snapshot: Partial<Rule>;
  qrpay_ai_learning_rules: { title: string; strategy_key: string } | null;
};

type Correction = {
  id: string;
  field_path: string;
  correction_type: string;
  ai_value: JsonValue;
  human_value: JsonValue;
  strategy_key: string;
  created_at: string;
  qrpay_order_drafts: { customer_name: string; request_key: string; order_no: string | null } | null;
  qrpay_ai_learning_rules: { title: string; status: RuleStatus; auto_update_locked: boolean } | null;
};

type RuleApplication = {
  draft_id: string;
  request_key: string | null;
  customer_name: string | null;
  source_type: string;
  created_at: string;
  rule_id: string;
  strategy_key: string;
  title: string;
  application_method: string;
  prompt_injected: boolean;
  changes: AppliedChange[];
  change_count: number;
};

type Dashboard = {
  settings: Settings;
  rules: Rule[];
  runs: Run[];
  history: RuleHistory[];
  corrections: Correction[];
  applications: RuleApplication[];
  summary: {
    total_rules: number;
    active_rules: number;
    candidate_rules: number;
    rejected_rules: number;
    locked_rules: number;
    latest_correction_at: string | null;
    learned_drafts: number;
    prompted_drafts: number;
    rule_engine_drafts: number;
  };
};

type ApiResponse = {
  ok?: boolean;
  error?: string;
  data?: Dashboard;
  can_manage?: boolean;
  notification?: { sent?: boolean; error?: string };
};

const STATUS_LABEL: Record<RuleStatus, string> = {
  active: 'Aktif',
  candidate: 'Candidate',
  rejected: 'Rejected',
};

const ACTION_LABEL: Record<string, string> = {
  auto_activated: 'Auto aktif',
  weekly_updated: 'Update mingguan',
  manual_activated: 'Admin aktifkan',
  manual_deactivated: 'Admin hentikan',
  manual_rejected: 'Admin reject',
  rule_locked: 'Rule dikunci',
  rule_unlocked: 'Rule dibuka',
  rollback: 'Rollback',
};

const ROLLBACK_ACTIONS = new Set([
  'auto_activated',
  'weekly_updated',
  'manual_activated',
  'manual_deactivated',
  'manual_rejected',
]);

const formatter = new Intl.DateTimeFormat('ms-MY', {
  timeZone: 'Asia/Kuala_Lumpur',
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value?: string | null) {
  if (!value) return 'Belum ada';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}

function formatValue(value: JsonValue) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function flowLabel(value: string) {
  if (value === 'pickup_trigger') return 'Pickup';
  if (value === 'chat_trigger') return 'Prepaid';
  if (value === 'qrpay_payment') return 'QRPay';
  return value || 'Draft';
}

function methodLabel(value?: string | null) {
  return value === 'prompt_and_rule_engine' ? 'Prompt AI + rule engine' : 'Rule engine';
}

async function call(body: Record<string, unknown>): Promise<ApiResponse> {
  const { data, error } = await supabase.functions.invoke('admin-ai-learning', { body });
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response && typeof response.json === 'function') {
      const detail = await response.json().catch(() => null) as { error?: string } | null;
      if (detail?.error) throw new Error(detail.error);
    }
    throw new Error(error.message || 'AI Learning request failed');
  }

  const payload = (data || {}) as ApiResponse;
  if (payload.ok === false) throw new Error(payload.error || 'AI Learning request failed');
  return payload;
}

function Switch({ enabled, disabled, label, onChange }: {
  enabled: boolean;
  disabled?: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return <button
    type="button"
    className={`ai-learning-switch ${enabled ? 'is-on' : ''}`}
    disabled={disabled}
    aria-label={label}
    aria-pressed={enabled}
    onClick={() => onChange(!enabled)}
  ><span /></button>;
}

export default function AiLearningSettings() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>('rules');
  const [filter, setFilter] = useState<'all' | RuleStatus | 'locked'>('all');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [threshold, setThreshold] = useState('3');
  const [expandedRuleId, setExpandedRuleId] = useState('');

  const load = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const result = await call({ action: 'overview' });
      if (!result.data) throw new Error('AI Learning dashboard tidak lengkap');
      setDashboard(result.data);
      setCanManage(Boolean(result.can_manage));
      setThreshold(String(result.data.settings.minimum_occurrences || 3));
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  const rollbackableRuleIds = useMemo(() => new Set(
    (dashboard?.history || [])
      .filter((entry) => !entry.rolled_back_at && ROLLBACK_ACTIONS.has(entry.action))
      .map((entry) => entry.rule_id),
  ), [dashboard?.history]);

  const rules = useMemo(() => {
    const rows = dashboard?.rules || [];
    if (filter === 'all') return rows;
    if (filter === 'locked') return rows.filter((rule) => rule.auto_update_locked);
    return rows.filter((rule) => rule.status === filter);
  }, [dashboard?.rules, filter]);

  const mutate = async (key: string, body: Record<string, unknown>, success: string) => {
    setBusyKey(key);
    setError('');
    setNotice('');
    try {
      const result = await call(body);
      const warning = result.notification?.error
        ? ` WhatsApp gagal: ${result.notification.error}`
        : '';
      setNotice(`${success}${warning}`);
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    } finally {
      setBusyKey('');
    }
  };

  const setting = (key: string, value: boolean | number) => {
    void mutate(`setting-${key}`, { action: 'set_settings', [key]: value }, 'Tetapan AI Learning disimpan.');
  };

  const ruleAction = (rule: Rule, action: string, historyId?: string) => {
    if (action === 'rollback' && !window.confirm(`Rollback rule "${rule.title}" kepada versi sebelum update?`)) return;
    if (action === 'reject' && !window.confirm(`Reject rule "${rule.title}"?`)) return;
    void mutate(
      `${action}-${rule.id}`,
      { action: 'rule_action', rule_id: rule.id, rule_action: action, history_id: historyId || null },
      action === 'lock' ? 'Rule dikunci. Auto update tidak akan mengubah rule ini.'
        : action === 'unlock' ? 'Rule dibuka. Auto update dibenarkan semula.'
        : action === 'rollback' ? 'Rule berjaya di-rollback.'
        : 'Status rule berjaya dikemas kini.',
    );
  };

  if (loading) return <div className="ai-learning-loading">Memuatkan AI Learning Control Center...</div>;
  if (!dashboard) return <div className="ai-learning-alert error">{error || 'AI Learning tidak dapat dimuatkan.'}</div>;

  const { settings, summary } = dashboard;

  return <div className="fade-in ai-learning-page">
    <div className="page-header ai-learning-header">
      <div>
        <h1 className="page-title">AI Learning Control Center</h1>
        <p className="page-subtitle">Rule draft order, pembetulan admin, auto update mingguan dan rollback.</p>
      </div>
      <div className="ai-learning-header-actions">
        <button className="btn btn-outline" disabled={Boolean(busyKey)} onClick={() => void load()}>
          Refresh
        </button>
        {canManage && <button
          className="btn btn-primary"
          disabled={Boolean(busyKey)}
          onClick={() => void mutate('run-now', { action: 'run_now' }, 'Weekly AI update selesai.')}
        >{busyKey === 'run-now' ? 'Updating...' : 'Run Update Now'}</button>}
      </div>
    </div>

    {error && <div className="ai-learning-alert error">{error}</div>}
    {notice && <div className="ai-learning-alert success">{notice}</div>}

    <div className="ai-learning-metrics">
      <div className="ai-learning-metric"><span>Rule aktif</span><strong>{summary.active_rules}</strong><small>{summary.learned_drafts || 0} draft sudah guna rule sebenar</small></div>
      <div className="ai-learning-metric"><span>Candidate</span><strong>{summary.candidate_rules}</strong><small>Menunggu threshold / review</small></div>
      <div className="ai-learning-metric"><span>Rule locked</span><strong>{summary.locked_rules}</strong><small>Tidak boleh di-auto update</small></div>
      <div className="ai-learning-metric"><span>Last feedback</span><strong className="is-date">{formatDate(summary.latest_correction_at)}</strong><small>Pembetulan admin terkini</small></div>
    </div>

    <section className="panel ai-learning-settings-panel">
      <div className="panel-header"><div><div className="panel-title">Auto update mingguan</div><div className="panel-subtitle">{settings.schedule_label} · Semak pembetulan {settings.lookback_days} hari.</div></div></div>
      <div className="ai-learning-settings-grid">
        <div className="ai-learning-setting"><div><strong>Auto update</strong><span>{settings.auto_update_enabled ? 'Aktif' : 'Dimatikan'}</span></div><Switch enabled={settings.auto_update_enabled} disabled={!canManage || Boolean(busyKey)} label="Auto update mingguan" onChange={(value) => setting('auto_update_enabled', value)} /></div>
        <div className="ai-learning-setting"><div><strong>WhatsApp admin</strong><span>Notifikasi selepas update</span></div><Switch enabled={settings.notify_admin_enabled} disabled={!canManage || Boolean(busyKey)} label="Notifikasi WhatsApp admin" onChange={(value) => setting('notify_admin_enabled', value)} /></div>
        <div className="ai-learning-setting"><div><strong>Auto activate</strong><span>Candidate yang cukup bukti</span></div><Switch enabled={settings.auto_promote_candidates} disabled={!canManage || Boolean(busyKey)} label="Auto activate candidate" onChange={(value) => setting('auto_promote_candidates', value)} /></div>
        <div className="ai-learning-setting"><div><strong>Minimum correction</strong><span>Sebelum rule diaktifkan</span></div><input className="ai-learning-threshold" type="number" min={2} max={100} value={threshold} disabled={!canManage || Boolean(busyKey)} onChange={(event) => setThreshold(event.target.value)} onBlur={() => { const value = Number(threshold); if (Number.isInteger(value) && value >= 2 && value <= 100 && value !== settings.minimum_occurrences) setting('minimum_occurrences', value); else setThreshold(String(settings.minimum_occurrences)); }} /></div>
      </div>
      <div className="ai-learning-run-note">Last successful update: <strong>{formatDate(settings.last_success_at)}</strong></div>
    </section>

    <div className="filter-tabs ai-learning-tabs">{([
      ['rules', `Rules (${dashboard.rules.length})`],
      ['history', `History (${dashboard.history.length})`],
      ['corrections', `Correction Log (${dashboard.corrections.length})`],
      ['applications', `Penggunaan AI (${dashboard.applications.length})`],
      ['runs', `Weekly Runs (${dashboard.runs.length})`],
    ] as [Tab, string][]).map(([key, label]) => <button key={key} className={`filter-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>)}</div>

    {tab === 'rules' && <section className="panel ai-learning-table-panel">
      <div className="panel-header"><div><div className="panel-title">Learning Rules</div><div className="panel-subtitle">Klik detail untuk lihat arahan AI, contoh pembetulan admin dan bukti rule digunakan pada draft.</div></div><select className="ai-learning-filter" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">Semua status</option><option value="active">Aktif</option><option value="candidate">Candidate</option><option value="rejected">Rejected</option><option value="locked">Locked</option></select></div>
      <div className="ai-learning-table-wrap"><table className="ai-learning-table"><thead><tr><th>Rule / arahan AI</th><th>Status</th><th>Feedback / digunakan</th><th>Last update</th><th>Action</th></tr></thead><tbody>{rules.map((rule) => <Fragment key={rule.id}><tr>
        <td><strong>{rule.title}</strong><span className="ai-learning-code">{rule.strategy_key}</span><span className="ai-learning-lesson">{rule.lesson}</span><button className="ai-learning-detail-link" onClick={() => setExpandedRuleId(expandedRuleId === rule.id ? '' : rule.id)}>{expandedRuleId === rule.id ? 'Tutup detail' : 'Lihat detail rule & contoh'}</button></td>
        <td><span className={`ai-learning-badge ${rule.status}`}>{STATUS_LABEL[rule.status]}</span>{rule.auto_update_locked && <span className="ai-learning-badge locked">Locked</span>}<span className="ai-learning-meta">v{rule.rule_version}</span></td>
        <td><strong>{rule.occurrence_count}× correction</strong><span className="ai-learning-meta">{rule.applied_count || 0} draft guna · {rule.changed_draft_count || 0} draft dibetulkan</span><span className="ai-learning-meta">{rule.field_group}</span></td>
        <td><span>{formatDate(rule.last_seen_at)}</span><span className="ai-learning-meta">Auto: {formatDate(rule.last_auto_updated_at)}</span><span className="ai-learning-meta">Diguna: {formatDate(rule.last_applied_at)}</span>{rule.auto_update_locked_by && <span className="ai-learning-meta">Lock: {rule.auto_update_locked_by}</span>}</td>
        <td><div className="ai-learning-action-list">{canManage && <>
          {rule.status === 'active'
            ? <button className="ai-learning-action" disabled={Boolean(busyKey)} onClick={() => ruleAction(rule, 'deactivate')}>Deactivate</button>
            : <button className="ai-learning-action positive" disabled={Boolean(busyKey)} onClick={() => ruleAction(rule, 'activate')}>Activate</button>}
          <button className={`ai-learning-action ${rule.auto_update_locked ? 'positive' : ''}`} disabled={Boolean(busyKey)} onClick={() => ruleAction(rule, rule.auto_update_locked ? 'unlock' : 'lock')}>{rule.auto_update_locked ? 'Unlock' : 'Lock'}</button>
          <button className="ai-learning-action warning" disabled={Boolean(busyKey) || !rollbackableRuleIds.has(rule.id)} onClick={() => ruleAction(rule, 'rollback')}>Rollback</button>
          {rule.status === 'candidate' && <button className="ai-learning-action danger" disabled={Boolean(busyKey)} onClick={() => ruleAction(rule, 'reject')}>Reject</button>}
        </>}</div></td>
      </tr>{expandedRuleId === rule.id && <tr className="ai-learning-detail-row"><td colSpan={5}><div className="ai-learning-rule-detail">
        <div className="ai-learning-detail-grid">
          <section className="ai-learning-detail-card"><h3>Arahan sebenar kepada AI</h3><pre>{rule.instruction || `[${rule.strategy_key}] ${rule.lesson}`}</pre><p>Rule aktif dimasukkan ke prompt jika model AI tersedia, dan tetap dikuatkuasakan terus oleh rule engine untuk prepaid, pickup serta QRPay.</p></section>
          <section className="ai-learning-detail-card"><h3>Status penggunaan</h3><p><strong>{rule.applied_count || 0}</strong> draft menggunakan rule ini.</p><p><strong>{rule.changed_draft_count || 0}</strong> draft mempunyai nilai yang dibetulkan terus.</p><p>Kaedah terkini: <strong>{rule.application_method ? methodLabel(rule.application_method) : 'Belum digunakan selepas update'}</strong></p><p>Digunakan terakhir: <strong>{formatDate(rule.last_applied_at)}</strong></p></section>
        </div>
        <section className="ai-learning-detail-card ai-learning-example-card"><h3>Contoh correction admin yang membentuk rule ({rule.examples?.length || 0})</h3>{rule.examples?.length ? <table className="ai-learning-example-table"><thead><tr><th>Field</th><th>AI asal</th><th>Admin betulkan</th></tr></thead><tbody>{[...rule.examples].reverse().slice(0, 10).map((example, index) => <tr key={`${rule.id}-${index}`}><td><span className="ai-learning-code">{example.field_path || '—'}</span></td><td><span className="ai-learning-value before">{formatValue(example.ai_value)}</span></td><td><span className="ai-learning-value after">{formatValue(example.human_value)}</span></td></tr>)}</tbody></table> : <p>Belum ada contoh correction.</p>}</section>
        {rule.last_changes?.length > 0 && <section className="ai-learning-detail-card ai-learning-example-card"><h3>Perubahan sebenar pada draft terakhir</h3><table className="ai-learning-example-table"><thead><tr><th>Field</th><th>Sebelum</th><th>Selepas</th><th>Sebab</th></tr></thead><tbody>{rule.last_changes.map((change, index) => <tr key={`${rule.id}-change-${index}`}><td><span className="ai-learning-code">{change.field}</span></td><td><span className="ai-learning-value before">{formatValue(change.before)}</span></td><td><span className="ai-learning-value after">{formatValue(change.after)}</span></td><td>{change.reason}</td></tr>)}</tbody></table></section>}
      </div></td></tr>}</Fragment>)}{rules.length === 0 && <tr><td colSpan={5} className="ai-learning-empty">Tiada rule untuk filter ini.</td></tr>}</tbody></table></div>
    </section>}

    {tab === 'history' && <section className="panel ai-learning-table-panel"><div className="panel-header"><div><div className="panel-title">Version & rollback history</div><div className="panel-subtitle">Setiap perubahan rule menyimpan snapshot sebelum dan selepas update.</div></div></div><div className="ai-learning-table-wrap"><table className="ai-learning-table"><thead><tr><th>Masa</th><th>Rule</th><th>Perubahan</th><th>Actor</th><th>Rollback</th></tr></thead><tbody>{dashboard.history.map((entry) => {
      const rule = dashboard.rules.find((candidate) => candidate.id === entry.rule_id);
      const rollbackable = ROLLBACK_ACTIONS.has(entry.action) && !entry.rolled_back_at;
      return <tr key={entry.id}><td>{formatDate(entry.created_at)}</td><td><strong>{entry.qrpay_ai_learning_rules?.title || rule?.title || 'Rule'}</strong><span className="ai-learning-code">{entry.qrpay_ai_learning_rules?.strategy_key || rule?.strategy_key}</span></td><td><span className={`ai-learning-badge ${entry.action === 'rollback' ? 'candidate' : 'active'}`}>{ACTION_LABEL[entry.action] || entry.action}</span><span className="ai-learning-meta">v{entry.before_snapshot.rule_version || 1} → v{entry.after_snapshot.rule_version || 1}</span>{entry.before_snapshot.status !== entry.after_snapshot.status && <span className="ai-learning-meta">{entry.before_snapshot.status} → {entry.after_snapshot.status}</span>}</td><td>{entry.actor}</td><td>{entry.rolled_back_at ? <span className="ai-learning-meta">Rolled back {formatDate(entry.rolled_back_at)}</span> : rollbackable && rule && canManage ? <button className="ai-learning-action warning" disabled={Boolean(busyKey)} onClick={() => ruleAction(rule, 'rollback', entry.id)}>Rollback versi ini</button> : '—'}</td></tr>;
    })}{dashboard.history.length === 0 && <tr><td colSpan={5} className="ai-learning-empty">Belum ada history.</td></tr>}</tbody></table></div></section>}

    {tab === 'corrections' && <section className="panel ai-learning-table-panel"><div className="panel-header"><div><div className="panel-title">Admin correction log</div><div className="panel-subtitle">Nilai asal AI dibandingkan dengan nilai yang admin sahkan.</div></div></div><div className="ai-learning-table-wrap"><table className="ai-learning-table"><thead><tr><th>Masa / customer</th><th>Field</th><th>AI draft</th><th>Admin betulkan</th><th>Rule</th></tr></thead><tbody>{dashboard.corrections.map((correction) => <tr key={correction.id}><td><strong>{correction.qrpay_order_drafts?.customer_name || 'Customer'}</strong><span className="ai-learning-meta">{formatDate(correction.created_at)}</span>{correction.qrpay_order_drafts?.order_no && <span className="ai-learning-code">{correction.qrpay_order_drafts.order_no}</span>}</td><td><span className="ai-learning-code">{correction.field_path}</span><span className="ai-learning-meta">{correction.correction_type}</span></td><td><span className="ai-learning-value before">{formatValue(correction.ai_value)}</span></td><td><span className="ai-learning-value after">{formatValue(correction.human_value)}</span></td><td><strong>{correction.qrpay_ai_learning_rules?.title || correction.strategy_key}</strong>{correction.qrpay_ai_learning_rules && <span className={`ai-learning-badge ${correction.qrpay_ai_learning_rules.status}`}>{STATUS_LABEL[correction.qrpay_ai_learning_rules.status]}</span>}{correction.qrpay_ai_learning_rules?.auto_update_locked && <span className="ai-learning-badge locked">Locked</span>}</td></tr>)}{dashboard.corrections.length === 0 && <tr><td colSpan={5} className="ai-learning-empty">Belum ada correction.</td></tr>}</tbody></table></div></section>}

    {tab === 'applications' && <section className="panel ai-learning-table-panel"><div className="panel-header"><div><div className="panel-title">Bukti penggunaan rule pada draft sebenar</div><div className="panel-subtitle">{summary.learned_drafts || 0} draft diproses · {summary.rule_engine_drafts || 0} rule engine · {summary.prompted_drafts || 0} prompt AI.</div></div></div><div className="ai-learning-table-wrap"><table className="ai-learning-table"><thead><tr><th>Masa / customer</th><th>Flow</th><th>Rule / kaedah</th><th>Perubahan sebenar</th><th>Draft</th></tr></thead><tbody>{dashboard.applications.map((application, index) => <tr key={`${application.draft_id}-${application.rule_id}-${index}`}><td><strong>{application.customer_name || 'Customer'}</strong><span className="ai-learning-meta">{formatDate(application.created_at)}</span></td><td><span className="ai-learning-badge active">{flowLabel(application.source_type)}</span></td><td><strong>{application.title || application.strategy_key}</strong><span className="ai-learning-code">{application.strategy_key}</span><span className="ai-learning-meta">{methodLabel(application.application_method)}</span></td><td>{application.changes.length ? application.changes.slice(0, 3).map((change, changeIndex) => <span key={`${application.draft_id}-${change.field}-${changeIndex}`} className="ai-learning-applied-change"><span className="ai-learning-code">{change.field}</span><span><span className="ai-learning-value before">{formatValue(change.before)}</span> → <span className="ai-learning-value after">{formatValue(change.after)}</span></span></span>) : <span className="ai-learning-meta">Rule diperiksa; tiada pembetulan diperlukan</span>}</td><td><span className="ai-learning-code">{application.request_key || application.draft_id}</span></td></tr>)}{dashboard.applications.length === 0 && <tr><td colSpan={5} className="ai-learning-empty">Belum ada draft baru selepas rule engine diaktifkan.</td></tr>}</tbody></table></div></section>}

    {tab === 'runs' && <section className="panel ai-learning-table-panel"><div className="panel-header"><div><div className="panel-title">Weekly update runs</div><div className="panel-subtitle">Log auto update, manual run dan status WhatsApp admin.</div></div></div><div className="ai-learning-table-wrap"><table className="ai-learning-table"><thead><tr><th>Masa</th><th>Trigger</th><th>Draft / correction</th><th>Rule update</th><th>WhatsApp admin</th></tr></thead><tbody>{dashboard.runs.map((run) => <tr key={run.id}><td><strong>{formatDate(run.started_at)}</strong><span className="ai-learning-meta">{run.status}</span></td><td><span className={`ai-learning-badge ${run.trigger_source === 'scheduled' ? 'active' : 'candidate'}`}>{run.trigger_source === 'scheduled' ? 'Auto mingguan' : 'Manual'}</span><span className="ai-learning-meta">{run.actor}</span></td><td><strong>{run.drafts_reviewed} draft</strong><span className="ai-learning-meta">{run.corrections_reviewed} corrections</span></td><td><strong>{run.activated_rules} aktif · {run.updated_rules} update</strong><span className="ai-learning-meta">{run.skipped_locked_rules} locked dilangkau</span></td><td><span className={`ai-learning-badge ${run.notification_status === 'sent' ? 'active' : run.notification_status === 'failed' ? 'rejected' : 'candidate'}`}>{run.notification_status}</span>{run.notification_error && <span className="ai-learning-meta ai-learning-error-text">{run.notification_error}</span>}{run.notification_status === 'failed' && canManage && <button className="ai-learning-action" disabled={Boolean(busyKey)} onClick={() => void mutate(`retry-${run.id}`, { action: 'retry_notification', run_id: run.id }, 'Notifikasi WhatsApp dihantar semula.')}>Retry WhatsApp</button>}</td></tr>)}{dashboard.runs.length === 0 && <tr><td colSpan={5} className="ai-learning-empty">Belum ada weekly run.</td></tr>}</tbody></table></div></section>}
  </div>;
}
