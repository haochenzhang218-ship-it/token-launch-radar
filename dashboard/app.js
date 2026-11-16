// Token Radar dashboard: renders the board from window.RADAR (written by main.ts as data.js).
// No fetch, no network: everything the page needs is already in the script it loaded.
// URL parameters make views shareable and screenshots deterministic:
//   ?tab=live|model  ?category=<name>  ?chain=<name>  ?scope=watchlist|early|all
//   ?sort=rank|tvl|growth|age|name  ?protocol=<slug> (opens that protocol's detail view)
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.getElementById('meta').textContent = 'No data loaded.'; return; }

  var params = new URLSearchParams(location.search);
  var rows = R.rows;
  // Which rows are on the watchlist: the data carries the slug list.
  var watchSet = new Set();
  (R.watchlist || []).forEach(function (s) { watchSet.add(s); });
  rows.forEach(function (r) { r.isWatch = watchSet.has(r.slug); });

  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function moneyFull(n) {
    if (n == null) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function growth(g) {
    if (g == null) return '<span class="flat">—</span>';
    var cls = g > 0.05 ? 'up' : g < -0.05 ? 'down' : 'flat';
    var sign = g > 0 ? '+' : '';
    return '<span class="' + cls + '">' + sign + g.toFixed(2) + '%</span>';
  }
  function age(a) {
    if (a == null) return '—';
    if (a >= 365) return (a / 365).toFixed(1) + 'y';
    return a + 'd';
  }
  function chainCell(chains) {
    var list = chains || [];
    if (list.length === 0) return '—';
    if (list.length === 1) return list[0];
    return list[0] + ' +' + (list.length - 1);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---- header ----
  var top = rows[0];
  document.getElementById('meta').innerHTML =
    'Snapshot <b>' + esc(R.as_of) + '</b> · <b>' + R.board_size + '</b> ranked · ' +
    '<b>' + R.watchlist_size + '</b> watchlist · <b>' + R.early_size + '</b> early finds · ' +
    'Top implied value <b>' + moneyFull(top ? top.implied_value_usd : 0) + '</b>';
  document.getElementById('foot-asof').textContent = R.as_of;
  document.getElementById('foot-src').textContent = R.source;

  // ---- filters ----
  var qEl = document.getElementById('q');
  var catEl = document.getElementById('f-category');
  var chainEl = document.getElementById('f-chain');
  var scopeEl = document.getElementById('f-scope');
  var sortEl = document.getElementById('f-sort');

  var cats = {};
  var chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    (r.chains || []).forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; chainEl.appendChild(o);
  });

  var state = {
    q: params.get('q') || '',
    category: params.get('category') || '',
    chain: params.get('chain') || '',
    scope: params.get('scope') || 'all',
    sort: params.get('sort') || 'rank',
  };
  qEl.value = state.q; catEl.value = state.category; chainEl.value = state.chain;
  scopeEl.value = state.scope; sortEl.value = state.sort;

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.isWatch) return false;
      if (state.scope === 'early' && r.isWatch) return false;
      if (state.category && r.category !== state.category) return false;
      if (state.chain && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
      growth: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d) || a.rank - b.rank; },
      age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days) || a.rank - b.rank; },
      name: function (a, b) { return a.name.localeCompare(b.name); },
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    return list.slice().sort(by);
  }

  var tbody = document.getElementById('rows');
  var selected = null;

  function render() {
    var list = filtered();
    document.getElementById('count').innerHTML =
      'Showing <b>' + list.length + '</b> of ' + rows.length + ' ranked protocols' +
      (state.scope === 'watchlist' ? ' · watchlist only' : state.scope === 'early' ? ' · early finds only' : '');
    var html = '';
    list.forEach(function (r) {
      html += '<tr data-slug="' + esc(r.slug) + '"' + (selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><span class="slug">' + esc(r.slug) + '</span>' +
        (r.isWatch ? '<span class="tag watch">WATCHLIST</span>' : '<span class="tag early">EARLY</span>') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(chainCell(r.chains)) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + growth(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td></tr>';
    });
    tbody.innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
  }

  // ---- detail view (slide-over panel) ----
  var detail = document.getElementById('detail');
  function closeDetail() {
    selected = null;
    detail.classList.remove('open');
    render();
  }
  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    selected = slug;
    if (!r) { detail.innerHTML = '<p class="detail-empty">Protocol not found.</p>'; detail.classList.add('open'); render(); return; }
    var steps = (r.farm_steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    detail.innerHTML =
      '<button class="detail-close" id="detail-close" type="button">Close</button>' +
      '<h2>#' + r.rank + ' · ' + esc(r.name) + '</h2>' +
      '<p class="dsub">' + esc(r.slug) + ' · ' + esc(r.category || 'uncategorised') + ' · ' +
      esc((r.chains || []).join(', ') || '—') + ' · ' + (r.isWatch ? 'on the watchlist' : 'early find below the watchlist floor') + '</p>' +
      '<div class="dstats">' +
      '<div class="dstat"><div class="k">Implied value</div><div class="v">' + moneyFull(r.implied_value_usd) + '</div></div>' +
      '<div class="dstat"><div class="k">TVL</div><div class="v">' + moneyFull(r.tvl_usd) + '</div></div>' +
      '<div class="dstat"><div class="k">7-day change</div><div class="v">' + (r.change_7d == null ? '—' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</div></div>' +
      '<div class="dstat"><div class="k">Age with no token</div><div class="v">' + age(r.age_days) + '</div></div>' +
      '</div>' +
      '<table class="dmult"><thead><tr><th>Multiplier</th><th>Value</th></tr></thead><tbody>' +
      '<tr><td>Base (TVL × 0.20)</td><td>' + money(r.tvl_usd * 0.2) + '</td></tr>' +
      '<tr><td>Momentum (7d growth)</td><td>× ' + r.momentum.toFixed(4) + '</td></tr>' +
      '<tr><td>Seasoning (age)</td><td>× ' + r.seasoning.toFixed(4) + '</td></tr>' +
      '<tr><td>Breadth (' + (r.chains || []).length + ' chain' + ((r.chains || []).length === 1 ? '' : 's') + ')</td><td>× ' + r.breadth.toFixed(4) + '</td></tr>' +
      '<tr><td>Category factor</td><td>× ' + r.category_factor.toFixed(2) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="dsub">Records no token — no market cap, no CoinGecko id, no symbol in the snapshot. ' +
      'That is what the record says, not proof it has none.</p>' +
      '<h3>Farm plan · 7 steps</h3><ol class="steps">' + steps + '</ol>';
    detail.classList.add('open');
    document.getElementById('detail-close').addEventListener('click', closeDetail);
    render();
  }

  tbody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'));
  });

  // ---- sorting from headers and controls ----
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      state.sort = th.getAttribute('data-sort');
      sortEl.value = state.sort;
      render();
    });
  });
  qEl.addEventListener('input', function () { state.q = qEl.value; render(); });
  catEl.addEventListener('change', function () { state.category = catEl.value; render(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; render(); });
  scopeEl.addEventListener('change', function () { state.scope = scopeEl.value; render(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; render(); });

  // ---- tabs ----
  var tabs = document.querySelectorAll('.tab');
  function showTab(name) {
    tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
    document.getElementById('view-board').classList.toggle('hidden', name !== 'board');
    document.getElementById('view-live').classList.toggle('hidden', name !== 'live');
    document.getElementById('view-model').classList.toggle('hidden', name !== 'model');
  }
  tabs.forEach(function (t) {
    t.addEventListener('click', function () { showTab(t.getAttribute('data-tab')); });
  });

  // ---- live view ----
  var liveHtml = '';
  (R.live || []).forEach(function (p) {
    liveHtml += '<tr><td><span class="name">' + esc(p.name) + '</span><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td>' + esc((p.chains || []).slice(0, 3).join(', ') || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num val">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + growth(p.change_7d) + '</td></tr>';
  });
  document.getElementById('live-rows').innerHTML = liveHtml;

  // ---- initial state from the URL ----
  var tab = params.get('tab');
  if (tab === 'live' || tab === 'model') showTab(tab);
  render();
  var proto = params.get('protocol');
  if (proto) showDetail(proto);
})();
