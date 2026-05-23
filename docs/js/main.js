'use strict';

// ─── Storage ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'fc_work_orders';

function loadOrders() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveOrders(orders) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Staff list ──────────────────────────────────────────────────────────────
const STAFF = ['井戸', '関根', '柴', '片桐', '入江', '金', '玉井', '新田', '菊池', '渡辺', '濱田'];

function populateStaffSelects() {
  ['form-staff', 'form-requester'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">選択してください</option>' +
      STAFF.map(n => `<option value="${n}">${n}</option>`).join('');
    sel.value = current;
  });
}
populateStaffSelects();

// ─── State ───────────────────────────────────────────────────────────────────
let orders = loadOrders();
let filterStatus = 'all';
let filterDevice = 'all';
let searchText   = '';
let sortKey      = 'deadline';
let sortAsc      = true;

// ─── Katakana validation ─────────────────────────────────────────────────────
function isKatakana(str) {
  return /^[゠-ヿー　 　ー]+$/.test(str.trim());
}

// ─── HTML escape helpers ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}

// ─── Deadline helpers ────────────────────────────────────────────────────────
function deadlineClass(iso) {
  if (!iso) return '';
  const diff = (new Date(iso) - new Date()) / 36e5; // hours
  if (diff < 0)  return 'deadline-over';
  if (diff < 24) return 'deadline-near';
  return '';
}
function formatDeadline(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth()+1}/${d.getDate()}(${['日','月','火','水','木','金','土'][d.getDay()]}) ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatCompletedAt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth()+1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ─── Device badge ─────────────────────────────────────────────────────────────
function deviceBadge(device) {
  const map = { Mac: 'mac', Windows: 'win', スマホ: 'sp' };
  return `<span class="badge badge-${map[device] || 'mac'}">${device}</span>`;
}
function statusBadge(status) {
  const labels = { active: '作業中', done: '完了', waiting: '待機中' };
  return `<span class="badge badge-status-${status}">${labels[status] || status}</span>`;
}
function laneBadge(lane) {
  if (!lane) return '—';
  const map = { '第1レーン': 'lane1', '第2レーン': 'lane2', '第3レーン': 'lane3', '第4レーン': 'lane4', '第5レーン': 'lane5', '表': 'omote', '裏': 'ura' };
  return `<span class="badge badge-${map[lane] || 'lane1'}">${lane}</span>`;
}

function buildTimeOptions() {
  const hourSel = document.getElementById('form-deadline-hour');
  hourSel.innerHTML = '<option value="">時</option>';
  for (let h = 10; h <= 19; h++) {
    const o = document.createElement('option');
    o.value = h;
    o.textContent = String(h).padStart(2, '0');
    hourSel.appendChild(o);
  }
  hourSel.addEventListener('change', () => updateMinuteOptions(parseInt(hourSel.value) || null));
  updateMinuteOptions(null);
}
function updateMinuteOptions(hour) {
  const minSel   = document.getElementById('form-deadline-minute');
  const prevVal  = minSel.value;
  const startMin = (hour === 10) ? 30 : 0;
  const endMin   = (hour === 19) ? 0  : 55;
  minSel.innerHTML = '<option value="">分</option>';
  for (let m = startMin; m <= endMin; m += 5) {
    const o = document.createElement('option');
    o.value = String(m).padStart(2, '0');
    o.textContent = o.value;
    minSel.appendChild(o);
  }
  if ([...minSel.options].some(o => o.value === prevVal)) minSel.value = prevVal;
}
buildTimeOptions();

// ─── Render dashboard ────────────────────────────────────────────────────────
function filteredOrders() {
  return orders
    .filter(o => {
      if (filterStatus !== 'all' && o.status !== filterStatus) return false;
      if (filterDevice !== 'all' && o.device !== filterDevice) return false;
      if (searchText && !o.customerName.includes(searchText) &&
          !o.staff.includes(searchText) && !o.requester.includes(searchText)) return false;
      return true;
    })
    .sort((a, b) => {
      let va = a[sortKey] || '', vb = b[sortKey] || '';
      if (sortKey === 'deadline') { va = va || '9'; vb = vb || '9'; }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortAsc ? cmp : -cmp;
    });
}

function renderStats() {
  const all     = orders.length;
  const active  = orders.filter(o => o.status === 'active').length;
  const done    = orders.filter(o => o.status === 'done').length;
  const overdue = orders.filter(o => o.deadline && new Date(o.deadline) < new Date() && o.status !== 'done').length;
  document.getElementById('stat-all').textContent     = all;
  document.getElementById('stat-active').textContent  = active;
  document.getElementById('stat-done').textContent    = done;
  document.getElementById('stat-overdue').textContent = overdue;
  document.getElementById('stat-overdue').className   = 'stat-value' + (overdue > 0 ? ' warn' : ' ok');
}

function renderTable() {
  const list = filteredOrders();
  const tbody = document.getElementById('order-tbody');

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">
      <div class="empty-state">
        <div class="icon">📋</div>
        <p>該当する作業依頼がありません。</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(o => {
    const dl = formatDeadline(o.deadline);
    const dlCls = deadlineClass(o.deadline);
    const checkedCount = (o.checklist || []).filter(c => c.checked).length;
    const totalCount   = (o.checklist || []).length;
    const progress = totalCount > 0
      ? `<span style="font-size:12px;color:var(--text-muted)">${checkedCount}/${totalCount}</span>`
      : '';
    return `<tr onclick="openDetail('${o.id}')">
      <td><strong>${o.customerName}</strong></td>
      <td>${deviceBadge(o.device)}</td>
      <td class="${dlCls}">${dl}</td>
      <td>${o.staff || '—'}</td>
      <td>${o.requester || '—'}</td>
      <td>${laneBadge(o.lane)}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${progress}</td>
    </tr>`;
  }).join('');
}

function render() {
  renderStats();
  renderTable();
}

// ─── Sort ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('thead th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (sortKey === key) sortAsc = !sortAsc;
    else { sortKey = key; sortAsc = true; }
    document.querySelectorAll('thead th[data-sort] .sort-icon').forEach(i => i.textContent = '↕');
    th.querySelector('.sort-icon').textContent = sortAsc ? '↑' : '↓';
    render();
  });
});

// ─── Filter ───────────────────────────────────────────────────────────────────
document.getElementById('search-input').addEventListener('input', e => {
  searchText = e.target.value.trim();
  render();
});

document.querySelectorAll('.filter-btn[data-status]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-status]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterStatus = btn.dataset.status;
    render();
  });
});

document.querySelectorAll('.filter-btn[data-device]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-device]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    filterDevice = btn.dataset.device;
    render();
  });
});

// ─── Detail Modal ─────────────────────────────────────────────────────────────
function openDetail(id) {
  const o = orders.find(x => x.id === id);
  if (!o) return;

  document.getElementById('detail-name').textContent    = o.customerName;
  document.getElementById('detail-device').innerHTML    = deviceBadge(o.device);
  document.getElementById('detail-deadline').textContent = formatDeadline(o.deadline);
  document.getElementById('detail-deadline').className   = deadlineClass(o.deadline);
  document.getElementById('detail-created').textContent  = o.createdAt ? new Date(o.createdAt).toLocaleString('ja-JP') : '—';

  document.getElementById('detail-staff').textContent     = o.staff     || '—';
  document.getElementById('detail-requester').textContent = o.requester || '—';
  document.getElementById('detail-memo').textContent      = o.memo      || '—';

  const memberTypeEl   = document.getElementById('detail-member-type');
  const memberNoItem   = document.getElementById('detail-member-no-item');
  const memberNoEl     = document.getElementById('detail-member-no');
  if (memberTypeEl) memberTypeEl.textContent = o.memberType || '—';
  if (memberNoItem)  memberNoItem.style.display = o.memberNo ? '' : 'none';
  if (memberNoEl)    memberNoEl.textContent = o.memberNo || '';

  // Status select
  const sel = document.getElementById('detail-status-sel');
  sel.value = o.status;
  sel.onchange = () => {
    o.status = sel.value;
    saveOrders(orders);
    render();
  };

  // Lane select
  const laneSel = document.getElementById('detail-lane-sel');
  laneSel.value = o.lane || '';
  laneSel.onchange = () => {
    o.lane = laneSel.value;
    saveOrders(orders);
    render();
  };

  // Overall staff row
  const overallStaffDiv = document.getElementById('checklist-overall-staff');
  if (overallStaffDiv) {
    overallStaffDiv.innerHTML = `
      <div class="overall-staff-row">
        <span class="overall-staff-label">全体の作業者</span>
        <select class="overall-staff-sel" onchange="updateOverallStaff('${id}', this.value)">
          <option value="">未選択</option>
          ${STAFF.map(n => `<option value="${escAttr(n)}"${o.staff===n?' selected':''}>${escHtml(n)}</option>`).join('')}
        </select>
      </div>`;
  }

  // Checklist
  const ul = document.getElementById('detail-checklist');
  ul.innerHTML = (o.checklist || []).map((item, idx) => {
    const effectiveStaff = item.itemStaff || o.staff || '未設定';
    const staffSel = `<select class="item-staff-sel" onchange="updateItemStaff('${id}',${idx},this.value)">
      <option value="">(${escHtml(o.staff || '未設定')})</option>
      ${STAFF.map(n => `<option value="${escAttr(n)}"${item.itemStaff===n?' selected':''}>${escHtml(n)}</option>`).join('')}
    </select>`;
    return `
    <li class="${item.checked ? 'checked' : ''}" id="cli-${idx}">
      <input type="checkbox" ${item.checked ? 'checked' : ''}
        onchange="toggleCheck('${id}', ${idx}, this.checked)">
      <div style="flex:1;min-width:0">
        <div class="checklist-name">${escHtml(item.name)}</div>
        <div class="item-staff-row">${staffSel}</div>
        ${renderDetailForModal(item.detail, item, idx, id)}
      </div>
      <div class="checklist-action">
        ${item.checked
          ? `<span class="completed-time">✅ ${formatCompletedAt(item.completedAt)}</span>`
          : `<button class="btn-complete" onclick="completeItem('${id}',${idx})">完了</button>`}
      </div>
    </li>`;
  }).join('');

  // Add-work button
  const addWorkSection = document.getElementById('add-work-section');
  if (addWorkSection) {
    addWorkSection.innerHTML = `<div class="add-work-btn-wrap">
      <button type="button" class="btn-add-work" onclick="showAddWorkPanel('${id}')">＋ 作業を追加</button>
    </div>`;
    delete addWorkSection.dataset.availableItems;
  }

  document.getElementById('btn-delete').onclick = () => {
    if (confirm(`「${o.customerName}」様の作業依頼を削除しますか？`)) {
      orders = orders.filter(x => x.id !== id);
      saveOrders(orders);
      render();
      closeDetail();
    }
  };

  document.getElementById('overlay-detail').classList.add('open');
}

function toggleCheck(id, idx, checked) {
  const o = orders.find(x => x.id === id);
  if (!o || !o.checklist[idx]) return;
  const item = o.checklist[idx];
  item.checked = checked;
  if (checked) {
    if (!item.completedAt) item.completedAt = new Date().toISOString();
    if (o.checklist.every(c => c.checked)) o.status = 'done';
  } else {
    item.completedAt = null;
  }
  saveOrders(orders);
  render();
  openDetail(id);
}

function completeItem(orderId, idx) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[idx]) return;
  const item = o.checklist[idx];
  item.checked = true;
  item.completedAt = new Date().toISOString();
  if (o.checklist.every(c => c.checked)) o.status = 'done';
  saveOrders(orders);
  render();
  openDetail(orderId);
}

function closeDetail() {
  document.getElementById('overlay-detail').classList.remove('open');
}
document.getElementById('overlay-detail').addEventListener('click', e => {
  if (e.target === document.getElementById('overlay-detail')) closeDetail();
});
document.getElementById('btn-close-detail').addEventListener('click', closeDetail);

// ─── New Order Modal ──────────────────────────────────────────────────────────
let selectedDevice = '';

document.getElementById('btn-new').addEventListener('click', openNewForm);
function openNewForm() {
  selectedDevice = '';
  document.getElementById('form-customer').value       = '';
  document.getElementById('form-deadline-date').value    = '';
  document.getElementById('form-deadline-hour').value    = '';
  document.getElementById('form-deadline-minute').value  = '';
  updateMinuteOptions(null);
  document.getElementById('form-staff').value          = '';
  document.getElementById('form-requester').value      = '';
  document.getElementById('form-lane').value           = '';
  document.getElementById('form-memo').value           = '';
  document.getElementById('kana-error').classList.remove('show');
  document.querySelectorAll('.member-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('member-no-wrap').style.display = 'none';
  document.getElementById('form-member-no').value = '';
  document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('form-checklist-wrap').innerHTML =
    '<p style="color:var(--text-muted);font-size:13px;padding:10px 0">↑ デバイス種別を選択してください</p>';
  document.getElementById('overlay-new').classList.add('open');
}

document.querySelectorAll('.device-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedDevice = btn.dataset.device;
    renderFormChecklist(selectedDevice);
  });
});

// ─── Extras renderers ────────────────────────────────────────────────────────
function renderExtrasForForm(extras, item, idx) {
  if (!extras || !extras.length) return '';
  return extras.map(ex => {
    if (ex.type === 'sign_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label"><input type="checkbox" data-extra="signed" data-item="${idx}"> サイン確認済み</label>
        <label class="sub-check-label"><input type="checkbox" data-extra="staffChecked" data-item="${idx}"> 社員チェック済み</label>
      </div>`;
    }
    if (ex.type === 'username_select') {
      return `<div class="choice-group">
        ${['記述','MSアカウント表記名','owner'].map(opt =>
          `<button type="button" class="choice-btn" data-option="${escAttr(opt)}"
            data-item="${idx}" data-exclusive="uname${idx}"
            onclick="formExclusiveSelect(this,'uname${idx}',${idx})">${escHtml(opt)}</button>`
        ).join('')}
      </div>
      <div id="uname-form-${idx}" class="extra-field" style="display:none">
        <input type="text" class="choice-input" style="width:180px"
          data-extra="usernameText" data-item="${idx}" placeholder="ユーザー名を入力">
      </div>`;
    }
    if (ex.type === 'mail_address') {
      return `<div class="add-more-wrap" id="mail-addr-form-${idx}"></div>`;
    }
    if (ex.type === 'add_more') {
      return `<div class="add-more-wrap" id="add-more-form-${idx}">
        <div class="add-more-list"></div>
        <button type="button" class="btn-add-more" onclick="formAddItem(${idx})">＋ 追加</button>
      </div>`;
    }
    return '';
  }).join('');
}

function renderExtrasForModal(extras, item, idx, orderId) {
  if (!extras || !extras.length) return '';
  const ev = item.extraValues || {};
  return extras.map(ex => {
    if (ex.type === 'sign_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label">
          <input type="checkbox" ${ev.signed?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'signed',this.checked)">
          サイン確認済み</label>
        <label class="sub-check-label">
          <input type="checkbox" ${ev.staffChecked?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'staffChecked',this.checked)">
          社員チェック済み</label>
      </div>`;
    }
    if (ex.type === 'username_select') {
      const mode = ev.usernameMode || '';
      return `<div class="choice-group">
        ${['記述','MSアカウント表記名','owner'].map(opt =>
          `<button type="button" class="choice-btn${mode===opt?' selected':''}"
            data-option="${escAttr(opt)}" data-exclusive="uname-m-${idx}"
            onclick="modalExclusiveSelect(this,'uname-m-${idx}',${idx},'${orderId}')">${escHtml(opt)}</button>`
        ).join('')}
      </div>
      <div id="uname-modal-${idx}" class="extra-field" style="${mode==='記述'?'':'display:none'}">
        <input type="text" class="choice-input" style="width:180px"
          value="${escAttr(ev.usernameText||'')}" placeholder="ユーザー名を入力"
          onchange="updateExtraVal('${orderId}',${idx},'usernameText',this.value)">
      </div>`;
    }
    if (ex.type === 'mail_address') {
      const selected = item.selectedOptions || [];
      const mailAddrs = ev.mailAddresses || {};
      const rows = selected.map(type =>
        `<div class="extra-field">
          <span class="extra-label">${escHtml(type)}：</span>
          <input type="text" class="choice-input" style="width:180px"
            value="${escAttr(mailAddrs[type]||'')}" placeholder="アドレスを入力"
            onchange="updateMailAddress('${orderId}',${idx},'${escAttr(type)}',this.value)">
        </div>`
      ).join('');
      return `<div id="mail-addr-modal-${idx}">${rows}</div>`;
    }
    if (ex.type === 'add_more') {
      const rows = (ev.addedItems||[]).map((v, ri) =>
        `<div class="add-more-row">
          <input type="text" class="choice-input add-more-input" style="width:200px"
            value="${escAttr(v)}" placeholder="作業内容を入力"
            onchange="updateAddedItem('${orderId}',${idx},${ri},this.value)">
          <button type="button" class="btn-remove-item"
            onclick="removeAddedItem('${orderId}',${idx},${ri})">✕</button>
        </div>`
      ).join('');
      return `<div class="add-more-wrap" id="add-more-modal-${idx}">
        <div class="add-more-list">${rows}</div>
        <button type="button" class="btn-add-more"
          onclick="modalAddItem('${orderId}',${idx})">＋ 追加</button>
      </div>`;
    }
    return '';
  }).join('');
}

// ─── Extras event handlers ────────────────────────────────────────────────────
function exclusiveSelectForm(btn, idx) {
  document.querySelectorAll(`#form-checklist-wrap .choice-btn[data-item="${idx}"]:not([data-exclusive])`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function exclusiveSelectModal(btn, itemIdx, orderId) {
  document.querySelectorAll(`#detail-checklist .choice-btn[data-item="${itemIdx}"]:not([data-exclusive])`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const o = orders.find(x => x.id === orderId);
  if (o && o.checklist[itemIdx]) {
    o.checklist[itemIdx].selectedOptions = [btn.dataset.option];
    saveOrders(orders);
  }
}

function toggleMailTypeForm(btn, idx) {
  btn.classList.toggle('selected');
  const selected = [...document.querySelectorAll(`#form-checklist-wrap .choice-btn[data-item="${idx}"].selected`)]
    .map(b => b.dataset.option);
  const wrap = document.getElementById(`mail-addr-form-${idx}`);
  if (!wrap) return;
  wrap.innerHTML = selected.map(type =>
    `<div class="extra-field">
      <span class="extra-label">${escHtml(type)}：</span>
      <input type="text" class="choice-input" style="width:180px"
        data-mail-type="${escAttr(type)}" data-item="${idx}" placeholder="アドレスを入力">
    </div>`
  ).join('');
}

function toggleMailTypeModal(btn, itemIdx, orderId) {
  btn.classList.toggle('selected');
  const selected = [...document.querySelectorAll(`#detail-checklist .choice-btn[data-item="${itemIdx}"].selected`)]
    .map(b => b.dataset.option);
  const o = orders.find(x => x.id === orderId);
  if (o && o.checklist[itemIdx]) {
    o.checklist[itemIdx].selectedOptions = selected;
    saveOrders(orders);
  }
  const mailAddrs = o?.checklist[itemIdx]?.extraValues?.mailAddresses || {};
  const wrap = document.getElementById(`mail-addr-modal-${itemIdx}`);
  if (wrap) {
    wrap.innerHTML = selected.map(type =>
      `<div class="extra-field">
        <span class="extra-label">${escHtml(type)}：</span>
        <input type="text" class="choice-input" style="width:180px"
          value="${escAttr(mailAddrs[type]||'')}" placeholder="アドレスを入力"
          onchange="updateMailAddress('${orderId}',${itemIdx},'${escAttr(type)}',this.value)">
      </div>`
    ).join('');
  }
}

function updateMailAddress(orderId, itemIdx, type, value) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]) return;
  if (!o.checklist[itemIdx].extraValues) o.checklist[itemIdx].extraValues = {};
  if (!o.checklist[itemIdx].extraValues.mailAddresses) o.checklist[itemIdx].extraValues.mailAddresses = {};
  o.checklist[itemIdx].extraValues.mailAddresses[type] = value;
  saveOrders(orders);
}

function formExclusiveSelect(btn, group, idx) {
  document.querySelectorAll(`#form-checklist-wrap .choice-btn[data-exclusive="${group}"]`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const tf = document.getElementById(`uname-form-${idx}`);
  if (tf) tf.style.display = btn.dataset.option === '記述' ? '' : 'none';
}

function formAddItem(idx) {
  const list = document.querySelector(`#add-more-form-${idx} .add-more-list`);
  const row = document.createElement('div');
  row.className = 'add-more-row';
  row.innerHTML = `<input type="text" class="choice-input add-more-input" style="width:200px"
    data-extra="addItem" data-item="${idx}" placeholder="作業内容を入力">
    <button type="button" class="btn-remove-item" onclick="this.parentElement.remove()">✕</button>`;
  list.appendChild(row);
}

function modalExclusiveSelect(btn, group, itemIdx, orderId) {
  document.querySelectorAll(`#detail-checklist .choice-btn[data-exclusive="${group}"]`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const tf = document.getElementById(`uname-modal-${itemIdx}`);
  if (tf) tf.style.display = btn.dataset.option === '記述' ? '' : 'none';
  updateExtraVal(orderId, itemIdx, 'usernameMode', btn.dataset.option);
}

function updateExtraVal(orderId, itemIdx, key, value) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]) return;
  if (!o.checklist[itemIdx].extraValues) o.checklist[itemIdx].extraValues = {};
  o.checklist[itemIdx].extraValues[key] = value;
  saveOrders(orders);
}

function modalAddItem(orderId, itemIdx) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]) return;
  const item = o.checklist[itemIdx];
  if (!item.extraValues) item.extraValues = {};
  if (!item.extraValues.addedItems) item.extraValues.addedItems = [];
  const ri = item.extraValues.addedItems.length;
  item.extraValues.addedItems.push('');
  saveOrders(orders);
  const list = document.querySelector(`#add-more-modal-${itemIdx} .add-more-list`);
  if (list) {
    const row = document.createElement('div');
    row.className = 'add-more-row';
    row.innerHTML = `<input type="text" class="choice-input add-more-input" style="width:200px"
      value="" placeholder="作業内容を入力"
      onchange="updateAddedItem('${orderId}',${itemIdx},${ri},this.value)">
      <button type="button" class="btn-remove-item"
        onclick="removeAddedItem('${orderId}',${itemIdx},${ri})">✕</button>`;
    list.appendChild(row);
  }
}

function updateAddedItem(orderId, itemIdx, rowIdx, value) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]?.extraValues?.addedItems) return;
  o.checklist[itemIdx].extraValues.addedItems[rowIdx] = value;
  saveOrders(orders);
}

function removeAddedItem(orderId, itemIdx, rowIdx) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]?.extraValues?.addedItems) return;
  o.checklist[itemIdx].extraValues.addedItems.splice(rowIdx, 1);
  saveOrders(orders);
  const list = document.querySelector(`#add-more-modal-${itemIdx} .add-more-list`);
  if (list) {
    const items = o.checklist[itemIdx].extraValues.addedItems;
    list.innerHTML = items.map((v, ri) =>
      `<div class="add-more-row">
        <input type="text" class="choice-input add-more-input" style="width:200px"
          value="${escAttr(v)}" placeholder="作業内容を入力"
          onchange="updateAddedItem('${orderId}',${itemIdx},${ri},this.value)">
        <button type="button" class="btn-remove-item"
          onclick="removeAddedItem('${orderId}',${itemIdx},${ri})">✕</button>
      </div>`
    ).join('');
  }
}

// ─── Detail content renderers ─────────────────────────────────────────────────
function renderDetailForForm(detail, item, idx) {
  let html = '';
  if (detail) {
    if (/【[^】]*】/.test(detail)) {
      let n = 0;
      const processed = detail.replace(/【[^】]*】/g, () => {
        const i = n++;
        return `【<input type="text" class="choice-input" placeholder="入力" data-blank="${i}" data-item="${idx}">】`;
      });
      html = `<div class="checklist-form-detail">${processed}</div>`;
    } else if (detail.includes(' / ')) {
      const hasMail = (item.extras||[]).some(e => e.type === 'mail_address');
      let onclick;
      if (hasMail)              onclick = `onclick="toggleMailTypeForm(this,${idx})"`;
      else if (item.multiChoice) onclick = `onclick="this.classList.toggle('selected')"`;
      else                       onclick = `onclick="exclusiveSelectForm(this,${idx})"`;
      const btns = detail.split(' / ').map(opt =>
        `<button type="button" class="choice-btn" data-option="${escAttr(opt)}" data-item="${idx}"
          ${onclick}>${escHtml(opt)}</button>`
      ).join('');
      html = `<div class="choice-group">${btns}</div>`;
    } else {
      html = `<div class="checklist-form-detail">${escHtml(detail)}</div>`;
    }
  }
  return html + renderExtrasForForm(item.extras, item, idx);
}

function renderDetailForModal(detail, item, idx, orderId) {
  let html = '';
  if (detail) {
    if (/【[^】]*】/.test(detail)) {
      const vals = item.inputValues || [];
      let n = 0;
      const processed = detail.replace(/【[^】]*】/g, () => {
        const i = n++;
        return `【<input type="text" class="choice-input" value="${escAttr(vals[i]||'')}" placeholder="入力"
          onchange="updateBlank('${orderId}',${idx},${i},this.value)">】`;
      });
      html = `<div class="checklist-detail">${processed}</div>`;
    } else if (detail.includes(' / ')) {
      const hasMail = (item.extras||[]).some(e => e.type === 'mail_address');
      let onclick;
      if (hasMail)              onclick = `onclick="toggleMailTypeModal(this,${idx},'${orderId}')"`;
      else if (item.multiChoice) onclick = `onclick="toggleChoice('${orderId}',${idx},this)"`;
      else                       onclick = `onclick="exclusiveSelectModal(this,${idx},'${orderId}')"`;
      const selected = item.selectedOptions || [];
      const btns = detail.split(' / ').map(opt =>
        `<button type="button" class="choice-btn${selected.includes(opt)?' selected':''}"
          data-option="${escAttr(opt)}" data-item="${idx}"
          ${onclick}>${escHtml(opt)}</button>`
      ).join('');
      html = `<div class="choice-group">${btns}</div>`;
    } else {
      html = `<div class="checklist-detail">${escHtml(detail)}</div>`;
    }
  }
  return html + renderExtrasForModal(item.extras, item, idx, orderId);
}

function toggleChoice(orderId, itemIdx, btn) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]) return;
  const item = o.checklist[itemIdx];
  if (!item.selectedOptions) item.selectedOptions = [];
  const opt = btn.dataset.option;
  const pos = item.selectedOptions.indexOf(opt);
  if (pos === -1) { item.selectedOptions.push(opt); btn.classList.add('selected'); }
  else            { item.selectedOptions.splice(pos,1); btn.classList.remove('selected'); }
  saveOrders(orders);
}

function updateBlank(orderId, itemIdx, blankIdx, value) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]) return;
  const item = o.checklist[itemIdx];
  if (!item.inputValues) item.inputValues = [];
  item.inputValues[blankIdx] = value;
  saveOrders(orders);
}

function renderFormChecklist(device) {
  const items = WORK_ITEMS[device] || [];
  const wrap = document.getElementById('form-checklist-wrap');
  wrap.innerHTML = items.map((item, i) => `
    <div class="checklist-form-item">
      <input type="checkbox" id="fci-${i}" name="fci" value="${i}">
      <div class="checklist-form-content">
        <label for="fci-${i}" class="checklist-form-label">${escHtml(item.name)}</label>
        ${renderDetailForForm(item.detail, item, i)}
      </div>
    </div>`).join('');
}

document.getElementById('form-customer').addEventListener('input', function() {
  const err = document.getElementById('kana-error');
  if (this.value && !isKatakana(this.value)) {
    err.classList.add('show');
  } else {
    err.classList.remove('show');
  }
});

document.getElementById('btn-submit').addEventListener('click', submitNewOrder);
function submitNewOrder() {
  const name      = document.getElementById('form-customer').value.trim();
  const dateVal   = document.getElementById('form-deadline-date').value;
  const hourVal   = document.getElementById('form-deadline-hour').value;
  const minVal    = document.getElementById('form-deadline-minute').value;
  const timeStr   = (hourVal && minVal) ? `${String(hourVal).padStart(2,'0')}:${minVal}` : '';
  const deadline  = dateVal ? `${dateVal}T${timeStr || '00:00'}` : '';
  const staff     = document.getElementById('form-staff').value.trim();
  const requester = document.getElementById('form-requester').value.trim();
  const lane      = document.getElementById('form-lane').value;
  const memo      = document.getElementById('form-memo').value.trim();
  const err       = document.getElementById('kana-error');

  if (!name) { document.getElementById('form-customer').focus(); return; }
  if (!isKatakana(name)) { err.classList.add('show'); return; }
  if (!selectedDevice) { alert('デバイス種別を選択してください'); return; }

  const memberTypeBtn = document.querySelector('.member-btn.selected');
  const memberType    = memberTypeBtn ? memberTypeBtn.dataset.type : '';
  const memberNo      = ['青', 'SS等'].includes(memberType)
    ? document.getElementById('form-member-no').value.trim() : '';

  const checklist = WORK_ITEMS[selectedDevice].map((item, i) => {
    const cb = document.getElementById(`fci-${i}`);
    if (!cb || !cb.checked) return null;
    const selectedOptions = [...document.querySelectorAll(
      `#form-checklist-wrap .choice-btn[data-item="${i}"].selected:not([data-exclusive])`)]
      .map(btn => btn.dataset.option);
    const inputValues = [...document.querySelectorAll(
      `#form-checklist-wrap .choice-input[data-item="${i}"]:not([data-extra])`)]
      .map(inp => inp.value);
    const extraValues = {};
    (item.extras || []).forEach(ex => {
      if (ex.type === 'sign_check') {
        const s = document.querySelector(`#form-checklist-wrap [data-extra="signed"][data-item="${i}"]`);
        const c = document.querySelector(`#form-checklist-wrap [data-extra="staffChecked"][data-item="${i}"]`);
        if (s) extraValues.signed = s.checked;
        if (c) extraValues.staffChecked = c.checked;
      }
      if (ex.type === 'username_select') {
        const mb = document.querySelector(`#form-checklist-wrap .choice-btn[data-exclusive="uname${i}"].selected`);
        if (mb) extraValues.usernameMode = mb.dataset.option;
        const ut = document.querySelector(`#form-checklist-wrap [data-extra="usernameText"][data-item="${i}"]`);
        if (ut) extraValues.usernameText = ut.value;
      }
      if (ex.type === 'mail_address') {
        const mailAddresses = {};
        document.querySelectorAll(`#form-checklist-wrap [data-mail-type][data-item="${i}"]`).forEach(inp => {
          mailAddresses[inp.dataset.mailType] = inp.value;
        });
        extraValues.mailAddresses = mailAddresses;
      }
      if (ex.type === 'add_more') {
        const inputs = document.querySelectorAll(`#form-checklist-wrap [data-extra="addItem"][data-item="${i}"]`);
        extraValues.addedItems = [...inputs].map(inp => inp.value).filter(v => v.trim());
      }
    });
    return { ...item, checked: false, selectedOptions, inputValues, extraValues };
  }).filter(Boolean);

  const newOrder = {
    id: genId(),
    customerName: name,
    device: selectedDevice,
    deadline,
    staff,
    requester,
    lane,
    memo,
    memberType,
    memberNo,
    status: 'waiting',
    checklist,
    createdAt: new Date().toISOString(),
  };

  orders.unshift(newOrder);
  saveOrders(orders);
  render();
  closeNewForm();
}

function closeNewForm() {
  document.getElementById('overlay-new').classList.remove('open');
}
document.getElementById('overlay-new').addEventListener('click', e => {
  if (e.target === document.getElementById('overlay-new')) closeNewForm();
});
document.getElementById('btn-close-new').addEventListener('click', closeNewForm);
document.getElementById('btn-cancel').addEventListener('click', closeNewForm);

// ─── Member type selector ────────────────────────────────────────────────────
function selectMemberType(btn) {
  document.querySelectorAll('.member-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const needsNo = ['青', 'SS等'].includes(btn.dataset.type);
  document.getElementById('member-no-wrap').style.display = needsNo ? '' : 'none';
  if (!needsNo) document.getElementById('form-member-no').value = '';
}

// ─── Add work to existing order ───────────────────────────────────────────────
function showAddWorkPanel(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  const existingNames = new Set((o.checklist || []).map(c => c.name));
  const available = (WORK_ITEMS[o.device] || []).filter(item => !existingNames.has(item.name));

  const addWorkSection = document.getElementById('add-work-section');
  if (!addWorkSection) return;
  addWorkSection.dataset.availableItems = JSON.stringify(available);

  const predefinedHTML = available.length > 0
    ? available.map((item, i) =>
        `<label class="add-work-check">
          <input type="checkbox" data-add-idx="${i}"> ${escHtml(item.name)}
        </label>`
      ).join('')
    : '<p style="font-size:13px;color:var(--text-muted)">追加できる定義済み項目はありません</p>';

  addWorkSection.innerHTML = `
    <div class="add-work-panel">
      <div class="add-work-subtitle">追加する作業を選択してください</div>
      <div class="add-work-checks">${predefinedHTML}</div>
      <div class="add-work-custom">
        <label style="font-size:13px;font-weight:700;display:block;margin-bottom:4px">カスタム作業項目（任意）</label>
        <input type="text" id="add-work-custom-input" class="choice-input" style="width:100%" placeholder="作業内容を入力">
      </div>
      <div class="add-work-panel-footer">
        <button type="button" class="btn-secondary" onclick="cancelAddWork('${orderId}')">キャンセル</button>
        <button type="button" class="btn-primary" onclick="addWorkItems('${orderId}')">追加する</button>
      </div>
    </div>`;
}

function addWorkItems(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  const addWorkSection = document.getElementById('add-work-section');
  const available = JSON.parse(addWorkSection?.dataset.availableItems || '[]');

  document.querySelectorAll('#add-work-section [data-add-idx]:checked').forEach(cb => {
    const item = available[parseInt(cb.dataset.addIdx)];
    if (item) {
      o.checklist.push({ ...item, checked: false, selectedOptions: [], inputValues: [], extraValues: {} });
    }
  });

  const customInput = document.getElementById('add-work-custom-input');
  if (customInput && customInput.value.trim()) {
    o.checklist.push({ name: customInput.value.trim(), detail: '', checked: false, selectedOptions: [], inputValues: [], extraValues: {} });
  }

  saveOrders(orders);
  render();
  openDetail(orderId);
}

function cancelAddWork(orderId) {
  openDetail(orderId);
}

// ─── Per-item staff ───────────────────────────────────────────────────────────
function updateOverallStaff(orderId, value) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  o.staff = value;
  saveOrders(orders);
  render();
  // 基本情報の作業者を更新
  const detailStaffEl = document.getElementById('detail-staff');
  if (detailStaffEl) detailStaffEl.textContent = value || '—';
  // 各項目の「全体」ラベルを更新
  document.querySelectorAll('.item-staff-sel option[value=""]').forEach(opt => {
    opt.textContent = `(${value || '未設定'})`;
  });
}

function updateItemStaff(orderId, itemIdx, value) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]) return;
  o.checklist[itemIdx].itemStaff = value;
  saveOrders(orders);
}

// ─── Initial render ───────────────────────────────────────────────────────────
render();
