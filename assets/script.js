(function () {
  'use strict';

  let DATA = null;
  let charts = { apk: null, images: null, js: null };

  // ----- helpers -----
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }

  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function fmtBytes(b) {
    if (b === 0) return '0 B';
    const abs = Math.abs(b);
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), units.length - 1);
    return (abs / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function fmtPct(v) {
    return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  }

  function parseVariantId(id) {
    const parts = id.split('-');
    if (parts[0] === 'snapshot') {
      return { profile: 'Generic', branch: 'snapshot', tool: parts[1] || '?', };
    }
    return { profile: 'Default', branch: '25.12', tool: parts[0] || '?', };
  }

  // ----- sort and label helpers -----
  function sortByDiff(labels, aVals, bVals) {
    const idx = labels.map((_, i) => i);
    idx.sort((i, j) => Math.abs(bVals[j] - aVals[j]) - Math.abs(bVals[i] - aVals[i]));
    return {
      labels: idx.map(i => labels[i]),
      aVals: idx.map(i => aVals[i]),
      bVals: idx.map(i => bVals[i]),
    };
  }

  function annotateLabels(labels, aVals, bVals) {
    return labels.map((l, i) => {
      if (aVals[i] === bVals[i]) return l + '  =';
      const diff = bVals[i] - aVals[i];
      return l + '  ' + (diff >= 0 ? '+' : '-') + fmtBytes(Math.abs(diff));
    });
  }
  function loadData() {
    return fetch('data/data.json')
      .then(r => r.json())
      .then(d => { DATA = d; return d; });
  }

  // ----- variant selectors -----
  function populateSelects() {
    const ids = Object.keys(DATA.variants).sort();
    const selA = $('#variant-a');
    const selB = $('#variant-b');
    const srcSelA = $('#src-variant-a');
    const srcSelB = $('#src-variant-b');

    const fragA = document.createDocumentFragment();
    const fragB = document.createDocumentFragment();
    const fragSA = document.createDocumentFragment();
    const fragSB = document.createDocumentFragment();

    ids.forEach((id, i) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = id;
      fragA.appendChild(o.cloneNode(true));
      fragB.appendChild(o.cloneNode(true));
      fragSA.appendChild(o.cloneNode(true));
      fragSB.appendChild(o.cloneNode(true));
    });

    selA.appendChild(fragA);
    selB.appendChild(fragB);
    srcSelA.appendChild(fragSA);
    srcSelB.appendChild(fragSB);

    selA.value = 'jsmin';
    selB.value = 'esbuild';
    srcSelA.value = 'jsmin';
    srcSelB.value = 'esbuild';

    selA.addEventListener('change', render);
    selB.addEventListener('change', render);
  }

  // ----- summary cards -----
  function renderSummary() {
    const a = DATA.variants[$('#variant-a').value];
    const b = DATA.variants[$('#variant-b').value];
    const container = $('#summary-cards');
    const delta = $('#delta-mode').checked;

    const categories = [
      { label: 'APK Packages', key: 'packages', fmt: v => fmtBytes(v.total_size_bytes) },
      { label: 'Disk Images', key: 'images', fmt: v => fmtBytes(v.total_size_bytes) },
      { label: 'Installed JS', key: 'installed_js', fmt: v => fmtBytes(v.total_size_bytes) + ' (' + v.file_count + ' files)' },
    ];

    container.innerHTML = '';
    categories.forEach(cat => {
      const va = a[cat.key];
      const vb = b[cat.key];
      const av = va.total_size_bytes;
      const bv = vb.total_size_bytes;
      const diff = bv - av;
      const pct = av ? (diff / av) * 100 : 0;

      const art = document.createElement('article');
      art.innerHTML =
        '<header>' + cat.label + '</header>' +
        '<div class="value">' + cat.fmt(va) + '</div>' +
        (delta ? '<div class="delta" style="color:' + (diff > 0 ? 'var(--negative)' : diff < 0 ? 'var(--positive)' : 'var(--muted)') + '">' +
          'Δ ' + (diff >= 0 ? '+' : '-') + fmtBytes(diff) + ' (' + fmtPct(pct) + ')' +
          '</div>' : '') +
        '<small style="color:var(--muted)">' + $('#variant-a').value + ': ' + cat.fmt(va) + '<br>' +
        $('#variant-b').value + ': ' + cat.fmt(vb) + '</small>';
      container.appendChild(art);
    });
  }

  const COLORS = {
    a: 'rgba(54, 162, 235, 0.7)',
    aBorder: 'rgba(54, 162, 235, 1)',
    b: 'rgba(255, 159, 64, 0.7)',
    bBorder: 'rgba(255, 159, 64, 1)',
    pos: 'rgba(220, 53, 69, 0.7)',
    posBorder: 'rgba(220, 53, 69, 1)',
    neg: 'rgba(40, 167, 69, 0.7)',
    negBorder: 'rgba(40, 167, 69, 1)',
    equal: 'rgba(108, 117, 125, 0.4)',
    equalBorder: 'rgba(108, 117, 125, 0.7)',
  };

  function renderChart(canvasId, labels, aVals, bVals, aLabel, bLabel, unit, isDelta) {
    const canvas = $('#' + canvasId);
    const existing = charts[canvasId.replace('chart-', '')];
    if (existing) existing.destroy();

    if (!labels.length) {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');

    let datasets;
    if (isDelta) {
      const diffs = labels.map((_, i) => bVals[i] - aVals[i]);
      const pcts = labels.map((_, i) => aVals[i] ? (diffs[i] / aVals[i]) * 100 : 0);
      const colors = labels.map((_, i) => {
        if (aVals[i] === bVals[i]) return COLORS.equal;
        return diffs[i] >= 0 ? COLORS.pos : COLORS.neg;
      });
      const borders = labels.map((_, i) => {
        if (aVals[i] === bVals[i]) return COLORS.equalBorder;
        return diffs[i] >= 0 ? COLORS.posBorder : COLORS.negBorder;
      });

      datasets = [{
        label: 'Δ ' + aLabel + ' vs ' + bLabel + ' (%)',
        data: pcts,
        backgroundColor: colors,
        borderColor: borders,
        borderWidth: 1,
      }];
    } else {
      const aColors = labels.map((_, i) => aVals[i] === bVals[i] ? COLORS.equal : COLORS.a);
      const bColors = labels.map((_, i) => aVals[i] === bVals[i] ? COLORS.equal : COLORS.b);

      datasets = [
        {
          label: aLabel,
          data: aVals,
          backgroundColor: aColors,
          borderColor: aColors.map(c => c.replace('0.4', '0.7').replace('0.7', '1')),
          borderWidth: 1,
        },
        {
          label: bLabel,
          data: bVals,
          backgroundColor: bColors,
          borderColor: bColors.map(c => c.replace('0.4', '0.7').replace('0.7', '1')),
          borderWidth: 1,
        },
      ];
    }

    const isDeltaBool = isDelta;
    charts[canvasId.replace('chart-', '')] = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: !isDeltaBool },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const i = ctx.dataIndex;
                if (aVals[i] === bVals[i]) {
                  return '= ' + fmtBytes(aVals[i]) + ' (no change)';
                }
                if (isDeltaBool) {
                  const diff = bVals[i] - aVals[i];
                  return ctx.parsed.x.toFixed(1) + '%  (' + (diff >= 0 ? '+' : '-') + fmtBytes(diff) + ')';
                }
                return fmtBytes(ctx.parsed.x);
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              callback: function (v) {
                if (isDeltaBool) return v.toFixed(1) + '%';
                return fmtBytes(v);
              }
            }
          },
          y: {
            ticks: { autoSkip: false, font: { size: 10 } }
          }
        }
      }
    });
  }

  function renderCharts() {
    const a = DATA.variants[$('#variant-a').value];
    const b = DATA.variants[$('#variant-b').value];
    const delta = $('#delta-mode').checked;
    const aLabel = $('#variant-a').value;
    const bLabel = $('#variant-b').value;

    // APK packages
    const apkNames = [...new Set([...a.packages.list, ...b.packages.list].map(p => p.name))].sort();
    let apkA = apkNames.map(n => { const p = a.packages.list.find(x => x.name === n); return p ? p.size_bytes : 0; });
    let apkB = apkNames.map(n => { const p = b.packages.list.find(x => x.name === n); return p ? p.size_bytes : 0; });
    const apkSorted = sortByDiff(apkNames, apkA, apkB);
    const apkLabels = annotateLabels(apkSorted.labels, apkSorted.aVals, apkSorted.bVals);
    renderChart('chart-apk', apkLabels, apkSorted.aVals, apkSorted.bVals, aLabel, bLabel, 'bytes', delta);

    // Images
    const imgNames = [...new Set([...Object.keys(a.images.list), ...Object.keys(b.images.list)])].sort();
    let imgA = imgNames.map(n => a.images.list[n] || 0);
    let imgB = imgNames.map(n => b.images.list[n] || 0);
    const imgSorted = sortByDiff(imgNames, imgA, imgB);
    const imgLabels = annotateLabels(imgSorted.labels, imgSorted.aVals, imgSorted.bVals);
    renderChart('chart-images', imgLabels, imgSorted.aVals, imgSorted.bVals, aLabel, bLabel, 'bytes', delta);

    // Installed JS (top 30 by diff)
    const jsAll = [...new Set([...a.installed_js.files, ...b.installed_js.files].map(f => f.path))];
    let jsTop = jsAll.map(p => {
      const fa = a.installed_js.files.find(f => f.path === p);
      const fb = b.installed_js.files.find(f => f.path === p);
      return { path: p, a: fa ? fa.size_bytes : 0, b: fb ? fb.size_bytes : 0 };
    });
    jsTop.sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a));
    jsTop = jsTop.slice(0, 30);
    const jsNames = jsTop.map(x => x.path.replace(/^\.\//, ''));
    const jsA = jsTop.map(x => x.a);
    const jsB = jsTop.map(x => x.b);
    const jsLabels = annotateLabels(jsNames, jsA, jsB);
    renderChart('chart-js', jsLabels, jsA, jsB, aLabel, bLabel, 'bytes', delta);

    // Update footers
    $$('.chart-footer').forEach(el => el.textContent = '');
    const chartFooters = $$('.chart-footer');
    if (chartFooters[0]) chartFooters[0].textContent = 'Total APK: ' + fmtBytes(a.packages.total_size_bytes) + ' / ' + fmtBytes(b.packages.total_size_bytes);
    if (chartFooters[1]) chartFooters[1].textContent = 'Total Images: ' + fmtBytes(a.images.total_size_bytes) + ' / ' + fmtBytes(b.images.total_size_bytes);
    if (chartFooters[2]) chartFooters[2].textContent = 'Total JS: ' + fmtBytes(a.installed_js.total_size_bytes) + ' / ' + fmtBytes(b.installed_js.total_size_bytes);
  }

  // ----- source viewer -----
  function populateSourceFiles() {
    const sel = $('#src-file');
    const a = DATA.variants[Object.keys(DATA.variants)[0]];
    const files = a.installed_js.files
      .filter(f => f.content)
      .sort((x, y) => y.size_bytes - x.size_bytes);

    const frag = document.createDocumentFragment();
    files.forEach(f => {
      const o = document.createElement('option');
      o.value = f.path;
      o.textContent = f.path.replace(/^\.\//, '') + ' (' + fmtBytes(f.size_bytes) + ')';
      frag.appendChild(o);
    });
    sel.appendChild(frag);
    if (files.length) sel.value = files[0].path;

    sel.addEventListener('change', renderSource);
    $('#src-variant-a').addEventListener('change', renderSource);
    $('#src-variant-b').addEventListener('change', renderSource);
  }

  function renderSource() {
    const filePath = $('#src-file').value;
    const vA = $('#src-variant-a').value;
    const vB = $('#src-variant-b').value;

    if (!filePath) {
      $('#source-viewer').style.display = 'none';
      return;
    }

    const aData = DATA.variants[vA].installed_js.files.find(f => f.path === filePath);
    const bData = DATA.variants[vB].installed_js.files.find(f => f.path === filePath);

    if (!aData || !bData) {
      $('#source-viewer').style.display = 'none';
      return;
    }

    $('#source-viewer').style.display = 'block';

    const aContent = aData.content || '';
    const bContent = bData.content || '';

    // simple line diff
    const aLines = aContent.split('\n');
    const bLines = bContent.split('\n');
    const maxLines = Math.max(aLines.length, bLines.length);

    let aHtml = '', bHtml = '';
    for (let i = 0; i < maxLines; i++) {
      const lineA = aLines[i] !== undefined ? aLines[i] : '';
      const lineB = bLines[i] !== undefined ? bLines[i] : '';
      const num = (i + 1).toString().padStart(4, ' ');

      if (lineA !== lineB) {
        aHtml += '<div class="line-remove"><span class="ln">' + num + '</span>' + escHtml(lineA) + '</div>';
        bHtml += '<div class="line-add"><span class="ln">' + num + '</span>' + escHtml(lineB) + '</div>';
      } else {
        aHtml += '<div class="line-ctx"><span class="ln">' + num + '</span>' + escHtml(lineA) + '</div>';
        bHtml += '<div class="line-ctx"><span class="ln">' + num + '</span>' + escHtml(lineB) + '</div>';
      }
    }

    $('#src-a-content').innerHTML = aHtml;
    $('#src-b-content').innerHTML = bHtml;

    // sync scroll
    const preA = $('#src-a-content');
    const preB = $('#src-b-content');
    preA.onscroll = function () { preB.scrollTop = preA.scrollTop; preB.scrollLeft = preA.scrollLeft; };
    preB.onscroll = function () { preA.scrollTop = preB.scrollTop; preA.scrollLeft = preB.scrollLeft; };
  }

  function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ----- raw data table -----
  function renderRawData() {
    const container = $('#raw-table');
    container.innerHTML = '';

    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    // header: variant names as columns
    const variantIds = Object.keys(DATA.variants).sort();
    let headerRow = '<tr><th>Metric</th>';
    variantIds.forEach(id => { headerRow += '<th>' + id + '</th>'; });
    headerRow += '</tr>';
    thead.innerHTML = headerRow;

    // rows: package totals, image totals, JS totals, then per-package
    const rows = [];

    // Summary rows
    rows.push({ metric: 'APK Total Size (bytes)', values: variantIds.map(id => DATA.variants[id].packages.total_size_bytes) });
    rows.push({ metric: 'APK Package Count', values: variantIds.map(id => DATA.variants[id].packages.count) });
    rows.push({ metric: 'Image Total Size (bytes)', values: variantIds.map(id => DATA.variants[id].images.total_size_bytes) });
    rows.push({ metric: 'Image File Count', values: variantIds.map(id => DATA.variants[id].images.count) });
    rows.push({ metric: 'Installed JS Total (bytes)', values: variantIds.map(id => DATA.variants[id].installed_js.total_size_bytes) });
    rows.push({ metric: 'Installed JS File Count', values: variantIds.map(id => DATA.variants[id].installed_js.file_count) });

    // Separator for per-package
    // Per-package: collect all unique package names
    const allPkgs = [...new Set(variantIds.flatMap(id => DATA.variants[id].packages.list.map(p => p.name)))].sort();
    allPkgs.forEach(pkgName => {
      rows.push({
        metric: '  pkg: ' + pkgName,
        values: variantIds.map(id => {
          const p = DATA.variants[id].packages.list.find(x => x.name === pkgName);
          return p ? p.size_bytes : 0;
        })
      });
    });

    // Per-image
    const allImgs = [...new Set(variantIds.flatMap(id => Object.keys(DATA.variants[id].images.list)))].sort();
    allImgs.forEach(imgName => {
      rows.push({
        metric: '  img: ' + imgName,
        values: variantIds.map(id => DATA.variants[id].images.list[imgName] || 0)
      });
    });

    // Per-JS file (top 30)
    const allJsPaths = [...new Set(variantIds.flatMap(id => DATA.variants[id].installed_js.files.map(f => f.path)))];
    const jsTop = allJsPaths.map(p => {
      const maxSize = Math.max(...variantIds.map(id => {
        const f = DATA.variants[id].installed_js.files.find(x => x.path === p);
        return f ? f.size_bytes : 0;
      }));
      return { path: p, maxSize };
    }).sort((x, y) => y.maxSize - x.maxSize).slice(0, 30);

    jsTop.forEach(jsPath => {
      rows.push({
        metric: '  js: ' + jsPath.path.replace(/^\.\//, ''),
        values: variantIds.map(id => {
          const f = DATA.variants[id].installed_js.files.find(x => x.path === jsPath.path);
          return f ? f.size_bytes : 0;
        })
      });
    });

    rows.forEach(r => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + r.metric + '</td>' + r.values.map(v => '<td>' + v.toLocaleString() + '</td>').join('');
      tbody.appendChild(tr);
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);
  }

  // ----- export -----
  function setupExport() {
    $('#export-csv').addEventListener('click', function (e) {
      e.preventDefault();
      const variantIds = Object.keys(DATA.variants).sort();
      let csv = 'Metric,' + variantIds.join(',') + '\n';

      const rows = [].slice.call($('#raw-table').querySelectorAll('tbody tr'));
      rows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        const vals = Array.from(cells).map(c => c.textContent.trim());
        csv += vals.join(',') + '\n';
      });

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'luci-build-stats.csv';
      a.click();
      URL.revokeObjectURL(url);
    });

    $('#export-json').addEventListener('click', function (e) {
      e.preventDefault();
      const blob = new Blob([JSON.stringify(DATA, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'luci-build-stats.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ----- main render -----
  function render() {
    renderSummary();
    renderCharts();
    renderSource();
  }

  // ----- init -----
  loadData().then(function () {
    $('#generated').textContent = DATA.generated;
    populateSelects();
    populateSourceFiles();
    render();
    renderRawData();
    setupExport();
    $('#delta-mode').addEventListener('change', render);
  }).catch(function (err) {
    document.body.innerHTML = '<main class="container"><article style="margin-top:2rem"><h2>Failed to load data</h2><p>' + err.message + '</p></article></main>';
  });

})();
