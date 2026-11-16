(() => {
  const search = document.querySelector('#ngantin-search');
  const results = document.querySelector('#ngantin-status');
  const grid = document.querySelector('#ngantin-designs');
  const filters = document.querySelector('#ngantin-filters');
  const pagination = document.querySelector('#ngantin-pages');
  const previous = document.querySelector('#ngantin-prev');
  const next = document.querySelector('#ngantin-next');
  const pageLabel = document.querySelector('#ngantin-page');
  const root = '/galeri-initial/';
  const pageSize = 24;
  let designs = [];
  let category = '';
  let page = 1;

  function designCard(design) {
    const item = document.createElement('li');
    const figure = document.createElement('figure');
    figure.id = design.code;
    const image = document.createElement('img');
    image.src = root + design.image;
    image.alt = design.name + ' ' + design.code;
    image.loading = 'lazy';
    image.className = 'ngantin-preview';
    const caption = document.createElement('figcaption');
    const name = document.createElement('strong');
    name.textContent = design.name;
    const code = document.createElement('span');
    code.className = 'design-code';
    code.textContent = design.code;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.design = design.code;
    button.dataset.sample = design.name;
    button.textContent = 'Pilih design';
    button.setAttribute('aria-label', 'Pilih design ' + design.code);
    caption.append(name, code, button);
    figure.append(image, caption);
    item.append(figure);
    return item;
  }

  function render() {
    const terms = search.value.toLowerCase().trim().split(/\s+/);
    const matches = designs.filter(design => {
      const text = [design.code, design.name, design.category].join(' ').toLowerCase();
      return (!category || design.category === category) && terms.every(term => text.includes(term));
    });
    const total = Math.max(1, Math.ceil(matches.length / pageSize));
    page = Math.min(page, total);
    const offset = (page - 1) * pageSize;
    grid.replaceChildren(...matches.slice(offset, offset + pageSize).map(designCard));
    results.textContent = matches.length
      ? matches.length.toLocaleString('ms-MY') + ' design'
      : 'Tiada design sepadan.';
    pagination.hidden = total < 2;
    pageLabel.textContent = page + ' / ' + total;
    previous.disabled = page <= 1;
    next.disabled = page >= total;
  }

  function changePage(offset) {
    page += offset;
    render();
    results.scrollIntoView({ block: 'start' });
  }

  function openLinkedDesign() {
    const code = location.hash.slice(1).toUpperCase();
    if (!designs.some(design => design.code === code)) return;
    category = '';
    for (const button of filters.children) {
      button.setAttribute('aria-pressed', String(button.dataset.category === ''));
    }
    search.value = code;
    page = 1;
    render();
    document.getElementById(code).scrollIntoView();
  }

  search.addEventListener('input', () => { page = 1; render(); });
  previous.addEventListener('click', () => changePage(-1));
  next.addEventListener('click', () => changePage(1));
  addEventListener('hashchange', openLinkedDesign);

  fetch(root + 'ngantin/designs.json')
    .then(response => {
      if (!response.ok) throw Error('Katalog tidak dapat dimuatkan.');
      return response.json();
    })
    .then(data => {
      designs = data;
      for (const value of ['', ...new Set(designs.map(design => design.category))]) {
        const button = document.createElement('button');
        button.textContent = value || 'Semua';
        button.type = 'button';
        button.dataset.category = value;
        button.setAttribute('aria-pressed', String(value === category));
        button.addEventListener('click', () => {
          category = value;
          page = 1;
          for (const option of filters.children) {
            option.setAttribute('aria-pressed', String(option === button));
          }
          render();
        });
        filters.append(button);
      }
      render();
      openLinkedDesign();
    })
    .catch(() => { results.textContent = 'Katalog tidak dapat dimuatkan. Cuba muat semula halaman.'; });
})();
