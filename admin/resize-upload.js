(function () {
  'use strict';

  var TRIGGER_EDGE = 1600;
  var TRIGGER_BYTES = 500 * 1024;
  var DEFAULT_EDGE = 1200;
  var DEFAULT_QUALITY = 82;
  var EDGES = [800, 1000, 1200, 1400, 1600, 2000];
  var HANDLED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  var busy = false;

  function formatBytes(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(2).replace('.', ',') + ' MB';
    return Math.round(n / 1024) + ' KB';
  }

  function isHandled(file) {
    return HANDLED_TYPES.indexOf(file.type) !== -1;
  }

  function loadBitmap(file) {
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(function () { return createImageBitmap(file); })
      .catch(function () { return null; });
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function scaleTo(source, sw, sh, tw, th, fillWhite) {
    var cur = source;
    var cw = sw;
    var ch = sh;
    while (cw / 2 >= tw && ch / 2 >= th) {
      var nw = Math.round(cw / 2);
      var nh = Math.round(ch / 2);
      var step = makeCanvas(nw, nh);
      var sctx = step.getContext('2d');
      sctx.imageSmoothingQuality = 'high';
      sctx.drawImage(cur, 0, 0, nw, nh);
      cur = step;
      cw = nw;
      ch = nh;
    }
    var out = makeCanvas(tw, th);
    var ctx = out.getContext('2d');
    if (fillWhite) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, tw, th);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, tw, th);
    return out;
  }

  function render(bitmap, edge, format, quality) {
    var scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
    var w = Math.max(1, Math.round(bitmap.width * scale));
    var h = Math.max(1, Math.round(bitmap.height * scale));
    var canvas = scaleTo(bitmap, bitmap.width, bitmap.height, w, h, format === 'jpeg');
    var mime = format === 'jpeg' ? 'image/jpeg' : 'image/webp';
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        resolve({ blob: blob, width: w, height: h, mime: mime });
      }, mime, quality / 100);
    });
  }

  function injectStyles() {
    if (document.getElementById('resize-upload-styles')) return;
    var style = document.createElement('style');
    style.id = 'resize-upload-styles';
    style.textContent = [
      '.ru-overlay{position:fixed;inset:0;z-index:2147483000;background:rgba(27,27,58,.6);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,sans-serif}',
      '.ru-dialog{background:#fff;color:#1b1b3a;border-radius:14px;max-width:940px;width:100%;max-height:94vh;overflow:auto;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.35)}',
      '.ru-dialog h2{margin:0 0 4px;font-size:20px}',
      '.ru-sub{margin:0 0 16px;color:#464665;font-size:14px;overflow-wrap:anywhere}',
      '.ru-compare{display:grid;grid-template-columns:1fr 1fr;gap:14px}',
      '.ru-box{border:1px solid #d9d3ea;border-radius:10px;padding:10px;background:#f8f5f2}',
      '.ru-box h3{margin:0 0 8px;font-size:14px}',
      '.ru-img{height:280px;display:flex;align-items:center;justify-content:center;border-radius:6px;background-color:#fff;background-image:linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%),linear-gradient(45deg,#eee 25%,transparent 25%,transparent 75%,#eee 75%);background-size:16px 16px;background-position:0 0,8px 8px}',
      '.ru-img img{max-width:100%;max-height:100%;object-fit:contain}',
      '.ru-meta{margin:8px 0 0;font-size:13px;line-height:1.4}',
      '.ru-controls{display:flex;flex-wrap:wrap;gap:14px;margin:16px 0;align-items:flex-end}',
      '.ru-controls label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}',
      '.ru-controls select,.ru-controls input[type=range]{font-size:14px}',
      '.ru-controls select{padding:6px 8px;border:1px solid #b9b0d6;border-radius:6px;background:#fff}',
      '.ru-hint{margin:0 0 12px;padding:8px 10px;border-radius:8px;background:#f2d9e0;font-size:13px}',
      '.ru-note{margin:12px 0 0;font-size:12px;color:#464665}',
      '.ru-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}',
      '.ru-actions button{font:600 14px system-ui,sans-serif;padding:10px 16px;border-radius:999px;border:2px solid #2c2c85;cursor:pointer}',
      '.ru-primary{background:#2c2c85;color:#f8f5f2}',
      '.ru-secondary{background:#fff;color:#2c2c85}',
      '.ru-cancel{background:#fff;color:#464665;border-color:#b9b0d6!important}',
      '.ru-actions button:disabled{opacity:.5;cursor:wait}',
      '@media (max-width:700px){.ru-compare{grid-template-columns:1fr}.ru-img{height:200px}}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function option(select, value, label) {
    var o = document.createElement('option');
    o.value = String(value);
    o.textContent = label;
    select.appendChild(o);
  }

  function ask(file, bitmap) {
    injectStyles();
    var originalUrl = URL.createObjectURL(file);
    var currentUrl = null;
    var latest = null;
    var token = 0;

    return new Promise(function (resolve) {
      var overlay = el('div', 'ru-overlay');
      var dialog = el('div', 'ru-dialog');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', 'Bild verkleinern');

      dialog.appendChild(el('h2', null, 'Dieses Bild ist für das Web zu groß'));
      dialog.appendChild(el('p', 'ru-sub', 'Datei: ' + file.name + '. Möchtest du es vor dem Hochladen verkleinern? Das macht deine Seite schneller und schützt deine Originale.'));

      var compare = el('div', 'ru-compare');
      var before = el('div', 'ru-box');
      before.appendChild(el('h3', null, 'Vorher'));
      var beforeImgBox = el('div', 'ru-img');
      var beforeImg = document.createElement('img');
      beforeImg.src = originalUrl;
      beforeImg.alt = 'Originalbild';
      beforeImgBox.appendChild(beforeImg);
      before.appendChild(beforeImgBox);
      before.appendChild(el('p', 'ru-meta', bitmap.width + ' × ' + bitmap.height + ' px · ' + formatBytes(file.size)));

      var after = el('div', 'ru-box');
      after.appendChild(el('h3', null, 'Nachher'));
      var afterImgBox = el('div', 'ru-img');
      var afterImg = document.createElement('img');
      afterImg.alt = 'Verkleinertes Bild';
      afterImgBox.appendChild(afterImg);
      after.appendChild(afterImgBox);
      var afterMeta = el('p', 'ru-meta', 'Wird berechnet …');
      after.appendChild(afterMeta);
      compare.append(before, after);
      dialog.appendChild(compare);

      var controls = el('div', 'ru-controls');
      var edgeLabel = el('label', null, 'Längste Seite');
      var edgeSelect = document.createElement('select');
      var edges = EDGES.slice();
      if (edges.indexOf(DEFAULT_EDGE) === -1) edges.push(DEFAULT_EDGE);
      edges.sort(function (a, b) { return a - b; });
      edges.forEach(function (e) { option(edgeSelect, e, e + ' px' + (e === DEFAULT_EDGE ? ' (empfohlen)' : '')); });
      edgeSelect.value = String(DEFAULT_EDGE);
      edgeLabel.appendChild(edgeSelect);

      var formatLabel = el('label', null, 'Format');
      var formatSelect = document.createElement('select');
      option(formatSelect, 'webp', 'WebP (empfohlen, klein, mit Transparenz)');
      option(formatSelect, 'jpeg', 'JPEG (ohne Transparenz)');
      formatLabel.appendChild(formatSelect);

      var qualityLabel = el('label', null, 'Qualität: ' + DEFAULT_QUALITY);
      var qualityInput = document.createElement('input');
      qualityInput.type = 'range';
      qualityInput.min = '50';
      qualityInput.max = '95';
      qualityInput.value = String(DEFAULT_QUALITY);
      qualityLabel.appendChild(qualityInput);

      controls.append(edgeLabel, formatLabel, qualityLabel);
      dialog.appendChild(controls);

      var hint = el('p', 'ru-hint');
      hint.hidden = true;
      dialog.appendChild(hint);

      var actions = el('div', 'ru-actions');
      var useResized = el('button', 'ru-primary', 'Verkleinertes Bild hochladen');
      useResized.type = 'button';
      useResized.disabled = true;
      var useOriginal = el('button', 'ru-secondary', 'Original unverändert hochladen');
      useOriginal.type = 'button';
      var cancel = el('button', 'ru-cancel', 'Abbrechen');
      cancel.type = 'button';
      actions.append(useResized, useOriginal, cancel);
      dialog.appendChild(actions);

      dialog.appendChild(el('p', 'ru-note', 'Hinweis: Alle hochgeladenen Bilder sind auf der Website öffentlich abrufbar. Lade hier nur Web-Vorschauen hoch, nie druckfertige Verkaufsdateien.'));

      overlay.appendChild(dialog);
      document.body.appendChild(overlay);

      function finish(result) {
        document.removeEventListener('keydown', onKey, true);
        overlay.remove();
        URL.revokeObjectURL(originalUrl);
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        resolve(result);
      }

      function onKey(event) {
        if (event.key === 'Escape') {
          event.stopPropagation();
          finish(null);
        }
      }
      document.addEventListener('keydown', onKey, true);

      var timer = null;
      function update() {
        var myToken = ++token;
        useResized.disabled = true;
        afterMeta.textContent = 'Wird berechnet …';
        var edge = parseInt(edgeSelect.value, 10);
        var format = formatSelect.value;
        var quality = parseInt(qualityInput.value, 10);
        qualityLabel.firstChild.textContent = 'Qualität: ' + quality;
        render(bitmap, edge, format, quality).then(function (res) {
          if (myToken !== token || !res.blob) return;
          latest = res;
          if (currentUrl) URL.revokeObjectURL(currentUrl);
          currentUrl = URL.createObjectURL(res.blob);
          afterImg.src = currentUrl;
          var change = Math.round((1 - res.blob.size / file.size) * 100);
          afterMeta.textContent = res.width + ' × ' + res.height + ' px · ' + formatBytes(res.blob.size) +
            (change > 0 ? ' (' + change + ' % kleiner)' : ' (nicht kleiner als das Original)');
          hint.hidden = res.blob.size < file.size;
          hint.textContent = 'Das Original ist bereits klein oder stark komprimiert. Hier ist es meist sinnvoller, das Original hochzuladen oder die Qualität zu senken.';
          useResized.disabled = false;
        });
      }

      function schedule() {
        clearTimeout(timer);
        timer = setTimeout(update, 150);
      }
      edgeSelect.addEventListener('change', schedule);
      formatSelect.addEventListener('change', schedule);
      qualityInput.addEventListener('input', schedule);

      useResized.addEventListener('click', function () {
        if (!latest || !latest.blob) return;
        var base = file.name.replace(/\.[^.]+$/, '');
        var ext = latest.mime === 'image/jpeg' ? 'jpg' : 'webp';
        finish(new File([latest.blob], base + '.' + ext, { type: latest.mime, lastModified: Date.now() }));
      });
      useOriginal.addEventListener('click', function () { finish(file); });
      cancel.addEventListener('click', function () { finish(null); });

      update();
      useResized.focus();
    });
  }

  async function check(file) {
    if (!isHandled(file)) return file;
    var bitmap = await loadBitmap(file);
    if (!bitmap) return file;
    var tooBig = Math.max(bitmap.width, bitmap.height) > TRIGGER_EDGE || file.size > TRIGGER_BYTES;
    if (!tooBig) return file;
    return ask(file, bitmap);
  }

  async function processFiles(files) {
    var result = [];
    for (var i = 0; i < files.length; i++) {
      var out = await check(files[i]);
      if (out) result.push(out);
    }
    return result;
  }

  function deliver(input, files) {
    if (!files.length) {
      input.value = '';
      return;
    }
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
    input.dataset.resizeChecked = '1';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findFileInput(target) {
    var node = target instanceof Element ? target : null;
    while (node && node !== document.documentElement) {
      var input = node.querySelector && node.querySelector('input[type="file"]');
      if (input) return input;
      node = node.parentElement;
    }
    return null;
  }

  document.addEventListener('change', function (event) {
    var input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'file') return;
    if (input.dataset.resizeChecked === '1') {
      delete input.dataset.resizeChecked;
      return;
    }
    var files = Array.prototype.slice.call(input.files || []);
    if (!files.some(isHandled)) return;
    event.stopImmediatePropagation();
    if (busy) {
      input.value = '';
      return;
    }
    busy = true;
    processFiles(files).then(function (result) {
      busy = false;
      deliver(input, result);
    }, function () {
      busy = false;
      deliver(input, files);
    });
  }, true);

  document.addEventListener('drop', function (event) {
    var dt = event.dataTransfer;
    if (!dt || !dt.files || !dt.files.length) return;
    var files = Array.prototype.slice.call(dt.files);
    if (!files.some(isHandled)) return;
    var input = findFileInput(event.target);
    if (!input) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;
    busy = true;
    processFiles(files).then(function (result) {
      busy = false;
      deliver(input, result);
    }, function () {
      busy = false;
      deliver(input, files);
    });
  }, true);
})();
