'use strict';

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  メーカー修理管理モジュール                                                  ║
// ║  作業登録（main.js）とは独立したデータ・登録メニュー・ダッシュボード表示       ║
// ╚══════════════════════════════════════════════════════════════════════════╝

// ─── 定数 ──────────────────────────────────────────────────────────────────
const REPAIR_STORAGE_KEY = 'fc_maker_repairs';

// メーカー（（）内はメーカー識別番号。選択肢には表示するがダッシュボードには出さない）
const MAKERS = [
  { name: '富士通', code: '95' },
  { name: 'NEC', code: '26' },
  { name: 'Lenovo', code: '38' },
  { name: 'Canon', code: '39' },
  { name: 'EPSON', code: '28' },
  { name: 'Apple', code: '908' },
];
const MAKER_OTHER = '__other__';

// 修理種別
const REPAIR_TYPES = ['通常修理', 'メーカー保証', '延長保証', 'その他'];

// 状態（進行順）
const REPAIR_STATUSES = [
  '伝票作成済み',
  'メーカーFAX済み',
  '発送済み',
  '見積もり到着',
  '見積もり連絡済み',
  'メーカーへのFAX済み',
  '商品入荷済み',
  '仕入れ済み',
  'お客様連絡済み',
];

// ─── ストレージ ────────────────────────────────────────────────────────────
let repairsRef = null;

function loadRepairs() {
  try { return JSON.parse(localStorage.getItem(REPAIR_STORAGE_KEY)) || []; }
  catch { return []; }
}
function saveRepairs(list) {
  localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(list));
  if (repairsRef) repairsRef.set(list);
}

let repairs = loadRepairs();
let repairShowDone = false;

// ─── 表示ヘルパー ──────────────────────────────────────────────────────────
function repairTypeLabel(r) {
  if (r.repairType === 'その他') return r.repairTypeOther ? `その他：${r.repairTypeOther}` : 'その他';
  return r.repairType || '—';
}
function repairTypeBadge(r) {
  const map = { '通常修理': 'rt-normal', 'メーカー保証': 'rt-warranty', '延長保証': 'rt-ext', 'その他': 'rt-other' };
  return `<span class="badge ${map[r.repairType] || 'rt-other'}">${escHtml(repairTypeLabel(r))}</span>`;
}
function repairMemberLabel(r) {
  if (!r.memberType) return '—';
  return r.memberType + (r.memberNo ? `（${r.memberNo}）` : '');
}
function repairDeviceCell(r) {
  const model = (r.model || '').trim();
  const maker = (r.maker || '').trim();
  const serial = (r.serial || '').trim();
  if (!model && !maker && !serial) return '<span style="color:var(--text-muted)">—</span>';
  const main = model
    ? `<div class="repair-dev-model">${escHtml(model)}</div>`
    : '';
  const sub = [maker, serial ? `S/N: ${serial}` : '']
    .filter(Boolean).map(escHtml).join(' ・ ');
  const subLine = sub ? `<div class="repair-dev-sub">${sub}</div>` : '';
  // 機種名が空でメーカーのみの場合はメーカーを主表示に
  if (!model && maker) {
    return `<div class="repair-dev-model">${escHtml(maker)}</div>` +
      (serial ? `<div class="repair-dev-sub">S/N: ${escHtml(serial)}</div>` : '');
  }
  return main + subLine;
}
function formatYen(amount) {
  if (amount === '' || amount === null || amount === undefined || isNaN(amount)) return '—';
  return Number(amount).toLocaleString('ja-JP') + ' 円';
}
function formatHandover(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return dateStr;
  return `${d.getMonth() + 1}/${d.getDate()}(${['日','月','火','水','木','金','土'][d.getDay()]})`;
}
function handoverClass(dateStr, done) {
  if (!dateStr || done) return '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  const diff = (d - today) / 864e5; // days
  if (diff < 0) return 'deadline-over';
  if (diff <= 1) return 'deadline-near';
  return '';
}

// 数字以外を弾く（見積もり金額用）
function sanitizeAmount(str) {
  return String(str).replace(/[^0-9]/g, '');
}

// ─── 状態の進捗（どこまで完了したか）ヘルパー ─────────────────────────────────
// statusStep = 完了した工程数（0〜9）。旧データ（status文字列のみ）からも算出。
function getRepairStep(r) {
  if (typeof r.statusStep === 'number') {
    return Math.max(0, Math.min(REPAIR_STATUSES.length, r.statusStep));
  }
  const idx = REPAIR_STATUSES.indexOf(r.status);
  return idx >= 0 ? idx + 1 : 0;
}
// レコードに進捗を反映（status文字列も同期）
function applyRepairStep(r, step) {
  step = Math.max(0, Math.min(REPAIR_STATUSES.length, step));
  r.statusStep = step;
  r.status = step > 0 ? REPAIR_STATUSES[step - 1] : '';
}
// ダッシュボード用：完了工程をセグメントで表示（クリックで変更可）
function repairStepperHTML(r) {
  const step = getRepairStep(r);
  const total = REPAIR_STATUSES.length;
  const segs = REPAIR_STATUSES.map((s, i) =>
    `<button type="button" class="rep-seg${i < step ? ' done' : ''}" title="${escAttr((i + 1) + '. ' + s)}"
      onclick="event.stopPropagation(); clickRepairStep('${r.id}', ${i})"></button>`
  ).join('');
  const label = step > 0 ? REPAIR_STATUSES[step - 1] : '未着手';
  const done = step === total;
  return `<div class="rep-stepper">
    <div class="rep-seg-row">${segs}</div>
    <div class="rep-step-label${done ? ' all-done' : ''}">${escHtml(label)}
      <span class="rep-step-count">(${step}/${total})</span></div>
  </div>`;
}
function clickRepairStep(id, i) {
  const r = repairs.find(x => x.id === id);
  if (!r) return;
  const cur = getRepairStep(r);
  // 最上段の完了工程をクリック → 1つ戻す。それ以外 → その工程まで完了に。
  const target = (cur === i + 1) ? i : (i + 1);
  applyRepairStep(r, target);
  saveRepairs(repairs);
  renderRepairs();
}

// ─── 統計・ダッシュボード描画 ────────────────────────────────────────────────
function renderRepairStats() {
  const el = document.getElementById('stat-repair');
  if (!el) return;
  const active = repairs.filter(r => !r.done).length;
  el.textContent = active;
  el.className = 'stat-value' + (active > 0 ? '' : ' ok');
}

function renderRepairTable() {
  const tbody = document.getElementById('repair-tbody');
  const countEl = document.getElementById('repair-section-count');
  if (!tbody) return;

  const list = repairs
    .filter(r => repairShowDone ? r.done : !r.done)
    .sort((a, b) => {
      const va = a.handoverDate || '9999-99-99';
      const vb = b.handoverDate || '9999-99-99';
      return va < vb ? -1 : va > vb ? 1 : 0;
    });

  if (countEl) countEl.textContent = repairs.filter(r => !r.done).length;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9">
      <div class="empty-state">
        <div class="icon">🔧</div>
        <p>${repairShowDone ? 'お渡し済みのメーカー修理はありません。' : '現在メーカー修理中の項目はありません。'}</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(r => {
    const hoCls = handoverClass(r.handoverDate, r.done);
    const doneCell = r.done
      ? `<button class="btn-repair-reopen" onclick="event.stopPropagation(); reopenRepair('${r.id}')">↩ 戻す</button>`
      : `<button class="btn-repair-done" onclick="event.stopPropagation(); completeRepair('${r.id}')">✅ お渡し</button>`;

    return `<tr onclick="openRepairDetail('${r.id}')">
      <td><strong>${escHtml(r.customerName)} 様</strong></td>
      <td>${repairDeviceCell(r)}</td>
      <td>${escHtml(repairMemberLabel(r))}</td>
      <td>${escHtml(r.requester || '—')}</td>
      <td>${repairTypeBadge(r)}</td>
      <td onclick="event.stopPropagation()">${repairStepperHTML(r)}</td>
      <td class="repair-amount">${formatYen(r.estimateAmount)}</td>
      <td onclick="event.stopPropagation()">
        <input type="date" class="repair-inline-date ${hoCls}" value="${escAttr(r.handoverDate || '')}"
          onchange="updateRepairHandover('${r.id}', this.value)">
      </td>
      <td onclick="event.stopPropagation()">${doneCell}</td>
    </tr>`;
  }).join('');
}

function renderRepairs() {
  renderRepairStats();
  renderRepairTable();
}

// ─── ダッシュボードからの直接変更 ─────────────────────────────────────────────
function updateRepairHandover(id, value) {
  const r = repairs.find(x => x.id === id);
  if (!r) return;
  r.handoverDate = value;
  saveRepairs(repairs);
  renderRepairs();
}
function completeRepair(id) {
  const r = repairs.find(x => x.id === id);
  if (!r) return;
  r.done = true;
  r.doneAt = new Date().toISOString();
  saveRepairs(repairs);
  renderRepairs();
}
function reopenRepair(id) {
  const r = repairs.find(x => x.id === id);
  if (!r) return;
  r.done = false;
  r.doneAt = null;
  saveRepairs(repairs);
  renderRepairs();
}

// 完了表示トグル
function toggleRepairShowDone() {
  repairShowDone = !repairShowDone;
  const btn = document.getElementById('btn-repair-toggle-done');
  if (btn) {
    btn.classList.toggle('active', repairShowDone);
    btn.textContent = repairShowDone ? '🔧 修理中を表示' : '📦 お渡し済みを表示';
  }
  renderRepairTable();
}

// ─── 登録モーダル ─────────────────────────────────────────────────────────
let repairEditingId = null; // null=新規, それ以外=編集
let repairFormStep = 0;     // モーダル内の状態チェック（完了工程数）

function selectRepairMemberType(btn) {
  document.querySelectorAll('#overlay-repair .member-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const needsNo = ['青', 'SS等'].includes(btn.dataset.type);
  document.getElementById('repair-member-no-wrap').style.display = needsNo ? '' : 'none';
  if (!needsNo) document.getElementById('repair-member-no').value = '';
}

function selectRepairType(btn) {
  document.querySelectorAll('#overlay-repair .repair-type-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  const isOther = btn.dataset.type === 'その他';
  document.getElementById('repair-type-other-wrap').style.display = isOther ? '' : 'none';
  if (!isOther) document.getElementById('repair-type-other').value = '';
}

// モーダル内：状態チェックリスト（完了した工程をチェック）
function renderRepairStatusChecklist() {
  const wrap = document.getElementById('repair-status-checklist');
  if (!wrap) return;
  const total = REPAIR_STATUSES.length;
  wrap.innerHTML = REPAIR_STATUSES.map((s, i) => {
    const done = i < repairFormStep;
    return `<label class="rep-check${done ? ' done' : ''}">
      <input type="checkbox" ${done ? 'checked' : ''} onchange="onRepairStatusCheck(${i}, this.checked)">
      <span class="step-num">${i + 1}</span>
      <span class="step-text">${escHtml(s)}</span>
    </label>`;
  }).join('') +
  `<div class="rep-check-foot">完了：${repairFormStep}/${total} 工程</div>`;
}
function onRepairStatusCheck(i, checked) {
  // チェック → その工程まで完了。チェック解除 → その工程の手前まで。
  repairFormStep = checked ? i + 1 : i;
  renderRepairStatusChecklist();
}

function populateMakerSelect() {
  const sel = document.getElementById('repair-maker');
  if (!sel) return;
  sel.innerHTML = '<option value="">選択してください</option>' +
    MAKERS.map(m => `<option value="${escAttr(m.name)}">${escHtml(m.name)}（${escHtml(m.code)}）</option>`).join('') +
    `<option value="${MAKER_OTHER}">その他 入力</option>`;
}

function onRepairMakerChange() {
  const sel = document.getElementById('repair-maker');
  const other = document.getElementById('repair-maker-other');
  if (!sel || !other) return;
  const isOther = sel.value === MAKER_OTHER;
  other.style.display = isOther ? '' : 'none';
  if (!isOther) other.value = '';
}

// 編集時：保存済みメーカー名からプルダウン/自由入力欄を復元
function setMakerFields(makerName) {
  populateMakerSelect();
  const sel = document.getElementById('repair-maker');
  const other = document.getElementById('repair-maker-other');
  if (!sel || !other) return;
  const known = MAKERS.some(m => m.name === makerName);
  if (makerName && !known) {
    sel.value = MAKER_OTHER;
    other.style.display = '';
    other.value = makerName;
  } else {
    sel.value = makerName || '';
    other.style.display = 'none';
    other.value = '';
  }
}

// 入力中のメーカー名・識別番号を取得
function readMakerInput() {
  const sel = document.getElementById('repair-maker');
  if (!sel) return { maker: '', makerCode: '' };
  if (sel.value === MAKER_OTHER) {
    return { maker: document.getElementById('repair-maker-other').value.trim(), makerCode: '' };
  }
  const m = MAKERS.find(x => x.name === sel.value);
  return { maker: sel.value, makerCode: m ? m.code : '' };
}

function populateRepairRequesterSelect() {
  const sel = document.getElementById('repair-requester');
  if (!sel || typeof STAFF === 'undefined') return;
  sel.innerHTML = '<option value="">選択してください</option>' +
    STAFF.map(n => `<option value="${escAttr(n)}">${escHtml(n)}</option>`).join('');
}

function openRepairForm() {
  repairEditingId = null;
  document.getElementById('repair-modal-title').textContent = 'メーカー修理登録';
  document.getElementById('repair-submit-label').textContent = '✅ 登録する';
  document.getElementById('repair-customer').value = '';
  document.querySelectorAll('#overlay-repair .member-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('repair-member-no-wrap').style.display = 'none';
  document.getElementById('repair-member-no').value = '';
  setMakerFields('');
  document.getElementById('repair-model').value = '';
  document.getElementById('repair-serial').value = '';
  populateRepairRequesterSelect();
  document.getElementById('repair-requester').value = '';
  document.querySelectorAll('#overlay-repair .repair-type-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('repair-type-other-wrap').style.display = 'none';
  document.getElementById('repair-type-other').value = '';
  repairFormStep = 1; // 初期＝「伝票作成済み」まで完了
  renderRepairStatusChecklist();
  document.getElementById('repair-amount').value = '';
  document.getElementById('repair-handover').value = '';
  document.getElementById('repair-memo').value = '';
  document.getElementById('repair-customer-error').classList.remove('show');
  document.getElementById('repair-delete-btn').style.display = 'none';
  document.getElementById('overlay-repair').classList.add('open');
}

function openRepairDetail(id) {
  const r = repairs.find(x => x.id === id);
  if (!r) return;
  repairEditingId = id;
  document.getElementById('repair-modal-title').textContent = 'メーカー修理 編集';
  document.getElementById('repair-submit-label').textContent = '💾 保存する';
  document.getElementById('repair-customer').value = r.customerName || '';

  document.querySelectorAll('#overlay-repair .member-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.type === r.memberType);
  });
  const needsNo = ['青', 'SS等'].includes(r.memberType);
  document.getElementById('repair-member-no-wrap').style.display = needsNo ? '' : 'none';
  document.getElementById('repair-member-no').value = r.memberNo || '';
  setMakerFields(r.maker || '');
  document.getElementById('repair-model').value = r.model || '';
  document.getElementById('repair-serial').value = r.serial || '';

  populateRepairRequesterSelect();
  document.getElementById('repair-requester').value = r.requester || '';

  document.querySelectorAll('#overlay-repair .repair-type-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.type === r.repairType);
  });
  const isOther = r.repairType === 'その他';
  document.getElementById('repair-type-other-wrap').style.display = isOther ? '' : 'none';
  document.getElementById('repair-type-other').value = r.repairTypeOther || '';

  repairFormStep = getRepairStep(r);
  renderRepairStatusChecklist();
  document.getElementById('repair-amount').value = (r.estimateAmount === '' || r.estimateAmount == null) ? '' : r.estimateAmount;
  document.getElementById('repair-handover').value = r.handoverDate || '';
  document.getElementById('repair-memo').value = r.memo || '';
  document.getElementById('repair-customer-error').classList.remove('show');
  document.getElementById('repair-delete-btn').style.display = '';
  document.getElementById('overlay-repair').classList.add('open');
}

function closeRepairForm() {
  document.getElementById('overlay-repair').classList.remove('open');
}

function submitRepair() {
  const name = document.getElementById('repair-customer').value.trim();
  const err = document.getElementById('repair-customer-error');
  if (!name) { err.classList.add('show'); document.getElementById('repair-customer').focus(); return; }
  err.classList.remove('show');

  const memberBtn = document.querySelector('#overlay-repair .member-btn.selected');
  const memberType = memberBtn ? memberBtn.dataset.type : '';
  const memberNo = ['青', 'SS等'].includes(memberType)
    ? document.getElementById('repair-member-no').value.trim() : '';

  const { maker, makerCode } = readMakerInput();
  const model = document.getElementById('repair-model').value.trim();
  const serial = document.getElementById('repair-serial').value.trim();

  const requester = document.getElementById('repair-requester').value;

  const typeBtn = document.querySelector('#overlay-repair .repair-type-btn.selected');
  const repairType = typeBtn ? typeBtn.dataset.type : '';
  const repairTypeOther = repairType === 'その他'
    ? document.getElementById('repair-type-other').value.trim() : '';

  const statusStep = repairFormStep;
  const status = statusStep > 0 ? REPAIR_STATUSES[statusStep - 1] : '';
  const estimateAmount = sanitizeAmount(document.getElementById('repair-amount').value);
  const handoverDate = document.getElementById('repair-handover').value;
  const memo = document.getElementById('repair-memo').value.trim();

  if (repairEditingId) {
    const r = repairs.find(x => x.id === repairEditingId);
    if (r) {
      Object.assign(r, {
        customerName: name, memberType, memberNo,
        maker, makerCode, model, serial, requester,
        repairType, repairTypeOther, status, statusStep,
        estimateAmount: estimateAmount === '' ? '' : Number(estimateAmount),
        handoverDate, memo,
      });
    }
  } else {
    repairs.unshift({
      id: genId(),
      customerName: name,
      memberType, memberNo,
      maker, makerCode, model, serial, requester,
      repairType, repairTypeOther, status, statusStep,
      estimateAmount: estimateAmount === '' ? '' : Number(estimateAmount),
      handoverDate, memo,
      done: false,
      doneAt: null,
      createdAt: new Date().toISOString(),
    });
  }

  saveRepairs(repairs);
  renderRepairs();
  closeRepairForm();
}

function deleteRepair() {
  if (!repairEditingId) return;
  const r = repairs.find(x => x.id === repairEditingId);
  if (!r) return;
  if (!confirm(`「${r.customerName}」様のメーカー修理を削除しますか？`)) return;
  repairs = repairs.filter(x => x.id !== repairEditingId);
  saveRepairs(repairs);
  renderRepairs();
  closeRepairForm();
}

// ─── イベント登録 ─────────────────────────────────────────────────────────
function initRepairUI() {
  const amountInput = document.getElementById('repair-amount');
  if (amountInput) {
    amountInput.addEventListener('input', function () {
      const v = sanitizeAmount(this.value);
      if (this.value !== v) this.value = v;
    });
  }
  const overlay = document.getElementById('overlay-repair');
  if (overlay) {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeRepairForm(); });
  }
}

// ─── Firebase 同期 ───────────────────────────────────────────────────────────
function initRepairFirebase() {
  if (typeof firebase === 'undefined') return;
  if (!firebase.apps || !firebase.apps.length) return; // main.js が初期化済みか確認
  try {
    repairsRef = firebase.database().ref('fc_maker_repairs');
    // Firebase を正（source of truth）とする。リモートの内容をそのまま採用し、
    // ローカルデータの自動再アップロードは行わない（行うと他端末での削除が復活するため）。
    // localStorage はオフライン表示用のキャッシュとしてのみ使用する。
    repairsRef.on('value', snapshot => {
      const data = snapshot.val();
      repairs = Array.isArray(data) ? data : [];
      localStorage.setItem(REPAIR_STORAGE_KEY, JSON.stringify(repairs));
      renderRepairs();
    });
  } catch (e) {
    console.warn('メーカー修理 Firebase接続エラー（オフラインモード）:', e);
  }
}

// ─── 起動 ─────────────────────────────────────────────────────────────────
initRepairUI();
renderRepairStatusChecklist();
populateMakerSelect();
initRepairFirebase();
renderRepairs();
