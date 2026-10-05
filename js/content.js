(function () {
  if (/\.workers\.dev$/.test(location.hostname)) {
    var robots = document.createElement('meta');
    robots.name = 'robots';
    robots.content = 'noindex, nofollow, noarchive, noimageindex';
    document.head.appendChild(robots);
  }

  var root = document.documentElement;
  root.classList.add('texts-pending');

  var revealed = false;
  function reveal() {
    if (revealed) return;
    revealed = true;
    root.classList.remove('texts-pending');
  }
  setTimeout(reveal, 2500);

  var cache = {};
  function load(name) {
    if (!/^[a-z0-9-]+$/.test(name)) return Promise.resolve(null);
    if (!cache[name]) {
      cache[name] = fetch('content/texts/' + name + '.json', { cache: 'no-cache' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .catch(function () { return null; });
    }
    return cache[name];
  }

  function split(ref) {
    var i = ref.indexOf('.');
    return i === -1 ? null : { file: ref.slice(0, i), path: ref.slice(i + 1) };
  }

  function get(data, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, data);
  }

  function safeHttps(value) {
    try {
      var url = new URL(value);
      return url.protocol === 'https:' ? url.href : null;
    } catch (e) {
      return null;
    }
  }

  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text) n.textContent = text;
    return n;
  }

  function paragraphs(text) {
    return text.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean).map(function (block) {
      var p = document.createElement('p');
      block.split('\n').forEach(function (line, i) {
        if (i) p.appendChild(document.createElement('br'));
        p.appendChild(document.createTextNode(line));
      });
      return p;
    });
  }

  var renderers = {
    offers: function (items) {
      return items.map(function (item) {
        var card = node('div', 'offer-card');
        card.appendChild(node('div', 'icon', item.icon));
        card.appendChild(node('h3', null, item.title));
        card.appendChild(node('p', null, item.text));
        return card;
      });
    },
    tags: function (items) {
      return items.map(function (label) { return node('span', null, label); });
    },
    linkcards: function (items) {
      return items.map(function (item) {
        var url = safeHttps(item.url);
        if (!url) return null;
        var a = node('a', 'link-card');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.appendChild(node('span', 'platform', item.platform));
        a.appendChild(node('span', 'handle', item.handle));
        a.appendChild(node('p', 'desc', item.description));
        a.appendChild(node('span', 'arrow', item.link_text));
        return a;
      }).filter(Boolean);
    }
  };

  function apply(selector, handler) {
    var jobs = [];
    document.querySelectorAll(selector).forEach(function (el) {
      var ref = split(el.getAttribute(selector.slice(1, -1)));
      if (!ref) return;
      jobs.push(load(ref.file).then(function (data) {
        if (!data) return;
        var value = get(data, ref.path);
        if (value !== undefined) handler(el, value);
      }));
    });
    return jobs;
  }

  function run() {
    var jobs = [].concat(
      apply('[data-text]', function (el, value) {
        if (typeof value !== 'string') return;
        if (value.trim() === '') {
          el.hidden = true;
        } else {
          el.hidden = false;
          el.textContent = value;
        }
      }),
      apply('[data-href]', function (el, value) {
        var url = typeof value === 'string' ? safeHttps(value) : null;
        if (url) el.href = url;
      }),
      apply('[data-paragraphs]', function (el, value) {
        if (typeof value !== 'string' || value.trim() === '') return;
        el.replaceChildren.apply(el, paragraphs(value));
      }),
      apply('[data-list]', function (el, value) {
        var render = renderers[el.getAttribute('data-list-render')];
        if (!render || !Array.isArray(value)) return;
        el.replaceChildren.apply(el, render(value));
      })
    );
    Promise.all(jobs).then(reveal, reveal);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
