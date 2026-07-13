import { supabase } from './appdeploy-client';

type Row = Record<string, any>;
const env = (import.meta as any).env || {};
const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || '';
let cached: Row | null = null;
let cachedAt = 0;
let busy = false;

function esc(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  } as Record<string,string>)[char]);
}

function params(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return [];
}

function metaParamCount(components: unknown): number {
  let max = 0;
  for (const component of Array.isArray(components) ? components : []) {
    const text = String((component as Row)?.text || '');
    for (const match of text.matchAll(/\{\{([0-9]+)\}\}/g)) max = Math.max(max, Number(match[1] || 0));
  }
  return max;
}

async function snapshot(force = false): Promise<Row> {
  if (!force && cached && Date.now() - cachedAt < 10000) return cached;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Admin session expired');
  const response = await fetch(`${supabaseUrl}/functions/v1/whatsapp-admin/snapshot`, {
    headers: { authorization:`Bearer ${token}`, 'content-type':'application/json' }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.error || `Snapshot ${response.status}`);
  cached = result;
  cachedAt = Date.now();
  return result;
}

function ruleState(rule: Row, templates: Row[]) {
  if (!rule.enabled) return { code:'disabled', label:'DISABLED', detail:'Notification disabled' };
  if (!rule.template_enabled) return { code:'freeform', label:'FREE-FORM ONLY', detail:'Template after 24H disabled' };
  const template = templates.find(item => item.name === rule.template_name && item.language === rule.template_language && String(item.status).toUpperCase() === 'APPROVED');
  if (!template) return { code:'bad', label:'MISSING TEMPLATE', detail:`${rule.template_name || 'No template'} (${rule.template_language || 'ms'}) not approved` };
  const mapped = params(rule.template_params).length;
  const expected = metaParamCount(template.components);
  if (mapped !== expected) return { code:'bad', label:'PARAM MISMATCH', detail:`Meta expects ${expected}; mapping has ${mapped}` };
  return { code:'ready', label:'READY', detail:`${template.name} · ${template.language} · ${mapped} params` };
}

function healthCard(data: Row) {
  const h = data.health || {};
  const invalid = Array.isArray(h.invalid_rules) ? h.invalid_rules.length : 0;
  return `<section id="wfProdHealth" class="wf5-card wf-prod-health">
    <div class="wf5-title"><div><h3>Production Health</h3><p>Live backend, trigger, queue dan template validation.</p></div><b class="wf-health-${h.overall_ready ? 'ok' : 'bad'}">${h.overall_ready ? 'PRODUCTION READY' : 'ACTION NEEDED'}</b></div>
    <div class="wf-health-grid">
      <span><b>${h.connected ? 'OK' : 'FAIL'}</b> Connection</span>
      <span><b>${h.dispatcher_ready ? 'OK' : 'FAIL'}</b> Dispatcher</span>
      <span><b>${esc(h.trigger_count || 0)}/${esc(h.expected_trigger_count || 7)}</b> Event triggers</span>
      <span><b>${esc(h.valid_rules || 0)}</b> Valid rules</span>
      <span><b>${invalid}</b> Invalid rules</span>
      <span><b>${esc(h.failed || 0)}</b> Failed queue</span>
    </div>
  </section>`;
}

function enhanceOverview(main: HTMLElement, data: Row) {
  if (main.querySelector('#wfProdHealth')) return;
  const metrics = main.querySelector('.wf5-metrics');
  metrics?.insertAdjacentHTML('afterend', healthCard(data));
}

function enhanceRules(main: HTMLElement, data: Row) {
  const templates = (data.templates || []) as Row[];
  main.querySelectorAll<HTMLElement>('.wf5-rule').forEach(card => {
    const eventType = card.querySelector<HTMLInputElement>('input[name="event_type"]')?.value || '';
    const rule = (data.rules || []).find((item: Row) => item.event_type === eventType);
    if (!rule) return;
    const state = ruleState(rule, templates);
    const summary = card.querySelector('summary');
    let badge = summary?.querySelector<HTMLElement>('.wf-live-badge');
    if (!badge && summary) {
      badge = document.createElement('em');
      badge.className = 'wf-live-badge';
      summary.append(badge);
    }
    if (badge) {
      badge.className = `wf-live-badge ${state.code}`;
      badge.textContent = state.label;
      badge.title = state.detail;
    }
    const actions = card.querySelector<HTMLElement>('.wf5-actions');
    if (actions && !actions.querySelector('[data-test-rule]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.testRule = eventType;
      button.textContent = 'Test This Rule';
      button.onclick = event => {
        event.preventDefault();
        event.stopPropagation();
        document.querySelector<HTMLButtonElement>('#wf5Wrap [data-tab="test"]')?.click();
        window.setTimeout(() => {
          const select = document.querySelector<HTMLSelectElement>('#wf5Test select[name="event_type"]');
          if (select) select.value = eventType;
          document.querySelector<HTMLElement>('#wf5Test')?.scrollIntoView({ behavior:'smooth', block:'start' });
        }, 80);
      };
      actions.append(button);
    }
    let note = card.querySelector<HTMLElement>('.wf-rule-live-note');
    if (!note) {
      note = document.createElement('small');
      note.className = 'wf-rule-live-note';
      card.querySelector('form')?.append(note);
    }
    if (note) note.textContent = state.detail;
  });
}

function enhanceTemplates(main: HTMLElement, data: Row) {
  const grid = main.querySelector<HTMLElement>('.wf5-grid');
  if (!grid || grid.dataset.liveMapping === '1') return;
  grid.dataset.liveMapping = '1';
  const templates = (data.templates || []) as Row[];
  const rules = (data.rules || []) as Row[];
  grid.innerHTML = rules.filter(rule => rule.event_type !== 'magic_login').map(rule => {
    const state = ruleState(rule, templates);
    return `<article class="wf5-card">
      <div class="wf5-title"><div><h3>${esc(rule.label || rule.event_type)}</h3><p>${esc(rule.event_type)}</p></div><b class="wf-live-badge ${state.code}">${state.label}</b></div>
      <p><strong>Template:</strong> ${esc(rule.template_name || '—')} · ${esc(rule.template_language || 'ms')}</p>
      <p><strong>Parameters:</strong> ${esc(params(rule.template_params).join(' → ') || 'none')}</p>
      <small>${esc(state.detail)}</small>
    </article>`;
  }).join('');
}

function enhanceQueue(main: HTMLElement) {
  const sections = Array.from(main.querySelectorAll<HTMLElement>('.wf5-card'));
  const provider = sections.find(section => section.querySelector('h3')?.textContent?.includes('Recent Provider Logs'));
  if (!provider || provider.querySelector('#wfLogFilter')) return;
  const select = document.createElement('select');
  select.id = 'wfLogFilter';
  select.innerHTML = '<option value="all">All provider logs</option><option value="sent">Sent only</option><option value="failed">Failed only</option><option value="template">Template only</option><option value="text">Free-form only</option>';
  select.onchange = () => {
    provider.querySelectorAll<HTMLElement>('.wf5-log > div').forEach(row => {
      const text = (row.textContent || '').toLowerCase();
      row.style.display = select.value === 'all' || text.includes(select.value) ? '' : 'none';
    });
  };
  provider.querySelector('h3')?.insertAdjacentElement('afterend', select);
}

async function enhance() {
  if (busy) return;
  const wrapper = document.querySelector<HTMLElement>('#wf5Wrap');
  const main = wrapper?.querySelector<HTMLElement>('#wf5Main');
  if (!wrapper || !main || main.querySelector('.wf5-loading')) return;
  busy = true;
  try {
    const data = await snapshot();
    const active = wrapper.querySelector<HTMLButtonElement>('aside [data-tab].active')?.dataset.tab || 'overview';
    if (active === 'overview') enhanceOverview(main, data);
    if (active === 'rules') enhanceRules(main, data);
    if (active === 'templates') enhanceTemplates(main, data);
    if (active === 'queue') enhanceQueue(main);
  } catch (error) {
    console.warn('WhatsApp production audit:', error);
  } finally {
    busy = false;
  }
}

const style = document.createElement('style');
style.textContent = `
.wf-prod-health{margin-top:14px}.wf-health-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.wf-health-grid span{padding:11px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc}.wf-health-grid b{display:block}.wf-health-ok{color:#15803d}.wf-health-bad{color:#b91c1c}.wf-live-badge{margin-left:auto;border-radius:999px;padding:5px 9px;font-size:11px;font-style:normal;white-space:nowrap}.wf-live-badge.ready{background:#dcfce7;color:#166534}.wf-live-badge.freeform{background:#fef3c7;color:#92400e}.wf-live-badge.disabled{background:#e5e7eb;color:#475569}.wf-live-badge.bad{background:#fee2e2;color:#991b1b}.wf-rule-live-note{grid-column:1/-1;color:#64748b}#wfLogFilter{margin:0 0 12px;padding:9px;border:1px solid #cbd5e1;border-radius:10px}@media(max-width:700px){.wf-health-grid{grid-template-columns:1fr 1fr}}
`;
document.head.append(style);

window.addEventListener('wf:queue-updated', () => { cached = null; cachedAt = 0; });
window.addEventListener('focus', () => { cached = null; cachedAt = 0; void enhance(); });
setInterval(() => void enhance(), 2200);
