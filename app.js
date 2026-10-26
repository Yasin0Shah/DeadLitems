/* DeadLitems — a Deadlock item shop viewer.
 *
 * Data:  https://api.deadlock-api.com/v1/assets/items   (community Deadlock API)
 * Art:   https://assets-bucket.deadlock-api.com/assets-api-res/...  (extracted game UI)
 *
 * No build step: open index.html in a browser (or serve the folder).
 */

// ─── Config ────────────────────────────────────────────────────────────────

const API = 'https://api.deadlock-api.com/v1/assets';
const LEGACY_ITEMS_URL = 'https://assets.deadlock-api.com/v2/items/by-type/upgrade';
const CDN = 'https://assets-bucket.deadlock-api.com/assets-api-res';

const CATEGORIES = [
  { slot: 'weapon',   label: 'Weapon'   },
  { slot: 'vitality', label: 'Vitality' },
  { slot: 'spirit',   label: 'Spirit'   },
];

// Fallback soul cost per tier (index = tier) if generic-data can't be loaded.
const FALLBACK_TIER_PRICES = [0, 800, 1600, 3200, 6400, 9999];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

const art = {
  tabIcon:   slot => `${CDN}/images/shop/catalog/catalog_shop_tab_icon_${slot}.png`,
  tabShape:  ()   => `${CDN}/images/shop/catalog/catalog_shop_tab_shape.png`,
  cardBack:  (slot, tier) => `${CDN}/images/shop/catalog/cards/card_backer_${slot}_t${tier}.png`,
  header:    slot => `${CDN}/images/shop/catalog/catalog_tooltip_header_${slot}.png`,
  soul:      ()   => `${CDN}/images/shop/catalog/price_currency.png`,
  font:      name => `${CDN}/fonts/${name}.otf`,
};

// Keybind tokens that appear inside item descriptions, e.g. {g:citadel_binding:'Item1'}
const KEYBINDS = {
  AbilityMelee: 'Q', Ability1: '1', Ability2: '2', Ability3: '3', Ability4: '4',
  Item1: 'Z', Item2: 'X', Item3: 'C', Item4: 'V', Mantle: 'SPACE', Roll: 'SHIFT',
  Crouch: 'CTRL', MoveDown: 'CTRL', Reload: 'R', Attack: 'MOUSE1', ADS: 'MOUSE2',
  AltCast: 'MOUSE3', ExtraInfo: 'ALT', Zipline: 'SPACE', HeldItem: 'F',
};

// Pretty names for stats that a property scales with.
const SCALE_STATS = {
  ETechPower: 'Spirit Power',
  EBulletDamage: 'Weapon Damage',
  EMaxHealth: 'Max Health',
  EBaseHealth: 'Base Health',
  ETechRange: 'Ability Range',
  ETechDuration: 'Ability Duration',
  ETechCooldown: 'Cooldown',
  EBulletArmorDamageReduction: 'Bullet Resist',
  ETechArmorDamageReduction: 'Spirit Resist',
};

const ACTIVATION_LABELS = {
  passive: 'Passive',
  press: 'Active',
  instant_cast: 'Active (instant cast)',
  press_toggle: 'Active (toggle)',
  hold_toggle: 'Active (hold)',
  instant_cast_toggle: 'Active (instant toggle)',
  on_button_is_down: 'Active (hold button)',
};

// Properties shown as the cooldown pill in a section header instead of as a stat row.
const TIMING_KEYS = new Set(['AbilityCooldown', 'ProcCooldown', 'AbilityChargeUpTime', 'AbilityCooldownBetweenCharge']);

// ─── State ─────────────────────────────────────────────────────────────────

const state = {
  items: [],               // shopable upgrades
  byClass: new Map(),      // class_name → item
  parents: new Map(),      // class_name → [items that use it as a component]
  chains: new Map(),       // class_name → Set of every class in its upgrade chain
  tierPrices: FALLBACK_TIER_PRICES,
  tab: 'weapon',
  query: '',
  openItem: null,
};

const $ = sel => document.querySelector(sel);
const el = (tag, cls, html) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ─── Data loading ──────────────────────────────────────────────────────────

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.json();
}

async function loadData() {
  let raw;
  try {
    raw = await fetchJson(`${API}/items?language=english`);
  } catch (err) {
    console.warn('Primary items endpoint failed, trying legacy endpoint', err);
    raw = await fetchJson(LEGACY_ITEMS_URL);
  }

  try {
    const generic = await fetchJson(`${API}/generic-data`);
    if (Array.isArray(generic.item_price_per_tier)) state.tierPrices = generic.item_price_per_tier;
  } catch { /* keep fallback prices */ }

  const items = raw
    .filter(i => i.type === 'upgrade' && i.shopable && !i.disabled && i.item_slot_type && i.item_tier)
    .sort((a, b) => a.name.localeCompare(b.name));

  state.items = items;
  state.byClass = new Map(items.map(i => [i.class_name, i]));

  // Reverse lookup: which items are built from this one?
  for (const item of items) {
    for (const comp of item.component_items ?? []) {
      if (!state.byClass.has(comp)) continue;
      if (!state.parents.has(comp)) state.parents.set(comp, []);
      state.parents.get(comp).push(item);
    }
  }

  // Full upgrade chains (walk components down and parents up), used for hover highlighting.
  for (const item of items) {
    if (state.chains.has(item.class_name)) continue;
    const chain = new Set();
    const queue = [item.class_name];
    while (queue.length) {
      const cn = queue.pop();
      if (chain.has(cn)) continue;
      chain.add(cn);
      for (const c of state.byClass.get(cn)?.component_items ?? []) if (state.byClass.has(c)) queue.push(c);
      for (const p of state.parents.get(cn) ?? []) queue.push(p.class_name);
    }
    if (chain.size > 1) for (const cn of chain) state.chains.set(cn, chain);
  }
}

// ─── Formatting helpers ────────────────────────────────────────────────────

function isVisible(prop) {
  if (!prop || prop.value === null || prop.value === undefined || prop.value === '') return false;
  if (prop.disable_value !== undefined && prop.disable_value !== null) return String(prop.value) !== String(prop.disable_value);
  return String(prop.value) !== '0';
}

function formatParts(prop) {
  const value = prop.value == null ? '' : String(prop.value);
  const n = Number.parseFloat(value);
  const sign = Number.isFinite(n) && n >= 0 ? '+' : '';
  const prefix = (prop.prefix ?? '').replace('{s:sign}', sign);
  const postfix = prop.postfix ?? '';
  const suffix = postfix.trim() && value.endsWith(postfix.trim()) ? '' : postfix;
  return { prefix, value, suffix };
}

function formatValueHtml(prop) {
  const { prefix, value, suffix } = formatParts(prop);
  return `<span class="val${prop.negative_attribute ? ' neg' : ''}">${esc(prefix)}<b>${esc(value)}</b>${suffix ? `<small>${esc(suffix)}</small>` : ''}</span>`;
}

function formatValueText(prop) {
  const { prefix, value, suffix } = formatParts(prop);
  return `${prefix}${value}${suffix}`;
}

// Descriptions come from the game's localization files and contain light HTML
// (highlight spans) plus keybind tokens. Strip anything script-like, swap tokens.
function formatDescription(html) {
  if (!html) return '';
  return html
    .replace(/<\s*(script|style|iframe)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\{g:citadel_(?:binding|keybind):(?:'([^']+)'|"([^"]+)"|([^}]+))\}/g, (_m, a, b, c) => {
      const bind = (a ?? b ?? c ?? '').trim().replace(/^Default\./, '');
      return `<kbd>${esc(KEYBINDS[bind] ?? bind)}</kbd>`;
    });
}

function prettyKey(key) {
  return key.replace(/^E(?=[A-Z])/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function itemImage(item) {
  return item.shop_image_webp || item.shop_image || item.image_webp || item.image || '';
}

function isActive(item) {
  return item.is_active_item ?? (item.activation && item.activation !== 'passive');
}

// Tier 5 items are Legendaries: the API gives them a placeholder 9999 cost.
function isLegendary(tier) {
  return tier >= 5;
}

function soulPrice(amount) {
  return `<span class="souls"><img src="${art.soul()}" alt="" onerror="this.remove()">${esc(amount)}</span>`;
}

function searchText(item) {
  if (item._search) return item._search;
  const parts = [item.name, item.item_slot_type, item.activation];
  for (const s of item.tooltip_sections ?? []) for (const a of s.section_attributes ?? []) parts.push(a.loc_string ?? '');
  for (const p of Object.values(item.properties ?? {})) if (isVisible(p) && p.label) parts.push(p.label);
  item._search = parts.join(' ').replace(/<[^>]+>/g, ' ').toLowerCase();
  return item._search;
}

// ─── Fonts (the game's own UI font, served from the API's CDN) ─────────────

function injectFonts() {
  const faces = [
    ['retaildemo-regular', 400, 'normal'], ['retaildemo-italic', 400, 'italic'],
    ['retaildemo-semibold', 600, 'normal'], ['retaildemo-bold', 700, 'normal'],
  ].map(([file, weight, style]) =>
    `@font-face{font-family:'Retail Demo';font-weight:${weight};font-style:${style};font-display:swap;src:url('${art.font(file)}') format('opentype');}`);
  document.head.appendChild(el('style', null, faces.join('\n')));
}

// ─── Shop rendering ────────────────────────────────────────────────────────

function renderTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  for (const cat of CATEGORIES) {
    const count = state.items.filter(i => i.item_slot_type === cat.slot && matchesQuery(i)).length;
    const btn = el('button', `tab tab-${cat.slot}${state.tab === cat.slot ? ' active' : ''}`);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', state.tab === cat.slot);
    btn.style.setProperty('--shape', `url("${art.tabShape()}")`);
    btn.innerHTML = `
      <span class="tab-shape"></span>
      <img class="tab-icon" src="${art.tabIcon(cat.slot)}" alt="" onerror="this.style.display='none'">
      <span class="tab-label">${cat.label}</span>
      ${state.query ? `<span class="tab-count">${count}</span>` : ''}`;
    btn.addEventListener('click', () => { state.tab = cat.slot; syncHash(); render(); });
    tabs.appendChild(btn);
  }
}

function matchesQuery(item) {
  return !state.query || searchText(item).includes(state.query);
}

function renderPanel() {
  const panel = $('#panel');
  panel.className = `panel panel-${state.tab}`;
  panel.innerHTML = '';

  const items = state.items.filter(i => i.item_slot_type === state.tab && matchesQuery(i));
  const tiers = [...new Set(state.items.filter(i => i.item_slot_type === state.tab).map(i => i.item_tier))].sort((a, b) => a - b);

  const grid = el('div', 'tiers');
  for (const tier of tiers) {
    const tierItems = items.filter(i => i.item_tier === tier);
    const section = el('div', `tier tier-${tier}${tierItems.length ? '' : ' empty'}${isLegendary(tier) ? ' legendary' : ''}`);
    const price = state.tierPrices[tier] ?? FALLBACK_TIER_PRICES[tier];
    section.innerHTML = `
      <div class="tier-head">
        <span class="tier-num">${ROMAN[tier - 1] ?? tier}</span>
        ${isLegendary(tier) ? '<span class="legend-label">Legendary</span>' : soulPrice(price)}
      </div>`;
    const cards = el('div', 'cards');
    for (const item of tierItems) cards.appendChild(renderCard(item));
    if (!tierItems.length) cards.appendChild(el('div', 'no-match', 'No matches'));
    section.appendChild(cards);
    grid.appendChild(section);
  }
  panel.appendChild(grid);
}

function renderCard(item) {
  const card = el('button', `card slot-${item.item_slot_type}${isActive(item) ? ' is-active' : ''}`);
  card.type = 'button';
  card.dataset.cls = item.class_name;
  card.title = item.name;
  card.innerHTML = `
    <img class="card-back" src="${art.cardBack(item.item_slot_type, item.item_tier)}" alt="" loading="lazy" onerror="this.remove()">
    <span class="card-icon"><img src="${itemImage(item)}" alt="" loading="lazy"></span>
    ${item.imbue ? '<span class="imbue-tag">Imbue</span>' : ''}
    <span class="card-tier">${ROMAN[item.item_tier - 1] ?? item.item_tier}</span>
    <span class="card-name">${esc(item.name)}</span>`;
  card.addEventListener('click', () => openDetail(item));
  card.addEventListener('mouseenter', () => highlightChain(item.class_name));
  card.addEventListener('mouseleave', () => highlightChain(null));
  card.addEventListener('focus', () => highlightChain(item.class_name));
  card.addEventListener('blur', () => highlightChain(null));
  return card;
}

// Dim everything except the hovered item's upgrade chain, like the in-game shop.
function highlightChain(className) {
  const chain = className ? state.chains.get(className) : null;
  const panel = $('#panel');
  panel.classList.toggle('highlighting', !!chain);
  for (const card of panel.querySelectorAll('.card')) {
    card.classList.toggle('related', !!chain && chain.has(card.dataset.cls));
  }
}

function render() {
  renderTabs();
  renderPanel();
}

// ─── Item detail ───────────────────────────────────────────────────────────

function renderSection(item, section) {
  const props = item.properties ?? {};
  const type = section.section_type ?? 'passive';

  // Pull cooldown / charge-up into the header pill.
  let cooldown = null;
  let chargeUp = null;
  const allKeys = (section.section_attributes ?? []).flatMap(a => [
    ...(a.important_properties ?? []), ...(a.elevated_properties ?? []), ...(a.properties ?? []),
  ]);
  if (type === 'active') allKeys.push('AbilityCooldown');
  for (const key of allKeys) {
    const p = props[key];
    if (!isVisible(p)) continue;
    if (key === 'AbilityChargeUpTime' || key === 'AbilityCooldownBetweenCharge') chargeUp ??= { key, p };
    if (key === 'ProcCooldown' || (key === 'AbilityCooldown' && !cooldown)) cooldown = { key, p };
  }

  const timingPill = t => t ? `<span class="pill">${t.p.icon ? `<img src="${t.p.icon}" alt="">` : '<i class="clock"></i>'}${formatValueHtml(t.p)}</span>` : '';

  const head = type === 'innate' ? '' : `
    <div class="section-head ${type}">
      <span>${type}</span>
      <span class="pills">${timingPill(cooldown)}${timingPill(chargeUp)}</span>
    </div>`;

  const body = (section.section_attributes ?? []).map(attr => {
    const importantSet = new Set(attr.important_properties ?? []);
    const elevatedSet = new Set(attr.elevated_properties ?? []);
    const important = (attr.important_properties ?? []).filter(k => !TIMING_KEYS.has(k) && isVisible(props[k]));
    const regular = [...(attr.elevated_properties ?? []), ...(attr.properties ?? [])]
      .filter(k => !importantSet.has(k) && !TIMING_KEYS.has(k) && isVisible(props[k]));

    const desc = attr.loc_string ? `<div class="desc">${formatDescription(attr.loc_string)}</div>` : '';
    const bigStats = important.map(k => {
      const p = props[k];
      const cond = p.conditional || p.usage_flags?.includes('ConditionallyApplied');
      return `<div class="big-stat">
        <div class="big-val">${p.icon ? `<img src="${p.icon}" alt="">` : ''}${formatValueHtml(p)}</div>
        <div class="big-label">${esc(p.label ?? prettyKey(k))}${cond ? '<em>Conditional</em>' : ''}</div>
      </div>`;
    }).join('');
    const rows = regular.map(k => {
      const p = props[k];
      return `<div class="stat-row${elevatedSet.has(k) ? ' elevated' : ''}">
        ${formatValueHtml(p)}<span class="stat-label">${esc(p.label ?? prettyKey(k))}${p.conditional ? ' <em>(conditional)</em>' : ''}</span>
      </div>`;
    }).join('');

    if (!desc && !bigStats && !rows) return '';
    return `<div class="attr">
      ${desc}
      ${bigStats || rows ? `<div class="stats${bigStats && rows ? ' split' : ''}">
        ${bigStats ? `<div class="big-stats">${bigStats}</div>` : ''}
        ${rows ? `<div class="rows">${rows}</div>` : ''}
      </div>` : ''}
    </div>`;
  }).join('');

  return `<div class="section ${type}">${head}${body}</div>`;
}

function renderTooltip(item) {
  const sections = item.tooltip_sections ?? [];
  let body = sections.map(s => renderSection(item, s)).join('');

  // Older data / items without tooltip sections: fall back to plain description.
  if (!body.trim() && item.description) {
    const d = typeof item.description === 'string' ? { desc: item.description } : item.description;
    body = Object.values(d).filter(Boolean).map(t => `<div class="section"><div class="attr"><div class="desc">${formatDescription(t)}</div></div></div>`).join('');
  }

  return `
    <div class="tooltip slot-${item.item_slot_type}">
      <div class="tooltip-head" style="background-image:url('${art.header(item.item_slot_type)}')">
        <h2 id="detail-name">${esc(item.name)}</h2>
        ${item.cost && !isLegendary(item.item_tier) ? soulPrice(item.cost) : ''}
      </div>
      <div class="tooltip-body">${body || '<div class="section"><div class="attr"><div class="desc">No description available.</div></div></div>'}</div>
    </div>`;
}

function itemChip(item) {
  return `<button type="button" class="chip slot-${item.item_slot_type}" data-goto="${esc(item.class_name)}">
    <img src="${itemImage(item)}" alt=""><span>${esc(item.name)}</span><small>T${item.item_tier}</small>
  </button>`;
}

function scalingText(p) {
  const sf = p.scale_function;
  if (!sf || sf.stat_scale == null || sf.stat_scale === '' || Number(sf.stat_scale) === 0) return '';
  const stat = SCALE_STATS[sf.specific_stat_scale_type] ?? prettyKey(sf.specific_stat_scale_type ?? (sf.scaling_stats?.[0] ?? 'stat'));
  return `×${sf.stat_scale} ${stat}`;
}

function renderExactStats(item) {
  const props = item.properties ?? {};
  const keys = Object.keys(props).filter(k => isVisible(props[k]));

  // Group stats: ones shown in the tooltip first (in tooltip order), then hidden extras.
  const shown = [];
  for (const s of item.tooltip_sections ?? []) for (const a of s.section_attributes ?? []) {
    for (const k of [...(a.important_properties ?? []), ...(a.elevated_properties ?? []), ...(a.properties ?? [])]) {
      if (keys.includes(k) && !shown.includes(k)) shown.push(k);
    }
  }
  if (keys.includes('AbilityCooldown') && !shown.includes('AbilityCooldown') && isActive(item)) shown.push('AbilityCooldown');
  const hidden = keys.filter(k => !shown.includes(k));

  const row = k => {
    const p = props[k];
    const scale = scalingText(p);
    return `<tr>
      <td><div class="ex-label">${esc(p.label ?? prettyKey(k))}</div><code>${esc(k)}</code></td>
      <td class="num${p.negative_attribute ? ' neg' : ''}">${esc(formatValueText(p))}</td>
      <td class="tags">${scale ? `<span class="tag scale">${esc(scale)}</span>` : ''}${p.conditional || p.usage_flags?.includes('ConditionallyApplied') ? '<span class="tag">Conditional</span>' : ''}</td>
    </tr>`;
  };

  const table = (title, list) => list.length ? `
    <h3>${title} <span class="count">${list.length}</span></h3>
    <table class="ex-table"><tbody>${list.map(row).join('')}</tbody></table>` : '';

  return table('Stats', shown) + table('Other properties', hidden);
}

function renderUpgradesInfo(item) {
  // Broker "corrupted" variant bonuses, when the API provides them.
  const ups = item.corrupted_info?.property_upgrades ?? [];
  if (!ups.length) return '';
  const props = item.properties ?? {};
  return `<h3>Corrupted variant bonuses</h3>
    <ul class="corrupt">${ups.map(u => `<li><span>${esc(props[u.name]?.label ?? prettyKey(u.name))}</span><b>+${esc(u.bonus)}</b></li>`).join('')}</ul>`;
}

function openDetail(item, { push = true } = {}) {
  state.openItem = item;
  const components = (item.component_items ?? []).map(c => state.byClass.get(c)).filter(Boolean);
  const parents = state.parents.get(item.class_name) ?? [];
  const totalCost = components.reduce((sum, c) => sum + (c.cost ?? 0), 0);
  const slotLabel = CATEGORIES.find(c => c.slot === item.item_slot_type)?.label ?? item.item_slot_type;

  const facts = [
    ['Category', `<span class="slot-dot slot-${item.item_slot_type}"></span>${slotLabel}`],
    ['Tier', `${ROMAN[item.item_tier - 1] ?? item.item_tier} (${item.item_tier})${isLegendary(item.item_tier) ? ' · Legendary' : ''}`],
    ['Cost', isLegendary(item.item_tier) ? 'No soul price (Legendary)' : item.cost ? soulPrice(item.cost) : '—'],
    ['Type', ACTIVATION_LABELS[item.activation] ?? esc(item.activation ?? 'Passive')],
    item.imbue ? ['Imbue', `Imbues an ability (${esc(prettyKey(String(item.imbue)))})`] : null,
    components.length ? ['Upgrade cost', `${soulPrice((item.cost ?? 0) - totalCost)} after components`] : null,
    ['ID', `<code>${esc(item.class_name)}</code> · <code>${item.id}</code>`],
  ].filter(Boolean);

  const detail = $('#detail');
  detail.className = `detail slot-${item.item_slot_type}`;
  detail.innerHTML = `
    <button class="close" type="button" aria-label="Close">×</button>
    <div class="detail-grid">
      <div class="detail-left">
        <div class="hero-icon${isActive(item) ? ' is-active' : ''}">
          <img src="${itemImage(item)}" alt="">
        </div>
        ${renderTooltip(item)}
      </div>
      <div class="detail-right">
        <dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        ${components.length ? `<h3>Built from</h3><div class="chips">${components.map(itemChip).join('')}</div>` : ''}
        ${parents.length ? `<h3>Builds into</h3><div class="chips">${parents.map(itemChip).join('')}</div>` : ''}
        ${renderExactStats(item)}
        ${renderUpgradesInfo(item)}
      </div>
    </div>`;

  detail.querySelector('.close').addEventListener('click', closeDetail);
  for (const chip of detail.querySelectorAll('[data-goto]')) {
    chip.addEventListener('click', () => {
      const next = state.byClass.get(chip.dataset.goto);
      if (next) openDetail(next);
    });
  }

  const overlay = $('#overlay');
  overlay.hidden = false;
  document.body.classList.add('modal-open');
  detail.scrollTop = 0;
  detail.querySelector('.close').focus({ preventScroll: true });
  if (push) syncHash();
}

function closeDetail() {
  if (!state.openItem) return;
  const cls = state.openItem.class_name;
  state.openItem = null;
  $('#overlay').hidden = true;
  document.body.classList.remove('modal-open');
  syncHash();
  document.querySelector(`.card[data-cls="${CSS.escape(cls)}"]`)?.focus({ preventScroll: true });
}

// Step through items in the current tab with ← / →
function stepDetail(dir) {
  if (!state.openItem) return;
  const list = state.items
    .filter(i => i.item_slot_type === state.openItem.item_slot_type && matchesQuery(i))
    .sort((a, b) => a.item_tier - b.item_tier || a.name.localeCompare(b.name));
  const idx = list.indexOf(state.openItem);
  const next = list[(idx + dir + list.length) % list.length];
  if (next) openDetail(next);
}

// ─── URL hash (#spirit, #item/upgrade_xyz) so views can be linked ──────────

function syncHash() {
  const hash = state.openItem ? `#item/${state.openItem.class_name}` : `#${state.tab}`;
  if (location.hash !== hash) history.replaceState(null, '', hash);
}

function readHash() {
  const h = decodeURIComponent(location.hash.slice(1));
  if (h.startsWith('item/')) {
    const item = state.byClass.get(h.slice(5));
    if (item) {
      state.tab = item.item_slot_type;
      render();
      openDetail(item, { push: false });
      return;
    }
  }
  if (CATEGORIES.some(c => c.slot === h)) state.tab = h;
  render();
}

// ─── Boot ──────────────────────────────────────────────────────────────────

function bindEvents() {
  let t;
  $('#search').addEventListener('input', e => {
    clearTimeout(t);
    t = setTimeout(() => {
      state.query = e.target.value.trim().toLowerCase();
      // Jump to a tab that has results if the current one has none.
      if (state.query && !state.items.some(i => i.item_slot_type === state.tab && matchesQuery(i))) {
        const other = CATEGORIES.find(c => state.items.some(i => i.item_slot_type === c.slot && matchesQuery(i)));
        if (other) state.tab = other.slot;
      }
      render();
    }, 120);
  });

  $('#overlay').addEventListener('click', e => { if (e.target.id === 'overlay') closeDetail(); });

  document.addEventListener('keydown', e => {
    if (state.openItem) {
      if (e.key === 'Escape') closeDetail();
      if (e.key === 'ArrowRight') stepDetail(1);
      if (e.key === 'ArrowLeft') stepDetail(-1);
      return;
    }
    if (e.target.matches('input')) {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    const n = Number(e.key);
    if (n >= 1 && n <= CATEGORIES.length) { state.tab = CATEGORIES[n - 1].slot; syncHash(); render(); }
  });

  window.addEventListener('hashchange', readHash);
}

async function boot() {
  injectFonts();
  bindEvents();
  try {
    await loadData();
    if (!state.items.length) throw new Error('The API returned no shop items.');
    readHash();
  } catch (err) {
    console.error(err);
    $('#panel').innerHTML = `<div class="status error">
      <b>Couldn't load item data.</b>
      <span>${esc(err.message)}</span>
      <button type="button" onclick="location.reload()">Retry</button>
    </div>`;
  }
}

boot();
