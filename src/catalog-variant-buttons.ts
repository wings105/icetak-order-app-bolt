type Model = { value: string; label?: string; price: number };
type Cell = { model: Model; size: string; wording: string };
export function variantMatrix(models: Model[]): Cell[] | null {
  if (models.length < 2) return null;
  const seen = new Set<string>();
  const cells: Cell[] = [];
  for (const model of models) {
    const match = (model.label || '').match(/^(.+),\s*(No Wording|Add Wording(?:\s*-\s*in chat)?)\s*$/i);
    if (!match) return null;
    const size = match[1].trim();
    const wording = /^no wording$/i.test(match[2].trim()) ? 'No Wording' : 'Add Wording';
    const key = JSON.stringify([size, wording]);
    if (seen.has(key)) return null;
    seen.add(key);
    cells.push({ model, size, wording });
  }
  return cells;
}

// Keep the existing model-change handler as the single owner of price, stock,
// image, wording validation and cart identity. Buttons select real model IDs.
export function mountVariantButtons(container: HTMLElement, models: Model[]) {
  const select = container.querySelector<HTMLSelectElement>('[data-config-model]');
  if (!select || models.length < 2) return;
  const heading = select.previousElementSibling as HTMLElement | null;
  if (!heading || heading.tagName !== 'H4') return;
  const matrix = variantMatrix(models);
  const labels = matrix ? [...new Set(matrix.map(cell => cell.size))] : models.map(model => model.label || model.value);
  const choices = matrix ? ['No Wording', 'Add Wording'].filter(label => matrix.some(cell => cell.wording === label)) : [];
  const hidden = document.createElement('div');
  hidden.hidden = true;
  hidden.style.display = 'none';
  select.before(hidden);
  hidden.append(select);
  select.tabIndex = -1;

  function row(label: string) {
    const wrap = document.createElement('div');
    wrap.className = 'catalog-variant-row';
    wrap.style.cssText = 'display:grid;grid-template-columns:70px minmax(0,1fr);gap:12px;align-items:start;margin-top:18px';
    const title = document.createElement('h4');
    title.textContent = label;
    title.style.cssText = 'margin:10px 0 0;font-size:14px';
    const buttons = document.createElement('div');
    buttons.className = 'catalog-config-options';
    buttons.setAttribute('role', 'group');
    buttons.setAttribute('aria-label', label);
    wrap.append(title, buttons);
    return { wrap, buttons };
  }
  const sizeRow = row(matrix ? 'Size' : 'Variasi');
  heading.replaceWith(sizeRow.wrap);
  const wordingRow = matrix ? row('Wording') : null;
  if (wordingRow) {
    hidden.after(wordingRow.wrap);
    const original = container.querySelector<HTMLElement>('[data-wording-options]');
    if (original) {
      original.hidden = true;
      original.style.display = 'none';
      const title = original.previousElementSibling as HTMLElement | null;
      if (title?.tagName === 'H4') { title.hidden = true; title.style.display = 'none'; }
    }
  }
  function button(label: string, parent: HTMLElement, action: () => void) {
    const node = document.createElement('button');
    node.type = 'button';
    node.textContent = label;
    node.style.cssText = 'flex:0 1 auto;min-height:40px;padding:9px 12px;font-size:14px;white-space:normal;overflow-wrap:anywhere;text-align:left';
    node.onclick = action;
    parent.append(node);
    return node;
  }
  function choose(model: Model | undefined) {
    if (!model) return;
    select!.value = model.value;
    select!.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const sizeButtons = labels.map((label, index) => button(label, sizeRow.buttons, () => {
    if (!matrix) { choose(models[index]); return; }
    const current = matrix.find(cell => cell.model.value === select.value);
    const next = matrix.find(cell => cell.size === label && cell.wording === current?.wording)
      || matrix.find(cell => cell.size === label);
    choose(next?.model);
  }));
  const wordingButtons = choices.map(label => button(label, wordingRow!.buttons, () => {
    const current = matrix!.find(cell => cell.model.value === select.value);
    choose(matrix!.find(cell => cell.size === current?.size && cell.wording === label)?.model);
  }));
  function sync() {
    const current = matrix?.find(cell => cell.model.value === select!.value);
    sizeButtons.forEach((node, index) => {
      const active = matrix ? labels[index] === current?.size : models[index].value === select!.value;
      node.classList.toggle('active', active);
      node.setAttribute('aria-pressed', String(active));
    });
    wordingButtons.forEach((node, index) => {
      const available = matrix!.some(cell => cell.size === current?.size && cell.wording === choices[index]);
      node.disabled = !available;
      node.style.opacity = available ? '1' : '.45';
      node.title = available ? '' : 'Tidak tersedia untuk saiz ini';
      node.classList.toggle('active', choices[index] === current?.wording);
      node.setAttribute('aria-pressed', String(choices[index] === current?.wording));
    });
  }
  select.addEventListener('change', sync);
  sync();
}
