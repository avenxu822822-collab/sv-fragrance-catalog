const state = { page: 1, pageSize: 30, pages: 1, records: [], filtered: [], items: [] };
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const priceText = value => value === null || value === undefined || value === ''
  ? ''
  : `¥ ${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

const b64bytes = value => {
  const raw = atob(value);
  return Uint8Array.from(raw, char => char.charCodeAt(0));
};

async function decryptCatalog(password, reportStatus = () => {}) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('当前浏览器不支持安全解密，请改用手机 Safari 或 Chrome 打开');
  }
  reportStatus('正在读取加密资料…');
  const response = await fetch(`./catalog.enc.json?v=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('加密资料暂时无法读取');
  const bundle = await response.json();
  reportStatus('正在验证密码…');
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64bytes(bundle.salt), iterations: bundle.iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64bytes(bundle.iv) }, key, b64bytes(bundle.ciphertext)
  );
  return JSON.parse(new TextDecoder().decode(clear));
}

function countValues(field) {
  const counts = new Map();
  state.records.forEach(record => {
    const value = String(record[field] ?? '').trim();
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value, 'zh-CN'));
}

function fillSelect(id, values) {
  const select = $(id);
  [...select.options].slice(1).forEach(option => option.remove());
  values.forEach(({ value, count }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${value} · ${count}`;
    select.append(option);
  });
}

function loadStats() {
  const brands = new Set(state.records.map(item => item.normalized_brand).filter(Boolean)).size;
  const suppliers = new Set(state.records.map(item => item.supplier).filter(Boolean)).size;
  const pending = state.records.filter(item => item.verification_status !== '已核对').length;
  $('stats').innerHTML = [
    [state.records.length, '香精记录'], [suppliers, '香精公司'], [brands, '品牌标准名'], [pending, '待核对']
  ].map(([number, label]) => `<div class="stat"><b>${number}</b><span>${label}</span></div>`).join('');
}

function loadFilters() {
  fillSelect('supplier', countValues('supplier'));
  fillSelect('category', countValues('product_category'));
  fillSelect('gender', countValues('gender'));
  fillSelect('family', countValues('scent_family'));
  fillSelect('brand', countValues('normalized_brand'));
}

function resultCard(item, index) {
  const brand = item.normalized_brand || item.source_brand || '品牌待核对';
  const family = item.scent_family || item.product_category || '香调待补';
  const subtitle = item.english_name || (item.source_brand ? `原表品牌：${item.source_brand}` : '原表未填品牌');
  const price5 = priceText(item.price_5kg);
  const price1 = priceText(item.price_1kg);
  const primaryPrice = price5 || price1;
  const primaryUnit = price5 ? '5KG' : price1 ? '1KG' : '价格';
  const secondaryPrice = price5 && price1 ? `<small>${esc(price1)} / 1KG</small>` : '';
  return `<article class="result-card" data-id="${item.id}" style="animation-delay:${Math.min(index, 12) * 18}ms">
    <div class="supplier-code"><b>${esc(item.supplier_code || '—')}</b><span>${esc(item.supplier)}</span></div>
    <div class="perfume-name"><h3>${esc(item.name)}</h3><span>${esc(subtitle)}</span></div>
    <div class="family"><b>${esc(family)}</b><span>${esc(item.gender || item.note_position || '性别香待补')}</span></div>
    <div class="brand"><strong>${esc(brand)}</strong><em>${esc(item.verification_status)}</em></div>
    <div class="price"><strong>${esc(primaryPrice || '待补')}</strong><span>${primaryUnit}</span>${secondaryPrice}</div>
    <div class="row-arrow">›</div>
  </article>`;
}

function matches(record) {
  const query = $('search').value.trim().toLocaleLowerCase('zh-CN');
  if (query) {
    const haystack = [
      record.name, record.supplier_code, record.normalized_brand, record.source_brand,
      record.scent_family, record.gender, record.notes_pyramid, record.remark,
      record.english_brand, record.english_name, record.alternate_code, record.notes_english,
    ].join('\n').toLocaleLowerCase('zh-CN');
    if (!haystack.includes(query)) return false;
  }
  const tests = [
    ['supplier', 'supplier'], ['category', 'product_category'], ['gender', 'gender'],
    ['family', 'scent_family'], ['brand', 'normalized_brand'], ['status', 'verification_status'],
  ];
  return tests.every(([id, field]) => !$(id).value || String(record[field] ?? '') === $(id).value);
}

function loadResults(resetPage = false) {
  if (resetPage) state.page = 1;
  state.filtered = state.records.filter(matches);
  state.pages = Math.max(1, Math.ceil(state.filtered.length / state.pageSize));
  if (state.page > state.pages) state.page = state.pages;
  const start = (state.page - 1) * state.pageSize;
  state.items = state.filtered.slice(start, start + state.pageSize);
  $('resultCount').textContent = state.filtered.length;
  $('pageLabel').textContent = `${state.page} / ${state.pages}`;
  $('prev').disabled = state.page <= 1;
  $('next').disabled = state.page >= state.pages;
  $('results').innerHTML = state.items.map(resultCard).join('');
  $('empty').hidden = state.items.length > 0;
}

function showDetail(item) {
  const money = value => priceText(value) || '未录入';
  $('detailContent').innerHTML = `
    <span class="eyebrow">${esc(item.supplier)} · ${esc(item.supplier_code || '无编码')}</span>
    <h2>${esc(item.name)}</h2>
    ${item.english_name ? `<p class="detail-english">${esc(item.english_name)}</p>` : ''}
    <div class="detail-meta"><span>${esc(item.scent_family || '香调待补')}</span><span>${esc(item.gender || '性别香待补')}</span><span>${esc(item.verification_status)}</span></div>
    <div class="detail-grid">
      <div class="detail-block"><label>标准品牌</label><p>${esc(item.normalized_brand || '待核对')}</p></div>
      <div class="detail-block"><label>原表品牌</label><p>${esc(item.source_brand || '未填写')}</p></div>
      ${item.english_brand ? `<div class="detail-block"><label>英文品牌</label><p>${esc(item.english_brand)}</p></div>` : ''}
      ${item.release_year ? `<div class="detail-block"><label>发布年份</label><p>${esc(item.release_year)}</p></div>` : ''}
      ${item.alternate_code ? `<div class="detail-block"><label>其他编号</label><p>${esc(item.alternate_code)}</p></div>` : ''}
      <div class="detail-block"><label>产品类别</label><p>${esc(item.product_category || '未分类')}</p></div>
      <div class="detail-block"><label>香调位置</label><p>${esc(item.note_position || '未填写')}</p></div>
      <div class="detail-block wide"><label>香气层次</label><p>${esc(item.notes_pyramid || '未填写')}</p></div>
      ${item.notes_english ? `<div class="detail-block wide"><label>英文香调</label><p>${esc(item.notes_english)}</p></div>` : ''}
      <div class="detail-block"><label>5KG 价格</label><p>${money(item.price_5kg)}</p></div>
      <div class="detail-block"><label>1KG 价格</label><p>${money(item.price_1kg)}</p></div>
      <div class="detail-block"><label>备注</label><p>${esc(item.remark || '无')}</p></div>
      ${item.data_issue ? `<div class="detail-block wide issue"><label>数据提示</label><p>${esc(item.data_issue)}</p></div>` : ''}
      <div class="detail-block wide"><label>资料记录</label><p>${esc(item.supplier)} · 原表第 ${esc(item.source_row)} 行</p></div>
    </div>`;
  $('detailDialog').showModal();
}

function unlock(data) {
  state.records = data.records;
  loadStats();
  loadFilters();
  loadResults(true);
  document.body.classList.remove('locked');
  $('authGate').hidden = true;
  $('appShell').hidden = false;
  $('password').value = '';
}

$('authForm').addEventListener('submit', async event => {
  event.preventDefault();
  const password = $('password').value.trim();
  const button = $('authForm').querySelector('button[type="submit"]');
  if (!password) {
    $('authStatus').textContent = '请输入访问密码。';
    $('password').focus();
    return;
  }
  button.disabled = true;
  $('authStatus').textContent = '正在读取加密资料…';
  try {
    unlock(await decryptCatalog(password, message => { $('authStatus').textContent = message; }));
    $('authStatus').textContent = '';
  } catch (error) {
    const wrongPassword = error && (error.name === 'OperationError' || error.name === 'DataError');
    $('authStatus').textContent = wrongPassword
      ? '密码不正确，请重新输入。'
      : `登录失败：${error && error.message ? error.message : '请检查网络后重试'}`;
    $('password').select();
  } finally {
    button.disabled = false;
  }
});

$('lockApp').addEventListener('click', () => location.reload());
let timer;
$('search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadResults(true), 160); });
['supplier','category','gender','family','brand','status'].forEach(id => $(id).addEventListener('change', () => loadResults(true)));
$('resetFilters').addEventListener('click', () => {
  $('search').value = '';
  ['supplier','category','gender','family','brand','status'].forEach(id => $(id).value = '');
  loadResults(true);
});
$('prev').addEventListener('click', () => { if (state.page > 1) { state.page--; loadResults(); scrollTo({ top: 250, behavior: 'smooth' }); } });
$('next').addEventListener('click', () => { if (state.page < state.pages) { state.page++; loadResults(); scrollTo({ top: 250, behavior: 'smooth' }); } });
$('results').addEventListener('click', event => {
  const card = event.target.closest('.result-card');
  if (!card) return;
  const item = state.items.find(record => record.id === Number(card.dataset.id));
  if (item) showDetail(item);
});
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !$('appShell').hidden) {
    event.preventDefault(); $('search').focus();
  }
  if (event.key === 'Escape') document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
});
