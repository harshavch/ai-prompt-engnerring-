(function () {
'use strict';

/* ============ helpers ============ */
const KEY = 'stocksure_v1';
const $ = (s, e = document) => e.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => Math.round(n).toLocaleString('en-IN');
const inr = n => '₹' + fmt(n);
const lk = n => (n < 0 ? '−' : '') + '₹' + (Math.abs(n) / 1e5).toFixed(2) + 'L';
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const chg = (a, b) => (b - a) / a * 100;
const sgn = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(0) + '%';

const THRESH = 0.8; // below this, an item is pre-checked with the store before payment
const DEFAULT_IMPACT = { resU: 50, resR: 25, supp: 35, rep: 4, promo: 20, keep: 30, one: 22, run: 1.5 };
const PRESETS = {
  conservative: { resU: 30, resR: 10, supp: 20, rep: 2, promo: 10, keep: 15 },
  base:         { resU: 50, resR: 25, supp: 35, rep: 4, promo: 20, keep: 30 },
  optimistic:   { resU: 70, resR: 40, supp: 50, rep: 6, promo: 30, keep: 45 }
};

/* ============ state ============ */
function fresh() {
  return {
    v: 1, tab: 'diagnosis', mode: 'on', q: '', sf: 'all', storeView: 'lk', hours: 0, nextId: 1,
    items: SEED_ITEMS.map(i => ({ ...i })), cart: [], order: null, reqs: [], unmet: {},
    stats: { orders: 0, failedPaid: 0, prevented: 0, checks: 0 }, impact: { ...DEFAULT_IMPACT }
  };
}
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.v === 1 && s.items) return s; } catch (e) { /* ignore */ }
  return fresh();
}
let S = load();
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* ignore */ } }

/* ============ model ============ */
const item = id => S.items.find(i => i.id === id);
const storeOf = id => STORES.find(s => s.id === id);
// P(item still in stock) = exp(-volatility * hoursSinceConfirmed / 24). Unlisted items are 0.
const conf = i => (i.listed ? clamp(Math.exp(-i.vol * i.h / 24), 0.02, 0.99) : 0);
const band = c => (c >= 0.8 ? ['ok', 'In stock'] : c >= 0.5 ? ['mid', 'Likely'] : ['low', 'Uncertain']);
const badge = i => {
  if (!i.listed) return '<span class="badge out">Out of stock</span>';
  const c = conf(i), b = band(c);
  return `<span class="badge ${b[0]}">${b[1]} · ${Math.round(c * 100)}%</span>`;
};
const ago = h => (h < 1 ? 'just now' : h >= 48 ? Math.round(h / 24) + 'd ago' : Math.round(h) + 'h ago');

function queue(sid) {
  const rows = S.items.filter(i => i.store === sid && i.listed).map(i => ({ i, score: (1 - conf(i)) * i.pop }));
  const total = rows.reduce((a, r) => a + r.score, 0);
  const top = rows.filter(r => conf(r.i) < THRESH).sort((a, b) => b.score - a.score).slice(0, 5);
  const cov = total ? top.reduce((a, r) => a + r.score, 0) / total : 1;
  return { top, cov, n: rows.length };
}
function subs(it) {
  return S.items.filter(x => x.group === it.group && x.id !== it.id && x.listed && conf(x) >= THRESH).sort((a, b) => conf(b) - conf(a));
}
function advance(H) {
  S.hours += H;
  S.items.forEach(it => {
    const st = storeOf(it.store);
    it.h += H;
    if (it.listed && it.actual && Math.random() < 1 - Math.exp(-it.vol * H / 24)) it.actual = false; // sells out silently
    if (it.h >= st.cadence) { it.h = 0; it.listed = it.actual; }                                    // store's own routine update
  });
}

/* ============ order logic ============ */
const cartTotal = () => S.cart.reduce((a, l) => a + item(l.itemId).price * l.qty, 0);

function addToCart(id) {
  const l = S.cart.find(x => x.itemId === id);
  if (l) l.qty++; else S.cart.push({ itemId: id, qty: 1 });
}
function checkout() {
  if (!S.cart.length) return;
  const lines = S.cart.map(l => ({ itemId: l.itemId, qty: l.qty, status: 'ok', reqId: null, wasOut: false, from: null }));
  if (S.mode === 'off') {
    // Today: no check. Reality decides after payment.
    const failed = lines.filter(l => !item(l.itemId).actual);
    S.stats.orders++; S.stats.failedPaid += failed.length;
    S.order = {
      phase: 'done', mode: 'off', ref: 'NC' + (1000 + S.stats.orders * 7),
      ok: lines.filter(l => item(l.itemId).actual), failed,
      refund: failed.reduce((a, l) => a + item(l.itemId).price * l.qty, 0)
    };
  } else {
    lines.forEach(l => {
      const it = item(l.itemId);
      if (conf(it) < THRESH) {
        const r = { id: S.nextId++, itemId: it.id, store: it.store, qty: l.qty, status: 'pending' };
        S.reqs.push(r); l.status = 'pending'; l.reqId = r.id; S.stats.checks++;
      }
    });
    S.order = { phase: 'review', mode: 'on', lines };
  }
  S.cart = [];
}
function resolveReq(id, yes) {
  const r = S.reqs.find(x => x.id === id);
  if (!r || r.status !== 'pending') return;
  const it = item(r.itemId);
  r.status = yes ? 'yes' : 'no';
  if (yes) { it.actual = true; it.listed = true; it.h = 0; } else { it.actual = false; it.listed = false; }
  if (S.order && S.order.lines) {
    S.order.lines.forEach(l => { if (l.reqId === id) { l.status = yes ? 'ok' : 'out'; if (!yes) l.wasOut = true; } });
  }
}
function pay() {
  const o = S.order; if (!o || o.phase !== 'review') return;
  if (o.lines.some(l => l.status === 'pending' || l.status === 'out')) return;
  const ok = o.lines.filter(l => l.status === 'ok');
  if (!ok.length) { cancelOrder(); return; }
  const prevented = o.lines.filter(l => l.wasOut).length;
  S.stats.orders++; S.stats.prevented += prevented;
  S.order = {
    phase: 'done', mode: 'on', ref: 'NC' + (1000 + S.stats.orders * 7),
    ok, prevented, swapped: ok.filter(l => l.from).length, removed: o.lines.filter(l => l.status === 'removed').length,
    total: ok.reduce((a, l) => a + item(l.itemId).price * l.qty, 0)
  };
}
function cancelOrder() {
  if (S.order && S.order.lines) S.reqs = S.reqs.filter(r => !(r.status === 'pending' && S.order.lines.some(l => l.reqId === r.id)));
  S.order = null;
}
function notify(name) { S.unmet[name] = (S.unmet[name] || 0) + 1; }

/* ============ impact model ============ */
function impact(p) {
  const N = CASE.now, orders = N.orders, canc = orders * N.cancel / 100;
  const revPer = N.revenue * 1e5 / orders;                 // net revenue per order (derived from brief)
  const unavail = canc * 0.35, reject = canc * 0.18;
  const rec = unavail * p.resU / 100 + reject * p.resR / 100;
  const tick = (0.29 + 0.19) * N.tickets * p.supp / 100;   // refund-status + missing-product tickets
  const atRisk = CASE.stores * CASE.storesAtRisk;
  const levers = [
    { name: 'Recovered orders', val: rec * revPer, basis: `${fmt(rec)} orders/mo saved from cancellation × ${inr(revPer)} net revenue/order` },
    { name: 'Support cost avoided', val: tick * ASSUME.costPerTicket, basis: `${fmt(tick)} fewer refund/missing-item tickets × ${inr(ASSUME.costPerTicket)} (assumed cost/ticket)` },
    { name: 'Repeat-rate recovery', val: p.rep / 100 * N.mau * ASSUME.ordersPerRepeatCustomer * revPer, basis: `+${p.rep}pp repeat on ${fmt(N.mau)} MAU × ${ASSUME.ordersPerRepeatCustomer} orders (assumed)` },
    { name: 'Acquisition promo reallocated', val: N.promo * 1e5 * CASE.acquisitionShare * p.promo / 100, basis: `${p.promo}% of the ${Math.round(CASE.acquisitionShare * 100)}% acquisition share of ₹${N.promo}L/mo` },
    { name: 'Partner stores retained', val: atRisk * p.keep / 100 * (N.revenue * 1e5 / CASE.stores), basis: `${(atRisk * p.keep / 100).toFixed(0)} of ${atRisk.toFixed(0)} at-risk stores × ${inr(N.revenue * 1e5 / CASE.stores)} revenue/store/mo` }
  ];
  const benefit = levers.reduce((a, l) => a + l.val, 0);
  const run = p.run * 1e5, one = p.one * 1e5, net = benefit - run;
  const cum = []; let c = -one, payback = null;
  for (let m = 1; m <= 12; m++) {
    c += benefit * (m <= 2 ? ASSUME.rampMonths12 : 1) - run; cum.push(c);
    if (payback === null && c >= 0) payback = m;
  }
  return { levers, benefit, run, one, net, cum, payback, recovered: rec, avoided: N.promo * 1e5 * 0.30 };
}

/* ============ views ============ */
const kpi = (l, a, b, d, bad) => `<div class="kpi"><div class="l">${l}</div><div class="v">${a} → ${b}</div><div class="d ${bad ? 'bad' : 'good'}">${d}</div></div>`;
const bar = (label, v, max, cls, txt) => `<div class="row"><div>${label}</div><div class="track"><div class="fill ${cls || ''}" style="width:${clamp(v / max * 100, 0, 100)}%"></div></div><div class="n">${txt}</div></div>`;

function viewDiagnosis() {
  const B = CASE.before, N = CASE.now;
  const ppo0 = B.promo * 1e5 / B.orders, ppo1 = N.promo * 1e5 / N.orders;
  const pr0 = B.promo / B.revenue * 100, pr1 = N.promo / N.revenue * 100;
  const rpp0 = B.revenue / B.promo, rpp1 = N.revenue / N.promo;
  const deltas = [
    ['Registered users', chg(B.registered, N.registered), 'g'], ['Monthly active users', chg(B.mau, N.mau), 'g'],
    ['Monthly orders', chg(B.orders, N.orders), 'g'], ['Revenue', chg(B.revenue, N.revenue), 'g'],
    ['Promotional spend', chg(B.promo, N.promo), 'b'], ['Support tickets', chg(B.tickets, N.tickets), 'b'],
    ['Order cancellations', chg(B.cancel, N.cancel), 'b'], ['Delivery time', chg(B.delivery, N.delivery), 'b'],
    ['Repeat purchase rate', chg(B.repeat, N.repeat), 'b']
  ];
  const claims = [
    ['CEO', 'Improve retention', 'Repeat 41% → 27%; 2nd order within 30 days only 31%.', 'Right goal, but retention is the outcome, not the cause.', '<span class="tag ctx">Outcome</span>'],
    ['Marketing', 'More acquisition and promos', 'Promo +79% vs revenue +20%; discount-acquired users retain worse; 44% of coupons unused.', 'Buying more users into a leaky experience raises cost, not value.', '<span class="tag rej">Not supported</span>'],
    ['Operations', 'Delivery reliability', 'Delivery 29 → 37 min; 13% late by 15+ min; delay = 27% of cancellations.', 'Real, but smaller than inventory failures (53%) and likely partly downstream of them. To be tested.', '<span class="tag mid">Contributing</span>'],
    ['Partner mgr', 'Inventory accuracy and store experience', '53% of cancellations are unavailable/store-rejected; 29% of customers saw items vanish; 39% of stores say upkeep costs too much.', 'The measurable break in the chain. It drives cancellations, refunds, tickets and lost trust.', '<span class="tag p1">Root cause</span>'],
    ['Product', 'Give a reason to choose local', '19% search for items nearby stores lack; 21% prefer buying direct from stores; multi-category buyers repeat more.', 'Right strategy. Local range is only a wedge if what the app shows is true.', '<span class="tag p1">Strategy</span>'],
    ['Finance', 'Quality and cost of growth', 'Promo is 44% → 65% of net revenue; revenue per ₹1 of promo ₹2.29 → ₹1.54.', 'Confirms it. Supports holding the proposed +30% budget until reliability is fixed.', '<span class="tag ctx">Confirms</span>']
  ];
  return `
  <div class="hero">
    <div class="kicker">Diagnosis</div>
    <h1>NOVA CART is growing. It isn't getting better.</h1>
    <p>Growth is being bought with promotions while the product keeps breaking its central promise: <b>"this item is available."</b> That one failure feeds cancellations, refunds, support load, store frustration and lost repeat customers. We call it the <b>availability-promise gap</b>.</p>
  </div>

  <div class="grid4" style="margin-bottom:16px">
    ${kpi('Revenue / month', '₹' + B.revenue + 'L', '₹' + N.revenue + 'L', sgn(chg(B.revenue, N.revenue)), false)}
    ${kpi('Promo spend / month', '₹' + B.promo + 'L', '₹' + N.promo + 'L', sgn(chg(B.promo, N.promo)), true)}
    ${kpi('Repeat purchase rate', B.repeat + '%', N.repeat + '%', (N.repeat - B.repeat) + ' pp', true)}
    ${kpi('Promo as % of net revenue', pr0.toFixed(0) + '%', pr1.toFixed(0) + '%', '+' + (pr1 - pr0).toFixed(0) + ' pp', true)}
    ${kpi('Promo per order', inr(ppo0), inr(ppo1), sgn(chg(ppo0, ppo1)), true)}
    ${kpi('Revenue per ₹1 of promo', '₹' + rpp0.toFixed(2), '₹' + rpp1.toFixed(2), sgn(chg(rpp0, rpp1)), true)}
    ${kpi('Cancellation rate', B.cancel + '%', N.cancel + '%', '+' + (N.cancel - B.cancel) + ' pp', true)}
    ${kpi('Support tickets / month', fmt(B.tickets), fmt(N.tickets), sgn(chg(B.tickets, N.tickets)), true)}
  </div>

  <div class="grid2">
    <div class="card">
      <h2>Growth metrics vs health metrics (6-month change)</h2>
      <div class="bars">${deltas.map(d => bar(d[0], Math.abs(d[1]), 100, d[2], sgn(d[1]))).join('')}</div>
      <p class="note">Teal = growth. Red = cost, failure or lost loyalty. Users +46% but MAU only +18%: the base is growing faster than engagement.</p>
    </div>
    <div class="card">
      <h2>Where orders fail</h2>
      <div class="bars">${CASE.cancelReasons.map(r => bar(r[0], r[1], 40, r[2], r[1] + '%')).join('')}</div>
      <p class="small"><b>53%</b> of the 11% cancellations (≈${fmt(CASE.now.orders * .11 * .53)} orders/month) trace to stock the app said existed.</p>
      <h3 style="margin-top:12px">What those failures turn into (support tickets)</h3>
      <div class="bars">${CASE.tickets.map(r => bar(r[0], r[1], 40, r[2], r[1] + '%')).join('')}</div>
      <p class="note">48% of tickets are refund status or missing items, the aftermath of failed orders. Resolution takes 9.2 hours across separate systems.</p>
    </div>
  </div>

  <div class="card">
    <h2>The broken-promise chain</h2>
    <div class="chain" style="margin-top:16px">
      <div><b>Stale stock</b>Stores update every 1–3 days; 39% say upkeep isn't worth it.</div>
      <div><b>App says "available"</b>29% of customers saw items become unavailable after ordering.</div>
      <div><b>Order is placed</b>Often lured by large first-order discounts.</div>
      <div><b>It fails</b>35% of cancels: unavailable. 18%: store rejects. 8% of orders substituted.</div>
      <div><b>Refund and tickets</b>Refund status = 29% of tickets; 9.2h to resolve.</div>
      <div><b>Customer drifts</b>Only 31% reorder in 30 days. 61% of churners had rated 4★+.</div>
    </div>
    <p class="small" style="margin-top:12px"><b>Silent churn:</b> 61% of customers who stopped had rated NOVA CART 4★ or higher. Ratings don't warn you. Failed promises do. The first three orders decide the relationship: customers who reach 3 orders have a 72% chance of ordering again next month, but only 54% complete a first order and 31% a second.</p>
  </div>

  <div class="card">
    <h2>Six executives, six claims: what the evidence says</h2>
    <div class="tbl"><table>
      <tr><th>Who</th><th>Claim</th><th>Evidence</th><th>Reading</th><th>Verdict</th></tr>
      ${claims.map(c => `<tr><td><b>${c[0]}</b></td><td>${c[1]}</td><td>${c[2]}</td><td>${c[3]}</td><td>${c[4]}</td></tr>`).join('')}
    </table></div>
  </div>

  <div class="card tint">
    <h2>The opportunity: compete on certainty, not speed or discounts</h2>
    <p>Larger rivals win on delivery speed and discounts. NOVA CART's edge is range: independent stores selling things big platforms don't. That edge only works if customers can trust what they see. <b>StockSure</b> turns local stock into a verified promise.</p>
    <div class="grid3">
      <div><h3>Customers</h3><p class="small">See an honest in-stock confidence per item. Risky items are confirmed with the store <i>before</i> payment, with a swap or reroute if they're out.</p></div>
      <div><h3>Partner stores</h3><p class="small">No full-catalogue updates. A short priority list of the few items most likely to be wrong, answered in one tap, plus a demand signal of what customers asked for.</p></div>
      <div><h3>NOVA CART</h3><p class="small">Fewer cancellations, refunds and tickets; better repeat rate; a case for holding promo spend; fewer stores leaving.</p></div>
    </div>
    <div class="row2" style="margin-top:12px">
      <button class="btn" data-a="tab" data-t="customer">Try the customer flow →</button>
      <button class="ghost" data-a="tab" data-t="impact">See the business case</button>
    </div>
  </div>`;
}

/* ---- customer ---- */
function resultsHTML() {
  const q = S.q.trim().toLowerCase();
  let list = S.items.filter(i => (S.sf === 'all' || i.store === S.sf) && i.name.toLowerCase().includes(q));
  if (S.mode === 'on') list = list.slice().sort((a, b) => conf(b) - conf(a));
  if (!list.length) {
    return `<div class="empty">No nearby store lists “${esc(S.q)}”.<br>${q ? `<button class="ghost sm" style="margin-top:8px" data-a="notifyq">Tell me when a nearby store stocks it</button>` : ''}</div>`;
  }
  return list.map(i => {
    const st = storeOf(i.store);
    return `<div class="item">
      <div class="nm"><b>${esc(i.name)}</b><div class="meta">${esc(st.name)}</div></div>
      ${S.mode === 'on' ? badge(i) : (i.listed ? '' : '<span class="badge out">Unavailable</span>')}
      <div class="pr">${inr(i.price)}</div>
      <button class="ghost sm" data-a="add" data-id="${i.id}" ${i.listed ? '' : 'disabled'}>Add</button>
    </div>`;
  }).join('');
}

function cartHTML() {
  const o = S.order;
  if (o && o.phase === 'done') {
    if (o.mode === 'off') {
      return `<div class="card"><h2>Order ${o.ref}</h2>
        <div class="alert ${o.failed.length ? 'bad' : 'info'}">${o.failed.length
          ? `<b>Paid, then it failed.</b> ${o.failed.map(l => esc(item(l.itemId).name)).join(', ')} ${o.failed.length > 1 ? 'were' : 'was'} unavailable at the store.<br>Refund of ${inr(o.refund)} initiated (3–5 working days). Support ticket auto-created (average resolution 9.2h).`
          : 'All items were in stock this time. Today\'s flow gets lucky when stock is fresh.'}</div>
        ${o.ok.map(l => `<div class="line"><div class="t"><span>${l.qty} × ${esc(item(l.itemId).name)}</span><span class="good">Delivered</span></div></div>`).join('')}
        <div class="row2" style="margin-top:12px"><button class="btn" data-a="newOrder">New order</button></div></div>`;
    }
    return `<div class="card"><h2>Order ${o.ref} · ${inr(o.total)}</h2>
      <div class="alert good"><b>0 failures after payment.</b> ${o.prevented ? `${o.prevented} unavailable item${o.prevented > 1 ? 's were' : ' was'} caught before you paid.` : 'Everything was confirmed in stock.'}${o.swapped ? ` ${o.swapped} swapped to another store.` : ''}${o.removed ? ` ${o.removed} removed.` : ''}</div>
      ${o.ok.map(l => `<div class="line"><div class="t"><span>${l.qty} × ${esc(item(l.itemId).name)}</span><span class="good">Confirmed</span></div>
        <div class="st mut">${esc(storeOf(item(l.itemId).store).name)}${l.from ? ' · swapped from ' + esc(l.from) : ''}</div></div>`).join('')}
      <div class="row2" style="margin-top:12px"><button class="btn" data-a="newOrder">New order</button></div></div>`;
  }
  if (o && o.phase === 'review') {
    const pending = o.lines.some(l => l.status === 'pending');
    const out = o.lines.some(l => l.status === 'out');
    const ready = !pending && !out && o.lines.some(l => l.status === 'ok');
    const total = o.lines.filter(l => l.status === 'ok').reduce((a, l) => a + item(l.itemId).price * l.qty, 0);
    return `<div class="card"><h2>Confirming with stores</h2>
      ${o.lines.map((l, idx) => {
        const it = item(l.itemId);
        let st = '', extra = '';
        if (l.status === 'ok') st = `<span class="good">${l.reqId ? '✓ Store confirmed' : '✓ In stock'}</span>`;
        if (l.status === 'pending') st = '<span class="midc">Checking with the store…</span>';
        if (l.status === 'removed') st = '<span class="mut">Removed</span>';
        if (l.status === 'out') {
          st = '<span class="bad">Store says it is out of stock</span>';
          const sb = subs(it);
          extra = `<div class="alts">${sb.map(x => `<button class="ghost sm" data-a="swap" data-li="${idx}" data-id="${x.id}">Swap: ${esc(x.name)} · ${esc(storeOf(x.store).name)} · ${inr(x.price)}</button>`).join('')}
            ${sb.length ? '' : `<button class="ghost sm" data-a="lineNotify" data-li="${idx}">Notify me when back</button>`}
            <button class="ghost sm" data-a="dropline" data-li="${idx}">Remove</button></div>`;
        }
        return `<div class="line"><div class="t"><span>${l.qty} × ${esc(it.name)}${l.from ? ` <span class="mut small">(swapped from ${esc(l.from)})</span>` : ''}</span><span class="mono">${inr(it.price * l.qty)}</span></div><div class="st">${esc(storeOf(it.store).name)} · ${st}</div>${extra}</div>`;
      }).join('')}
      ${pending ? `<div class="alert info">Waiting on the store. Open the <a href="#" data-a="tab" data-t="store">Store console</a> to reply, or <button class="ghost sm" data-a="autoreply">simulate store reply</button></div>` : ''}
      <div class="row2" style="margin-top:12px"><button class="btn" data-a="pay" ${ready ? '' : 'disabled'}>Pay ${inr(total)}</button><button class="ghost" data-a="cancelOrder">Cancel</button></div>
    </div>`;
  }
  // cart
  if (!S.cart.length) return `<div class="card"><h2>Cart</h2><div class="empty">Add items from different stores.<br>Tip: toned milk, eggs and paneer at Sri Lakshmi Kirana are stale; try them in both modes.</div></div>`;
  const risky = S.cart.filter(l => conf(item(l.itemId)) < THRESH).length;
  return `<div class="card"><h2>Cart</h2>
    ${S.cart.map(l => { const it = item(l.itemId); return `<div class="line"><div class="t"><span>${esc(it.name)}</span><span class="mono">${inr(it.price * l.qty)}</span></div>
      <div class="st"><span class="mut">${esc(storeOf(it.store).name)}</span> · <span class="qty"><button data-a="dec" data-id="${it.id}">−</button>${l.qty}<button data-a="inc" data-id="${it.id}">+</button></span> ${S.mode === 'on' ? badge(it) : ''}</div></div>`; }).join('')}
    ${S.mode === 'on' && risky ? `<div class="alert info">${risky} item${risky > 1 ? 's' : ''} below ${THRESH * 100}% confidence. We'll confirm with the store before you pay.</div>` : ''}
    ${S.mode === 'off' ? '<div class="alert info">Today\'s flow: you pay first. Availability is discovered afterwards.</div>' : ''}
    <div class="row2" style="margin-top:8px"><button class="btn" data-a="checkout">${S.mode === 'on' ? 'Check and continue' : 'Pay'} · ${inr(cartTotal())}</button></div></div>`;
}

function viewCustomer() {
  const s = S.stats;
  return `
  <div class="modebar">
    <div class="seg"><button class="${S.mode === 'off' ? 'on' : ''}" data-a="mode" data-m="off">Today (no check)</button><button class="${S.mode === 'on' ? 'on' : ''}" data-a="mode" data-m="on">With StockSure</button></div>
    <div class="stats">
      <div class="stat">Orders<b>${s.orders}</b></div>
      <div class="stat r">Failed after payment<b>${s.failedPaid}</b></div>
      <div class="stat g">Failures prevented<b>${s.prevented}</b></div>
      <div class="stat">Store checks<b>${s.checks}</b></div>
    </div>
  </div>
  <div class="grid2">
    <section class="card">
      <input type="search" id="q" placeholder="Search milk, bread, paracetamol, notebook…" value="${esc(S.q)}" aria-label="Search products">
      <div class="chips"><span class="chip ${S.sf === 'all' ? 'on' : ''}" data-a="sf" data-s="all">All stores</span>${STORES.map(st => `<span class="chip ${S.sf === st.id ? 'on' : ''}" data-a="sf" data-s="${st.id}">${esc(st.name)}</span>`).join('')}</div>
      <div id="results">${resultsHTML()}</div>
    </section>
    <aside id="cartpane">${cartHTML()}</aside>
  </div>
  <details class="card"><summary>How the confidence score works</summary>
    <p style="margin-top:8px">Each item gets <span class="mono">P(in stock) = exp(−volatility × hours since the store last confirmed ÷ 24)</span>. Volatility is expected stock-outs per day (bread ≈ 1.5, milk ≈ 0.9, rice ≈ 0.12, stationery ≈ 0.1). Fast-moving items from stores that update rarely fall quickly. Slow-moving items from the same store stay trustworthy for days.</p>
    <p>Items at or above <b>80%</b> are sold normally. Below that, StockSure asks the store to confirm <i>before</i> payment. If the store says it's out, the customer can swap to a confirmed alternative from another store, or be notified later.</p>
    <p class="note">The decay rates are a transparent heuristic for the prototype. In production they would be fitted from NOVA CART's order and cancellation logs per category and store.</p>
    <p class="note">Try it: add Toned Milk from Sri Lakshmi Kirana, check out in both modes, then use <b>+6h</b> at the top to watch stock decay.</p>
  </details>`;
}

/* ---- store ---- */
function viewStore() {
  const sid = S.storeView, st = storeOf(sid);
  const its = S.items.filter(i => i.store === sid);
  const listed = its.filter(i => i.listed);
  const pend = S.reqs.filter(r => r.store === sid && r.status === 'pending');
  const q = queue(sid);
  const avg = listed.length ? listed.reduce((a, i) => a + conf(i), 0) / listed.length : 1;
  const unmet = Object.entries(S.unmet).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return `
  <div class="modebar">
    <div style="min-width:240px"><select id="storesel" aria-label="Choose store">${STORES.map(s => `<option value="${s.id}" ${s.id === sid ? 'selected' : ''}>${esc(s.name)} · ${s.cat}</option>`).join('')}</select></div>
    <span class="mut small">${esc(st.note)}</span>
    <div class="stats">
      <div class="stat">Items listed<b>${listed.length}/${its.length}</b></div>
      <div class="stat ${avg >= .8 ? 'g' : 'r'}">Avg. confidence<b>${Math.round(avg * 100)}%</b></div>
      <div class="stat ${pend.length ? 'r' : ''}">Customer checks<b>${pend.length}</b></div>
    </div>
  </div>

  <div class="card ${pend.length ? '' : ''}" style="${pend.length ? 'border-color:#fcd34d' : ''}">
    <h2>Customer checks (reply in one tap)</h2>
    ${pend.length ? pend.map(r => `<div class="item"><div class="nm"><b>${r.qty} × ${esc(item(r.itemId).name)}</b><div class="meta">A customer is about to pay. Do you have it right now?</div></div>
      <button class="yes sm" data-a="yes" data-id="${r.id}">Have it</button><button class="no sm" data-a="no" data-id="${r.id}">Out of stock</button></div>`).join('')
      : '<div class="empty">No pending checks. Place an order in the Customer app with StockSure on and a stale item in the cart.</div>'}
  </div>

  <div class="grid2">
    <div class="card">
      <h2>Priority confirm list</h2>
      ${q.top.length ? `<p class="small">Confirm just <b>${q.top.length} of ${q.n}</b> listed items to cover about <b>${Math.round(q.cov * 100)}%</b> of this store's stock-out risk. No full catalogue update needed.</p>
      ${q.top.map(r => `<div class="item"><div class="nm"><b>${esc(r.i.name)}</b><div class="meta">Last confirmed ${ago(r.i.h)}</div></div>${badge(r.i)}
        <button class="yes sm" data-a="confirm" data-id="${r.i.id}">Still have it</button><button class="no sm" data-a="markout" data-id="${r.i.id}">Out</button></div>`).join('')}`
      : '<div class="empty">Nothing risky right now. Confidence is high across your catalogue.</div>'}
    </div>
    <div class="card">
      <h2>Demand signals</h2>
      <p class="small mut">Items customers searched for or wanted back (platform-wide). Useful for deciding what to stock.</p>
      ${unmet.length ? unmet.map(u => `<div class="item"><div class="nm">${esc(u[0])}</div><span class="badge mid">${u[1]} request${u[1] > 1 ? 's' : ''}</span></div>`).join('') : '<div class="empty">No requests yet. Search for something nobody stocks, or tap “Notify me” on an out-of-stock item.</div>'}
    </div>
  </div>

  <div class="card"><h2>Full catalogue</h2><div class="tbl"><table>
    <tr><th>Item</th><th>Last confirmed</th><th style="width:150px">Confidence</th><th>Status</th><th></th></tr>
    ${its.map(i => { const c = conf(i), b = band(c); return `<tr><td>${esc(i.name)}</td><td>${ago(i.h)}</td>
      <td>${i.listed ? `<div class="meter"><i class="${b[0]}" style="width:${Math.round(c * 100)}%"></i></div>` : '<span class="mut">n/a</span>'}</td>
      <td>${badge(i)}</td>
      <td class="right">${i.listed ? `<button class="ghost sm" data-a="confirm" data-id="${i.id}">Confirm</button> <button class="ghost sm" data-a="markout" data-id="${i.id}">Mark out</button>` : `<button class="ghost sm" data-a="back" data-id="${i.id}">Back in stock</button>`}</td></tr>`; }).join('')}
  </table></div></div>`;
}

/* ---- impact ---- */
const LEVERS = [
  { k: 'resU', label: '“Product unavailable” cancellations resolved before payment', min: 0, max: 80, unit: '%', note: '35% of 4,235 monthly cancellations (≈1,482 orders)' },
  { k: 'resR', label: 'Store rejections prevented', min: 0, max: 60, unit: '%', note: '18% of cancellations (≈762 orders); busy-time and stock related' },
  { k: 'supp', label: 'Refund-status and missing-item tickets avoided', min: 0, max: 60, unit: '%', note: '29% + 19% of 5,900 tickets (≈2,832/mo)' },
  { k: 'rep', label: 'Repeat purchase rate recovered', min: 0, max: 14, unit: ' pp', note: 'Rate fell 14 pp (41% → 27%); this is the share won back' },
  { k: 'promo', label: 'Acquisition promo cut or reallocated', min: 0, max: 40, unit: '%', note: '58% of ₹17L/mo is acquisition spend' },
  { k: 'keep', label: 'At-risk partner stores retained', min: 0, max: 60, unit: '%', note: '18% of 620 stores (≈112) may leave within a year' },
  { k: 'one', label: 'One-time build cost (₹ lakh)', min: 5, max: 25, unit: 'L', note: 'Assumption. Hard cap from the brief: ₹25L', step: 0.5 },
  { k: 'run', label: 'Monthly run cost (₹ lakh)', min: 0, max: 5, unit: 'L', note: 'Assumption: hosting, store onboarding, support', step: 0.1 }
];

function cumChart(cum) {
  const W = 620, H = 160, pad = 24, mx = Math.max(...cum, 1e5), mn = Math.min(...cum, -1e5), rg = mx - mn;
  const y = v => pad + (mx - v) / rg * (H - 2 * pad), y0 = y(0), bw = W / 12 - 10;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Cumulative net benefit by month">
    <line x1="0" x2="${W}" y1="${y0}" y2="${y0}" stroke="#9ca3af" stroke-width="1"/>
    ${cum.map((v, i) => { const x = i * W / 12 + 5, yy = y(v); return `<rect x="${x}" y="${Math.min(y0, yy)}" width="${bw}" height="${Math.max(1, Math.abs(y0 - yy))}" rx="3" fill="${v >= 0 ? '#0f766e' : '#b91c1c'}" opacity=".85"/><text x="${x + bw / 2}" y="${H - 4}" font-size="10" text-anchor="middle" fill="#6b7280">M${i + 1}</text>`; }).join('')}
  </svg>`;
}

function impactOut() {
  const r = impact(S.impact), p = S.impact;
  const six = r.cum[5], twelve = r.cum[11];
  const over = p.one > 25;
  return `
  <div class="grid4" style="margin-bottom:16px">
    <div class="kpi"><div class="l">Monthly benefit</div><div class="v">${lk(r.benefit)}</div><div class="d mut">at full run-rate</div></div>
    <div class="kpi"><div class="l">Net of run cost</div><div class="v">${lk(r.net)}</div><div class="d mut">per month</div></div>
    <div class="kpi"><div class="l">Payback</div><div class="v">${r.payback ? 'Month ' + r.payback : '> 12 months'}</div><div class="d mut">on ${lk(r.one)} build</div></div>
    <div class="kpi"><div class="l">Net after 6 / 12 mo</div><div class="v">${lk(six)} / ${lk(twelve)}</div><div class="d ${twelve >= 0 ? 'good' : 'bad'}">incl. build and run cost</div></div>
  </div>
  <div class="card"><h2>Where the value comes from</h2><div class="tbl"><table>
    <tr><th>Lever</th><th>Basis</th><th class="right">₹ / month</th></tr>
    ${r.levers.map(l => `<tr><td><b>${l.name}</b></td><td class="mut">${l.basis}</td><td class="right">${lk(l.val)}</td></tr>`).join('')}
    <tr class="total"><td>Total monthly benefit</td><td></td><td class="right">${lk(r.benefit)}</td></tr>
    <tr><td>Run cost</td><td></td><td class="right">${lk(-r.run)}</td></tr>
    <tr><td><b>Net per month</b></td><td></td><td class="right"><b>${lk(r.net)}</b></td></tr>
  </table></div>
  <p class="note" style="margin-top:8px">Not counted: avoiding the proposed +30% marketing increase would save ${lk(r.avoided)}/month. Levers overlap somewhat (recovered orders and repeat rate share a cause), so treat the total as a planning range, not a forecast.</p>
  ${over ? '<div class="alert bad">Build cost exceeds the ₹25L cap in the brief.</div>' : ''}</div>
  <div class="card"><h2>Cumulative net benefit, 12 months</h2>${cumChart(r.cum)}<p class="note">Benefits ramp at 50% in months 1–2 while stores onboard. The build cost is spent up front.</p></div>`;
}

function viewImpact() {
  const p = S.impact;
  return `
  <div class="hero"><div class="kicker">Business impact</div><h1>What fixing the promise is worth</h1>
    <p>Everything in teal in the Diagnosis tab is measured from the brief. The levers below are the part we have to assume, so they're yours to change. Net revenue per order is derived from the brief: ₹26.1L ÷ 38,500 orders ≈ ₹68.</p></div>
  <div class="grid2">
    <div class="card">
      <div class="row2" style="margin-bottom:6px"><b style="align-self:center">Scenario</b>
        <button class="ghost sm" data-a="preset" data-p="conservative">Conservative</button>
        <button class="ghost sm" data-a="preset" data-p="base">Base</button>
        <button class="ghost sm" data-a="preset" data-p="optimistic">Optimistic</button></div>
      ${LEVERS.map(l => `<div class="slider"><label for="s-${l.k}"><span>${l.label}</span><b id="v-${l.k}">${p[l.k]}${l.unit}</b></label>
        <input type="range" id="s-${l.k}" data-slider="${l.k}" min="${l.min}" max="${l.max}" step="${l.step || 1}" value="${p[l.k]}"><div class="note">${l.note}</div></div>`).join('')}
    </div>
    <div id="impact-out">${impactOut()}</div>
  </div>`;
}

/* ============ render + events ============ */
const views = { diagnosis: viewDiagnosis, customer: viewCustomer, store: viewStore, impact: viewImpact };

function render() {
  $('#view').innerHTML = (views[S.tab] || viewDiagnosis)();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tab));
  $('#clock').textContent = `Day ${1 + Math.floor(S.hours / 24)} · +${S.hours % 24}h`;
  save();
}

const A = {
  tab: d => { S.tab = d.t; window.scrollTo(0, 0); },
  mode: d => { S.mode = d.m; if (S.order && S.order.phase === 'review') cancelOrder(); },
  sf: d => { S.sf = d.s; },
  add: d => addToCart(d.id),
  inc: d => addToCart(d.id),
  dec: d => { const l = S.cart.find(x => x.itemId === d.id); if (l) { l.qty--; if (l.qty <= 0) S.cart = S.cart.filter(x => x !== l); } },
  checkout: () => checkout(),
  cancelOrder: () => cancelOrder(),
  newOrder: () => { S.order = null; },
  autoreply: () => { S.reqs.filter(r => r.status === 'pending').forEach(r => resolveReq(r.id, item(r.itemId).actual)); },
  yes: d => resolveReq(+d.id, true),
  no: d => resolveReq(+d.id, false),
  swap: d => {
    const l = S.order.lines[+d.li], to = item(d.id);
    l.from = item(l.itemId).name; l.itemId = to.id; l.status = 'ok'; l.reqId = null;
  },
  dropline: d => { S.order.lines[+d.li].status = 'removed'; },
  lineNotify: d => { const l = S.order.lines[+d.li]; notify(item(l.itemId).name); l.status = 'removed'; },
  notifyq: () => { notify(S.q.trim()); S.q = ''; },
  pay: () => pay(),
  confirm: d => { const it = item(d.id); it.h = 0; it.actual = true; it.listed = true; },
  markout: d => { const it = item(d.id); it.listed = false; it.actual = false; },
  back: d => { const it = item(d.id); it.listed = true; it.actual = true; it.h = 0; },
  advance: () => advance(6),
  reset: () => { S = fresh(); },
  preset: d => { Object.assign(S.impact, PRESETS[d.p]); }
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled) return;
  if (b.tagName === 'A') e.preventDefault();
  const fn = A[b.dataset.a];
  if (fn) { fn(b.dataset); render(); }
});
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') { S.q = t.value; $('#results').innerHTML = resultsHTML(); save(); }
  else if (t.dataset && t.dataset.slider) {
    const l = LEVERS.find(x => x.k === t.dataset.slider);
    S.impact[l.k] = +t.value; $('#v-' + l.k).textContent = t.value + l.unit;
    $('#impact-out').innerHTML = impactOut(); save();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'storesel') { S.storeView = e.target.value; render(); }
});

render();
window.__stocksure = { get state() { return S; }, conf, queue, impact, DEFAULT_IMPACT }; // exposed for tests
})();
