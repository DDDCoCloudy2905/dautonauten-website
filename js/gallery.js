(async function () {
  const grid = document.getElementById('gallery-grid');
  if (!grid) return;

  const SLIDE_MS = 5000;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function safeHttpsUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function safeImagePath(value) {
    return typeof value === 'string' && /^\/?assets\/[\w\-./ ]+$/.test(value) && !value.includes('..')
      ? value.replace(/^\//, '')
      : null;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function button(className, label, text) {
    const b = el('button', className, text);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    return b;
  }

  function collectImages(item) {
    const list = [{ src: item.image, alt: item.image_alt }];
    if (Array.isArray(item.more_images)) {
      for (const extra of item.more_images) list.push({ src: extra && extra.image, alt: extra && extra.alt });
    }
    return list
      .map((entry) => ({ src: safeImagePath(entry.src), alt: entry.alt || item.title }))
      .filter((entry) => entry.src);
  }

  function buildSlider(item, images) {
    const wrap = el('div', 'gallery-image');

    const track = el('div', 'gallery-track');
    images.forEach((image, index) => {
      const slide = el('div', 'gallery-slide');
      slide.setAttribute('role', 'group');
      slide.setAttribute('aria-roledescription', 'Bild');
      slide.setAttribute('aria-label', `${index + 1} von ${images.length}`);
      const img = document.createElement('img');
      img.src = image.src;
      img.alt = image.alt;
      img.loading = 'lazy';
      slide.appendChild(img);
      track.appendChild(slide);
    });
    wrap.appendChild(track);

    if (images.length < 2) return wrap;

    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-roledescription', 'Bildergalerie');
    wrap.setAttribute('aria-label', item.title);

    const prev = button('gallery-arrow gallery-prev', 'Vorheriges Bild', '‹');
    const next = button('gallery-arrow gallery-next', 'Nächstes Bild', '›');
    const dots = el('div', 'gallery-dots');
    const dotButtons = images.map((_, index) => {
      const dot = button('gallery-dot', `Bild ${index + 1} anzeigen`);
      dot.addEventListener('click', () => goTo(index, true));
      dots.appendChild(dot);
      return dot;
    });
    wrap.append(prev, next, dots);

    let current = 0;
    let timer = null;

    function width() {
      return track.clientWidth;
    }

    function setCurrent(index) {
      current = index;
      dotButtons.forEach((dot, i) => dot.setAttribute('aria-current', i === index ? 'true' : 'false'));
    }

    function goTo(index, fromUser) {
      const target = (index + images.length) % images.length;
      track.scrollTo({ left: target * width(), behavior: reduceMotion ? 'auto' : 'smooth' });
      setCurrent(target);
      if (fromUser) restart();
    }

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
      track.setAttribute('aria-live', 'polite');
    }

    function start() {
      stop();
      track.setAttribute('aria-live', 'off');
      timer = setInterval(() => goTo(current + 1, false), SLIDE_MS);
    }

    function restart() {
      if (timer) start();
    }

    prev.addEventListener('click', () => goTo(current - 1, true));
    next.addEventListener('click', () => goTo(current + 1, true));

    let settleTimer = null;
    track.addEventListener('scroll', () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        const index = Math.round(track.scrollLeft / width());
        if (index !== current && index >= 0 && index < images.length) setCurrent(index);
      }, 100);
    }, { passive: true });

    if (!reduceMotion) {
      wrap.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'mouse') start();
      });
      wrap.addEventListener('pointerleave', stop);
      document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    }

    setCurrent(0);
    return wrap;
  }

  const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true });

  function dateValue(entry) {
    const time = Date.parse(entry.item.published);
    return Number.isNaN(time) ? null : time;
  }

  function byDate(direction) {
    return (a, b) => {
      const da = dateValue(a);
      const db = dateValue(b);
      if (da === null && db === null) return a.index - b.index;
      if (da === null) return 1;
      if (db === null) return -1;
      return (da - db) * direction || a.index - b.index;
    };
  }

  function byTitle(a, b) {
    return collator.compare(a.item.title, b.item.title);
  }

  const sorters = {
    standard: (a, b) => a.index - b.index,
    newest: byDate(-1),
    oldest: byDate(1),
    'title-asc': byTitle,
    'title-desc': (a, b) => byTitle(b, a),
    shop: (a, b) => collator.compare(a.item.shop || '', b.item.shop || '') || byTitle(a, b)
  };

  function setupSorting(entries) {
    const toolbar = document.getElementById('gallery-toolbar');
    const select = document.getElementById('gallery-sort');

    function render() {
      const sorter = sorters[select ? select.value : 'standard'] || sorters.standard;
      grid.replaceChildren(...entries.slice().sort(sorter).map((entry) => entry.card));
    }

    if (toolbar && select && entries.length > 1) {
      if (!entries.some((entry) => dateValue(entry) !== null)) {
        select.querySelectorAll('option[value="newest"], option[value="oldest"]').forEach((option) => option.remove());
      }
      toolbar.hidden = false;
      select.addEventListener('change', render);
    }
    render();
  }

  function showMessage(text) {
    grid.replaceChildren(el('p', 'gallery-empty', text));
    grid.style.display = 'block';
  }

  try {
    const res = await fetch('content/gallery.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const entries = [];

    for (const [index, item] of items.entries()) {
      const link = safeHttpsUrl(item.link);
      const images = collectImages(item);
      if (!link || !images.length || !item.title) {
        console.warn('Galerie: Eintrag übersprungen (Link muss mit https:// beginnen, Bild muss aus dem eigenen Upload stammen):', item.title);
        continue;
      }

      const card = el('article', 'gallery-card');
      const body = el('div', 'gallery-body');
      if (item.shop) body.appendChild(el('span', 'gallery-shop', item.shop));
      body.appendChild(el('h3', 'gallery-title', item.title));
      if (item.description) body.appendChild(el('p', 'gallery-desc', item.description));

      const a = el('a', 'cta-cta-style-2', 'Ansehen auf Etsy');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      body.appendChild(a);

      card.append(buildSlider(item, images), body);
      entries.push({ item, card, index });
    }

    if (!entries.length) {
      showMessage('Hier entstehen bald neue Designs. Schau gern bald wieder vorbei!');
    } else {
      setupSorting(entries);
    }
  } catch (e) {
    console.warn('Galerie konnte nicht geladen werden:', e);
    showMessage('Die Galerie konnte gerade nicht geladen werden. Bitte versuche es später noch einmal.');
  }
})();
