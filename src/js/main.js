'use strict';

// ─── Storage ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'fc_work_orders';
let ordersRef = null;
// PC診断処方箋（点検結果）連携
const PC_DIAG_URL = 'https://keke3331-bit.github.io/pc-diagnosis/';
let prescriptions = {};      // pc_prescriptions （id -> record）
let currentDetailId = null;  // 詳細モーダルで開いている作業ID

function loadOrders() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveOrders(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  if (ordersRef) ordersRef.set(list);
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function setSyncStatus(state) {
  const el = document.getElementById('sync-status');
  if (!el) return;
  if (state === 'ok')      { el.textContent = '🟢 同期中';  el.style.color = '#a7f3d0'; }
  else if (state === 'err'){ el.textContent = '🔴 エラー';  el.style.color = '#fca5a5'; }
  else                     { el.textContent = '⚪ 未接続';  el.style.color = '#cbd5e1'; }
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
  return /^[゠-ヿ]+$/.test(str.trim());
}

// ─── HTML escape helpers ──────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}

// ─── Deadline helpers ────────────────────────────────────────────────────────
function deadlineClass(iso, status) {
  if (!iso) return '';
  if (status === 'done' || status === 'delivered') return 'deadline-done';
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
  const labels = { active: '作業中', done: '完了', waiting: '待機中', delivered: '📦 お渡し済み' };
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
function needsNotification(o) {
  return o.requiresNotification && !o.completionNotified;
}

function filteredOrders() {
  return orders
    .filter(o => {
      if (filterStatus === 'delivered') return o.status === 'delivered';
      if (filterStatus === 'notify') return needsNotification(o) && o.status !== 'delivered';
      if (o.status === 'delivered') return false;
      if (filterStatus !== 'all' && o.status !== filterStatus) return false;
      if (filterDevice !== 'all' && o.device !== filterDevice) return false;
      if (searchText && !o.customerName.includes(searchText) &&
          !(o.staff||'').includes(searchText) && !(o.requester||'').includes(searchText)) return false;
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
  const active  = orders.filter(o => o.status === 'active').length;
  const done    = orders.filter(o => o.status === 'done').length;
  const all     = orders.filter(o => o.status !== 'delivered').length;
  const overdue = orders.filter(o => o.deadline && new Date(o.deadline) < new Date() && o.status !== 'done' && o.status !== 'delivered').length;
  document.getElementById('stat-all').textContent     = all;
  document.getElementById('stat-active').textContent  = active;
  document.getElementById('stat-done').textContent    = done;
  document.getElementById('stat-overdue').textContent = overdue;
  document.getElementById('stat-overdue').className   = 'stat-value' + (overdue > 0 ? ' warn' : ' ok');
  const notify = orders.filter(o => needsNotification(o) && o.status !== 'delivered').length;
  document.getElementById('stat-notify').textContent = notify;
  document.getElementById('stat-notify').className   = 'stat-value' + (notify > 0 ? ' warn' : ' ok');
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
    const dlCls = deadlineClass(o.deadline, o.status);
    const checkedCount = (o.checklist || []).filter(c => c.checked).length;
    const totalCount   = (o.checklist || []).length;
    const notified = o.completionNotified
      ? `<span class="notified-badge">連絡済</span>` : '';
    const needNotify = needsNotification(o)
      ? `<span class="notify-badge">🔔 要連絡</span>` : '';
    const progress = totalCount > 0
      ? `<span style="font-size:12px;color:var(--text-muted)">${checkedCount}/${totalCount}</span>`
      : '';

    return `<tr onclick="openDetail('${o.id}')">
      <td><strong>${o.customerName} 様</strong></td>
      <td>${deviceBadge(o.device)}</td>
      <td class="${dlCls}">${dl}${notified}</td>
      <td>${o.staff || '—'}</td>
      <td>${o.requester || '—'}</td>
      <td>${laneBadge(o.lane)}</td>
      <td>${statusBadge(o.status)}${needNotify}</td>
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
  currentDetailId = id;
  renderPrescriptionLink(o);

  document.getElementById('detail-name').textContent    = o.customerName + ' 様';
  document.getElementById('detail-device').innerHTML    = deviceBadge(o.device);
  document.getElementById('detail-deadline').textContent = formatDeadline(o.deadline);
  document.getElementById('detail-deadline').className   = deadlineClass(o.deadline, o.status);

  // 初回納期表示（変更済みの場合のみ表示）
  const origEl = document.getElementById('detail-original-deadline');
  if (origEl) {
    if (o.originalDeadline && o.originalDeadline !== o.deadline) {
      origEl.textContent = `（初回：${formatDeadline(o.originalDeadline)}）`;
      origEl.style.display = '';
    } else {
      origEl.style.display = 'none';
    }
  }

  // 納期編集パネルを閉じた状態にリセット
  const panel = document.getElementById('deadline-edit-panel');
  if (panel) panel.style.display = 'none';

  // 納期編集パネルの時刻セレクト初期化
  initDeadlineEditSelects(id);

  const notifyCb = document.getElementById('detail-completion-notify');
  if (notifyCb) {
    notifyCb.checked = o.completionNotified || false;
    notifyCb.onchange = () => {
      const target = orders.find(x => x.id === id);
      if (!target) return;
      target.completionNotified = notifyCb.checked;
      saveOrders(orders);
      render();
    };
  }
  document.getElementById('detail-created').textContent  = o.createdAt ? new Date(o.createdAt).toLocaleString('ja-JP') : '—';

  document.getElementById('detail-staff').textContent     = o.staff     || '—';
  document.getElementById('detail-requester').textContent = o.requester || '—';
  const memoEl = document.getElementById('detail-memo');
  if (memoEl && document.activeElement !== memoEl) {
    memoEl.value = o.memo || '';
  }
  if (memoEl) {
    memoEl.oninput = () => {
      const target = orders.find(x => x.id === id);
      if (!target) return;
      target.memo = memoEl.value;
      saveOrders(orders);
    };
  }

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
    if (sel.value !== 'delivered') {
      o.deliveredTo = null;
      o.deliveredAt = null;
    }
    saveOrders(orders);
    render();
    openDetail(id);
  };

  // Deliver button & panel
  const btnDeliver = document.getElementById('btn-deliver');
  const deliverPanel = document.getElementById('deliver-panel');
  const deliverInfo = document.getElementById('deliver-info');
  const deliverPersonSel = document.getElementById('deliver-person-sel');
  deliverPanel.style.display = 'none';
  deliverPersonSel.innerHTML = STAFF.map(n =>
    `<option value="${escAttr(n)}"${n === (o.requester || '') ? ' selected' : ''}>${escHtml(n)}</option>`
  ).join('');
  if (o.status === 'delivered') {
    btnDeliver.style.display = 'none';
    deliverInfo.style.display = '';
    deliverInfo.innerHTML = `📦 お客様へお渡し済み（${escHtml(o.deliveredTo || '—')}　${o.deliveredAt ? formatCompletedAt(o.deliveredAt) : ''}）`;
  } else {
    btnDeliver.style.display = '';
    deliverInfo.style.display = 'none';
  }
  document.getElementById('btn-deliver-confirm').onclick = () => {
    o.status = 'delivered';
    o.deliveredTo = deliverPersonSel.value;
    o.deliveredAt = new Date().toISOString();
    saveOrders(orders);
    render();
    openDetail(id);
  };

  // Lane select
  const laneSel = document.getElementById('detail-lane-sel');
  laneSel.value = o.lane || '';
  laneSel.onchange = () => {
    const target = orders.find(x => x.id === id);
    if (!target) return;
    target.lane = laneSel.value;
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

  document.getElementById('btn-print').onclick = () => printOrder(id);

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

function toggleDeliverPanel() {
  const panel = document.getElementById('deliver-panel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function initDeadlineEditSelects(orderId) {
  const hourSel = document.getElementById('edit-deadline-hour');
  const minSel  = document.getElementById('edit-deadline-minute');
  if (!hourSel || !minSel) return;

  if (hourSel.options.length <= 1) {
    for (let h = 0; h <= 23; h++) {
      const o = document.createElement('option');
      o.value = String(h).padStart(2,'0');
      o.textContent = String(h).padStart(2,'0') + '時';
      hourSel.appendChild(o);
    }
  }
  if (minSel.options.length <= 1) {
    ['00','15','30','45'].forEach(m => {
      const o = document.createElement('option');
      o.value = m; o.textContent = m + '分';
      minSel.appendChild(o);
    });
  }

  const order = orders.find(x => x.id === orderId);
  const dateEl = document.getElementById('edit-deadline-date');
  if (order && order.deadline) {
    const d = new Date(order.deadline);
    dateEl.value = order.deadline.slice(0,10);
    hourSel.value = String(d.getHours()).padStart(2,'0');
    const m = d.getMinutes();
    const rounded = ['00','15','30','45'].reduce((prev, cur) =>
      Math.abs(parseInt(cur)-m) < Math.abs(parseInt(prev)-m) ? cur : prev);
    minSel.value = rounded;
  } else {
    dateEl.value = '';
    hourSel.value = '';
    minSel.value = '';
  }

  document.getElementById('btn-deadline-save').onclick = () => saveDeadlineEdit(orderId);
}

function toggleDeadlineEdit() {
  const panel = document.getElementById('deadline-edit-panel');
  panel.style.display = panel.style.display === 'none' ? '' : 'none';
}

function saveDeadlineEdit(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  const dateVal = document.getElementById('edit-deadline-date').value;
  const hourVal = document.getElementById('edit-deadline-hour').value;
  const minVal  = document.getElementById('edit-deadline-minute').value;
  const newDeadline = dateVal ? `${dateVal}T${hourVal||'00'}:${minVal||'00'}` : '';

  if (!o.originalDeadline) o.originalDeadline = o.deadline;
  o.deadline = newDeadline;
  saveOrders(orders);
  render();
  openDetail(orderId);
}

function closeDetail() {
  document.getElementById('overlay-detail').classList.remove('open');
  currentDetailId = null;
}

// ─── 点検結果（PC診断処方箋）連携 ───────────────────────────────────────────────
function prescriptionLabel(rec) {
  const name = (rec.name || '（無題）');
  const date = (rec.date || (rec.updatedAt || '').slice(0,10) || '');
  const member = rec.member ? '会員' + rec.member : '';
  const tester = rec.tester ? '／点検者 ' + rec.tester : '';
  return { name, sub: [member, date, tester].filter(Boolean).join('　') };
}
function renderPrescriptionLink(o) {
  const box = document.getElementById('detail-prescription');
  if (!box) return;
  const rec = o.prescriptionId ? prescriptions[o.prescriptionId] : null;
  if (o.prescriptionId && rec) {
    const L = prescriptionLabel(rec);
    box.innerHTML =
      `<div class="rx-linked">
        <div class="rx-info"><span class="rx-emoji">🩺</span>
          <div><div class="rx-name">${escHtml(L.name)} 様</div>
          <div class="rx-sub">${escHtml(L.sub)}</div></div>
        </div>
        <div class="rx-acts">
          <button class="rx-open" onclick="openPrescription('${escAttr(o.prescriptionId)}')">点検結果を開く ↗</button>
          <button class="rx-unlink" onclick="unlinkPrescription('${escAttr(o.id)}')">解除</button>
        </div>
      </div>`;
  } else if (o.prescriptionId && !rec) {
    box.innerHTML =
      `<div class="rx-empty">⚠️ 紐づけた点検結果が見つかりません（削除された可能性）
        <button class="rx-unlink" onclick="unlinkPrescription('${escAttr(o.id)}')">解除</button></div>`;
  } else {
    box.innerHTML =
      `<button class="rx-link-btn" onclick="openPrescriptionPicker('${escAttr(o.id)}')">🩺 点検結果を紐づける</button>`;
  }
}
function openPrescription(id) {
  window.open(PC_DIAG_URL + '?id=' + encodeURIComponent(id), '_blank', 'noopener');
}
function unlinkPrescription(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  o.prescriptionId = null;
  saveOrders(orders);
  renderPrescriptionLink(o);
}
function linkPrescription(orderId, recId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  o.prescriptionId = recId;
  saveOrders(orders);
  closePrescriptionPicker();
  renderPrescriptionLink(o);
}
function closePrescriptionPicker() {
  const m = document.getElementById('rx-picker');
  if (m) m.remove();
}
function openPrescriptionPicker(orderId) {
  closePrescriptionPicker();
  const o = orders.find(x => x.id === orderId);
  const wrap = document.createElement('div');
  wrap.id = 'rx-picker';
  wrap.className = 'rx-picker-overlay';
  wrap.innerHTML =
    `<div class="rx-picker-box">
      <div class="rx-picker-head">点検結果を選択
        <span class="rx-picker-x" onclick="closePrescriptionPicker()">×</span></div>
      <input id="rx-picker-search" class="rx-picker-search" placeholder="お客様名・会員番号で検索">
      <div id="rx-picker-list" class="rx-picker-list"></div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap) closePrescriptionPicker(); });
  const search = document.getElementById('rx-picker-search');
  // 会員番号があれば初期フィルタ（表記揺れの少ない確実なキー）。無ければ全件表示。
  search.value = (o && o.memberNo) ? o.memberNo : '';
  const renderRows = () => {
    const q = (search.value || '').trim().toLowerCase();
    const arr = Object.values(prescriptions)
      .sort((a,b) => (b.updatedAt||'').localeCompare(a.updatedAt||''));
    const f = arr.filter(r => !q ||
      [r.name, r.member, r.tester, r.date].join(' ').toLowerCase().includes(q));
    const list = document.getElementById('rx-picker-list');
    if (!arr.length) { list.innerHTML = '<div class="rx-picker-empty">点検結果がまだありません</div>'; return; }
    if (!f.length) { list.innerHTML = '<div class="rx-picker-empty">該当なし（検索条件を変えてください）</div>'; return; }
    list.innerHTML = f.map(r => {
      const L = prescriptionLabel(r);
      return `<div class="rx-row" onclick="linkPrescription('${escAttr(orderId)}','${escAttr(r.id)}')">
        <div class="rx-name">${escHtml(L.name)} 様</div>
        <div class="rx-sub">${escHtml(L.sub)}</div></div>`;
    }).join('');
  };
  search.addEventListener('input', renderRows);
  renderRows();
  search.focus();
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
  document.getElementById('form-requires-notification').checked = false;
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
  let dataFullRendered = false;
  return extras.map(ex => {
    if (ex.type === 'sign_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label"><input type="checkbox" data-extra="signed" data-item="${idx}"> サイン確認済み</label>
        <label class="sub-check-label"><input type="checkbox" data-extra="staffChecked" data-item="${idx}"> 社員チェック済み</label>
      </div>`;
    }
    if (ex.type === 'apple_id_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label"><input type="checkbox" data-extra="appleIdConfirmed" data-item="${idx}"> 🍎 Apple ID 確認済み</label>
        <label class="sub-check-label"><input type="checkbox" data-extra="faceToFace" data-item="${idx}"> 👤 面前対応</label>
      </div>`;
    }
    if (ex.type === 'account_2fa_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label"><input type="checkbox" data-extra="accountConfirmed" data-item="${idx}"> ✅ アカウント確認済み</label>
        <label class="sub-check-label"><input type="checkbox" data-extra="twoFaDestConfirmed" data-item="${idx}"> 📩 2ファクタ送信先確認済み</label>
      </div>`;
    }
    if (ex.type === 'theft_protection_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label"><input type="checkbox" data-extra="theftProtectionCleared" data-item="${idx}"> 🔓 盗難防止保護解除済み</label>
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
    if ((ex.type === 'data_full_check' || ex.type === 'data_transfer' || ex.type === 'backup_check') && selectedDevice !== 'スマホ') {
      if (dataFullRendered) return '';
      dataFullRendered = true;
      return `<div class="media-type-section" style="margin-top:6px">
        <span class="extra-label" style="display:block;margin-bottom:4px">記憶媒体：</span>
        <div class="choice-group" style="display:inline-flex;gap:4px;flex-wrap:wrap">
          ${['備品','持込','購入品','直移行','他'].map(opt =>
            `<button type="button" class="choice-btn"
              data-media-type="${escAttr(opt)}" data-item="${idx}"
              onclick="formMediaTypeSelect(this,${idx})">${escHtml(opt)}</button>`
          ).join('')}
        </div>
      </div>
      <div id="backup-no-form-${idx}" style="display:none;margin-top:4px">
        <span class="extra-label" style="display:block;margin-bottom:4px">備品No：</span>
        <div class="choice-group" style="display:inline-flex;gap:4px;flex-wrap:wrap">
          ${['No①','No②','No③','No④','No⑤','No⑥'].map(no =>
            `<button type="button" class="choice-btn"
              data-backup-no="${escAttr(no)}" data-item="${idx}"
              onclick="formBackupNoSelect(this,${idx})">${no}</button>`
          ).join('')}
        </div>
      </div>`;
    }
    return '';
  }).join('');
}

function renderExtrasForModal(extras, item, idx, orderId) {
  if (!extras || !extras.length) return '';
  const ev = item.extraValues || {};
  let dataFullRendered = false;
  return extras.map(ex => {
    if (ex.type === 'sign_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label ${ev.signed ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.signed?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'signed',this.checked)">
          <span>✍️ サイン確認済み</span></label>
        <label class="sub-check-label ${ev.staffChecked ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.staffChecked?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'staffChecked',this.checked)">
          <span>👤 社員チェック済み</span></label>
      </div>`;
    }
    if (ex.type === 'apple_id_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label ${ev.appleIdConfirmed ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.appleIdConfirmed?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'appleIdConfirmed',this.checked)">
          <span>🍎 Apple ID 確認済み</span></label>
        <label class="sub-check-label ${ev.faceToFace ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.faceToFace?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'faceToFace',this.checked)">
          <span>👤 面前対応</span></label>
      </div>`;
    }
    if (ex.type === 'account_2fa_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label ${ev.accountConfirmed ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.accountConfirmed?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'accountConfirmed',this.checked)">
          <span>✅ アカウント確認済み</span></label>
        <label class="sub-check-label ${ev.twoFaDestConfirmed ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.twoFaDestConfirmed?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'twoFaDestConfirmed',this.checked)">
          <span>📩 2ファクタ送信先確認済み</span></label>
      </div>`;
    }
    if (ex.type === 'theft_protection_check') {
      return `<div class="extra-checks">
        <label class="sub-check-label ${ev.theftProtectionCleared ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.theftProtectionCleared?'checked':''}
            onchange="updateExtraVal('${orderId}',${idx},'theftProtectionCleared',this.checked)">
          <span>🔓 盗難防止保護解除済み</span></label>
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
    if (ex.type === 'data_transfer' || ex.type === 'backup_check' || ex.type === 'data_full_check') {
      if (dataFullRendered) return '';
      dataFullRendered = true;
      const mediaType = ev.mediaType || '';
      const backupNo  = ev.backupDeviceNo || '';
      const mediaBtns = ['備品','持込','購入品','直移行','他'].map(opt =>
        `<button type="button" class="choice-btn${mediaType===opt?' selected':''}"
          onclick="updateMediaType('${orderId}',${idx},'${opt}')">${escHtml(opt)}</button>`
      ).join('');
      const noBtns = mediaType === '備品'
        ? `<div class="extra-field">
            <span class="extra-label">備品No：</span>
            ${['No①','No②','No③','No④','No⑤','No⑥'].map(no =>
              `<button type="button" class="choice-btn${backupNo===no?' selected':''}"
                onclick="updateBackupDevice('${orderId}',${idx},'${no}')">${no}</button>`
            ).join('')}
          </div>` : '';
      return `<div class="extra-checks">
        <label class="sub-check-label ${ev.dataExtracted ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.dataExtracted ? 'checked' : ''}
            onchange="updateExtraVal('${orderId}',${idx},'dataExtracted',this.checked)">
          <span>📤 データ抜き出し完了</span></label>
        <label class="sub-check-label ${ev.dataRestored ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.dataRestored ? 'checked' : ''}
            onchange="updateExtraVal('${orderId}',${idx},'dataRestored',this.checked)">
          <span>📥 データ戻し完了</span></label>
        <label class="sub-check-label ${ev.backupDone ? 'sub-check-done' : ''}">
          <input type="checkbox" ${ev.backupDone ? 'checked' : ''}
            onchange="updateExtraVal('${orderId}',${idx},'backupDone',this.checked)">
          <span>💾 バックアップ完了</span></label>
      </div>
      <div class="media-type-section">
        <span class="extra-label">記憶媒体：</span>
        <div class="choice-group" style="display:inline-flex;gap:4px;flex-wrap:wrap">${mediaBtns}</div>
      </div>
      ${noBtns}`;
    }
    return '';
  }).join('');
}

function checkDataTransfer(orderId, itemIdx) {
  // no auto-complete: user must press 完了 button manually
}

function checkDataFull(orderId, itemIdx) {
  // no auto-complete: user must press 完了 button manually
}

function updateMediaType(orderId, itemIdx, type) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]) return;
  if (!o.checklist[itemIdx].extraValues) o.checklist[itemIdx].extraValues = {};
  o.checklist[itemIdx].extraValues.mediaType = type;
  if (type !== '備品') delete o.checklist[itemIdx].extraValues.backupDeviceNo;
  saveOrders(orders);
  openDetail(orderId);
}

function updateBackupDevice(orderId, itemIdx, no) {
  const o = orders.find(x => x.id === orderId);
  if (!o || !o.checklist[itemIdx]) return;
  if (!o.checklist[itemIdx].extraValues) o.checklist[itemIdx].extraValues = {};
  o.checklist[itemIdx].extraValues.backupDeviceNo = no;
  saveOrders(orders);
  openDetail(orderId);
}


// ─── Extras event handlers ────────────────────────────────────────────────────
function exclusiveSelectForm(btn, idx) {
  document.querySelectorAll(`#form-checklist-wrap .choice-btn[data-option][data-item="${idx}"]:not([data-exclusive])`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function formMediaTypeSelect(btn, idx) {
  document.querySelectorAll(`#form-checklist-wrap .choice-btn[data-media-type][data-item="${idx}"]`)
    .forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const noDiv = document.getElementById(`backup-no-form-${idx}`);
  if (noDiv) noDiv.style.display = btn.dataset.mediaType === '備品' ? '' : 'none';
  if (btn.dataset.mediaType !== '備品') {
    document.querySelectorAll(`#form-checklist-wrap .choice-btn[data-backup-no][data-item="${idx}"]`)
      .forEach(b => b.classList.remove('selected'));
  }
}

function formBackupNoSelect(btn, idx) {
  document.querySelectorAll(`#form-checklist-wrap .choice-btn[data-backup-no][data-item="${idx}"]`)
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
  openDetail(orderId);
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
      return html + renderExtrasForModal(item.extras, item, idx, orderId);
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

  const requiresNotification = document.getElementById('form-requires-notification').checked;

  const memberTypeBtn = document.querySelector('.member-btn.selected');
  const memberType    = memberTypeBtn ? memberTypeBtn.dataset.type : '';
  const memberNo      = ['青', 'SS等'].includes(memberType)
    ? document.getElementById('form-member-no').value.trim() : '';

  const checklist = WORK_ITEMS[selectedDevice].map((item, i) => {
    const cb = document.getElementById(`fci-${i}`);
    if (!cb || !cb.checked) return null;
    const selectedOptions = [...document.querySelectorAll(
      `#form-checklist-wrap .choice-btn[data-option][data-item="${i}"].selected:not([data-exclusive])`)]
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
      if (ex.type === 'apple_id_check') {
        const a = document.querySelector(`#form-checklist-wrap [data-extra="appleIdConfirmed"][data-item="${i}"]`);
        const f = document.querySelector(`#form-checklist-wrap [data-extra="faceToFace"][data-item="${i}"]`);
        if (a) extraValues.appleIdConfirmed = a.checked;
        if (f) extraValues.faceToFace = f.checked;
      }
      if (ex.type === 'account_2fa_check') {
        const a = document.querySelector(`#form-checklist-wrap [data-extra="accountConfirmed"][data-item="${i}"]`);
        const t = document.querySelector(`#form-checklist-wrap [data-extra="twoFaDestConfirmed"][data-item="${i}"]`);
        if (a) extraValues.accountConfirmed = a.checked;
        if (t) extraValues.twoFaDestConfirmed = t.checked;
      }
      if (ex.type === 'theft_protection_check') {
        const t = document.querySelector(`#form-checklist-wrap [data-extra="theftProtectionCleared"][data-item="${i}"]`);
        if (t) extraValues.theftProtectionCleared = t.checked;
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
      if (ex.type === 'data_full_check') {
        const mb = document.querySelector(`#form-checklist-wrap .choice-btn[data-media-type][data-item="${i}"].selected`);
        if (mb) extraValues.mediaType = mb.dataset.mediaType;
        const nb = document.querySelector(`#form-checklist-wrap .choice-btn[data-backup-no][data-item="${i}"].selected`);
        if (nb) extraValues.backupDeviceNo = nb.dataset.backupNo;
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
    requiresNotification,
    completionNotified: false,
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

// ─── 印刷 ─────────────────────────────────────────────────────────────────────
function printOrder(orderId) {
  const o = orders.find(x => x.id === orderId);
  if (!o) return;
  const win = window.open('', '_blank', 'width=900,height=1000');
  win.document.write(buildPrintHTML(o));
  win.document.close();
  win.addEventListener('load', () => { win.focus(); win.print(); });
}

function buildPrintHTML(o) {
  const allItems = WORK_ITEMS[o.device] || [];
  const checklistMap = {};
  (o.checklist || []).forEach(c => { checklistMap[c.name] = c; });

  const createdDate = o.createdAt ? new Date(o.createdAt).toLocaleDateString('ja-JP') : '—';

  function renderPrintDetail(item, ci) {
    if (!item.detail && !ci) return '';
    const parts = [];
    if (item.detail) {
      if (item.detail.includes(' / ')) {
        const sel = ci ? (ci.selectedOptions || []) : [];
        parts.push(item.detail.split(' / ').map(opt =>
          sel.includes(opt)
            ? `<span style="background:#ffff00;font-weight:bold;padding:0 2px">${opt}</span>`
            : `<span style="color:#bbb">${opt}</span>`
        ).join('<span style="color:#bbb"> / </span>'));
      } else if (/【[^】]*】/.test(item.detail)) {
        const vals = ci ? (ci.inputValues || []) : [];
        let n = 0;
        parts.push(item.detail.replace(/【[^】]*】/g, () => {
          const v = vals[n++] || '';
          return `【<u style="font-weight:bold;min-width:40px;display:inline-block">${v}</u>】`;
        }));
      } else {
        parts.push(item.detail);
      }
    }
    if (ci) {
      const ev = ci.extraValues || {};
      (item.extras || []).forEach(ex => {
        if (ex.type === 'sign_check') {
          parts.push(`${ev.signed ? '☑' : '☐'} サイン確認　${ev.staffChecked ? '☑' : '☐'} 社員チェック`);
        }
        if (ex.type === 'apple_id_check') {
          parts.push(`${ev.appleIdConfirmed ? '☑' : '☐'} Apple ID 確認済み　${ev.faceToFace ? '☑' : '☐'} 面前対応`);
        }
        if (ex.type === 'account_2fa_check') {
          parts.push(`${ev.accountConfirmed ? '☑' : '☐'} アカウント確認済み　${ev.twoFaDestConfirmed ? '☑' : '☐'} 2ファクタ送信先確認済み`);
        }
        if (ex.type === 'theft_protection_check') {
          parts.push(`${ev.theftProtectionCleared ? '☑' : '☐'} 盗難防止保護解除済み`);
        }
        if (ex.type === 'username_select' && ev.usernameMode) {
          const u = ev.usernameMode === '記述' ? `記述 (${ev.usernameText || ''})` : ev.usernameMode;
          parts.push(`ユーザー名: <strong>${u}</strong>`);
        }
        if (ex.type === 'mail_address') {
          Object.entries(ev.mailAddresses || {}).forEach(([t, a]) => {
            if (a) parts.push(`${t}: <strong>${a}</strong>`);
          });
        }
        if (ex.type === 'add_more') {
          (ev.addedItems || []).filter(v => v).forEach(v => parts.push(`・${v}`));
        }
        if (ex.type === 'data_transfer') {
          parts.push(`☐ データ抜き出し完了　☐ データ戻し完了`);
        }
        if (ex.type === 'backup_check') {
          parts.push(`☐ バックアップ済み`);
        }
        if (ex.type === 'data_full_check') {
          parts.push(`☐ データ抜き出し完了　☐ データ戻し完了　☐ バックアップ完了`);
        }
      });
    }
    return parts.join('<br>');
  }

  const rows = allItems.map(item => {
    const ci = checklistMap[item.name];
    const sel = !!ci;
    const staffName = ci?.itemStaff || (sel ? o.staff || '' : '');
    const doneAt = ci?.completedAt ? formatCompletedAt(ci.completedAt) : '';
    return `<tr class="${sel ? 'i-sel' : 'i-no'}">
      <td class="c-chk">☐</td>
      <td class="c-name">${item.name}</td>
      <td class="c-det">${renderPrintDetail(item, ci)}</td>
      <td class="c-stf">${staffName}</td>
      <td class="c-don">${doneAt}</td>
    </tr>`;
  }).join('');

  const customRows = (o.checklist || [])
    .filter(ci => !allItems.some(it => it.name === ci.name))
    .map(ci => `<tr class="i-sel i-cus">
      <td class="c-chk">☐</td>
      <td class="c-name">${ci.name} <small>※追加</small></td>
      <td class="c-det">${ci.detail || ''}</td>
      <td class="c-stf">${ci.itemStaff || o.staff || ''}</td>
      <td class="c-don">${ci.completedAt ? formatCompletedAt(ci.completedAt) : ''}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<title>作業票 - ${o.customerName}</title>
<style>
@page { size: A4 portrait; margin: 12mm 10mm; }
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Hiragino Sans','Meiryo','Yu Gothic',sans-serif;font-size:11px;color:#1e2a3a}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1a56db;padding-bottom:6px;margin-bottom:10px}
.hdr-l .shop{font-size:11px;color:#1a56db;font-weight:bold}
.hdr-l .ttl{font-size:20px;font-weight:bold;letter-spacing:.05em}
.hdr-r{font-size:10px;color:#666}
.ibox{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#ccc;border:1px solid #ccc;margin-bottom:10px}
.ic{background:#fff;padding:4px 7px}
.ic.s2{grid-column:span 2}.ic.s4{grid-column:span 4}
.il{font-size:9px;color:#888;margin-bottom:1px}
.iv{font-size:12px;font-weight:bold}
table{width:100%;border-collapse:collapse;font-size:10.5px}
thead th{background:#1a56db!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:5px 6px;text-align:left;font-size:10px;font-weight:bold}
.c-chk{width:22px;text-align:center;padding:4px 2px}
.c-name{width:25%;padding:4px 6px}
.c-det{padding:4px 6px}
.c-stf{width:9%;padding:4px 5px;color:#555;font-size:10px}
.c-don{width:12%;padding:4px 5px;color:#0d9e6e;font-size:9.5px;text-align:center}
.i-sel td{border-bottom:1px solid #e0e0e0;background:#fffde7}
.i-sel .c-name{font-weight:bold;color:#1e2a3a}
.i-no td{border-bottom:1px solid #f4f4f4;color:#ccc}
.i-no .c-name{color:#ccc}
.i-cus td{background:#f0fff4!important}
.ftr{margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sbox{border:1px solid #ccc;padding:6px 10px;min-height:52px}
.slbl{font-size:9px;color:#888;margin-bottom:2px}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>
<div class="hdr">
  <div class="hdr-l"><div class="shop">SLMC鎌ヶ谷BASE</div><div class="ttl">FC 作業票</div></div>
  <div class="hdr-r">登録日：${createdDate}</div>
</div>
<div class="ibox">
  <div class="ic s2"><div class="il">お客様名</div><div class="iv">${o.customerName} 様</div></div>
  <div class="ic"><div class="il">機種</div><div class="iv">${o.device}</div></div>
  <div class="ic"><div class="il">会員種別</div><div class="iv">${o.memberType || '—'}${o.memberNo ? ` (${o.memberNo})` : ''}</div></div>
  <div class="ic"><div class="il">納期</div><div class="iv">${formatDeadline(o.deadline)}</div></div>
  <div class="ic"><div class="il">作業者</div><div class="iv">${o.staff || '—'}</div></div>
  <div class="ic"><div class="il">担当者</div><div class="iv">${o.requester || '—'}</div></div>
  <div class="ic"><div class="il">場所</div><div class="iv">${o.lane || '—'}</div></div>
  <div class="ic"><div class="il">完了連絡</div><div class="iv">${o.completionNotified ? '済み' : '未'}</div></div>
  ${o.memo ? `<div class="ic s4"><div class="il">メモ・備考</div><div class="iv" style="font-weight:normal;white-space:pre-wrap">${o.memo}</div></div>` : ''}
</div>
<table>
  <thead><tr>
    <th class="c-chk">✓</th>
    <th class="c-name">作業項目</th>
    <th class="c-det">詳細・選択内容</th>
    <th class="c-stf">作業者</th>
    <th class="c-don">完了時刻</th>
  </tr></thead>
  <tbody>${rows}${customRows}</tbody>
</table>
<div class="ftr">
  <div class="sbox"><div class="slbl">お客様サイン</div></div>
  <div class="sbox"><div class="slbl">スタッフ確認</div></div>
</div>
</body></html>`;
}

// ─── Firebase 初期化 ──────────────────────────────────────────────────────────
(function initFirebase() {
  if (typeof firebase === 'undefined') return;
  if (!FIREBASE_CONFIG.apiKey) return;
  try {
    firebase.initializeApp(FIREBASE_CONFIG);
    const db = firebase.database();
    ordersRef = db.ref('fc_work_orders');

    // 接続状態の監視
    firebase.database().ref('.info/connected').on('value', snap => {
      setSyncStatus(snap.val() ? 'ok' : 'err');
    });

    // リアルタイム同期リスナー
    // Firebase を正（source of truth）とする。リモートの内容をそのまま採用し、
    // ローカルデータの自動再アップロードは行わない（行うと他端末での削除が復活するため）。
    // localStorage はオフライン表示用のキャッシュとしてのみ使用する。
    ordersRef.on('value', snapshot => {
      const data = snapshot.val();
      orders = Array.isArray(data) ? data : [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
      render();
    });

    // PC診断処方箋（点検結果）を読み込み、紐づけ表示に使う
    db.ref('pc_prescriptions').on('value', snap => {
      prescriptions = snap.val() || {};
      if (currentDetailId) {
        const o = orders.find(x => x.id === currentDetailId);
        if (o) renderPrescriptionLink(o);
      }
    });
  } catch(e) {
    console.warn('Firebase接続エラー（オフラインモード）:', e);
    setSyncStatus('err');
  }
})();

// ─── Initial render ───────────────────────────────────────────────────────────
render();
