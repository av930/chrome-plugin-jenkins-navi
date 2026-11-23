'use strict';

// Jenkins job config compare page.
// 두 job의 <job>/configure 페이지 DOM을 읽어 항목 단위로 정렬/비교한다.

const { extractEntries, controlValue, readRaw } = JobConfigExtract;
const MISSING_TEXT = '— 없음 —';
const MAX_DP_CELLS = 25e6;

const $ = (id) => document.getElementById(id);

// ========== Fetch & parse ==========

// job URL(/job/A/job/B/..., build 번호나 configure가 붙어 있어도 됨)에서 job root를 뽑는다.
function toJobUrls(raw) {
  const m = raw.trim().match(/^(https?:\/\/.*?\/job\/[^/?#]+(?:\/job\/[^/?#]+)*)/);
  if (!m) throw new Error(`job URL 형식이 아닙니다: ${raw}`);
  return { jobUrl: `${m[1]}/`, configUrl: `${m[1]}/configure` };
}

function jobDisplayName(jobUrl) {
  return (jobUrl.match(/\/job\/[^/]+/g) || []).map((s) => decodeURIComponent(s.slice(5))).join(' / ');
}

// 지정한 scheme으로 실패하면 반대 scheme으로 한 번 더 시도한다 (run dialog가 http를 강제하는 것과 별개로 입력값 그대로 존중).
async function fetchConfigDoc(configUrl) {
  const alt = /^https:/i.test(configUrl) ? configUrl.replace(/^https:/i, 'http:') : configUrl.replace(/^http:/i, 'https:');
  const errors = [];
  for (const url of [configUrl, alt]) {
    try {
      const resp = await fetch(url, { credentials: 'include', cache: 'no-store' }); // 저장 후 다시 읽을 때 cache 사용 금지
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const doc = new DOMParser().parseFromString(await resp.text(), 'text/html');
      if (!doc.querySelector('form[name="config"]')) throw new Error('configure form을 찾지 못함 (로그인/권한 확인)');
      return { doc, url };
    } catch (e) {
      errors.push(`${url} → ${e.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function loadJob(raw) {
  const { jobUrl, configUrl } = toJobUrls(raw);
  const { doc, url } = await fetchConfigDoc(configUrl);
  return { name: jobDisplayName(jobUrl), configUrl: url, doc, entries: extractEntries(doc) };
}

// ========== Alignment (LCS) ==========

// a, b 의 일치 구간을 LCS로 정렬. 결과는 [i, j] 목록이며 한쪽이 없으면 -1.
function alignSeq(a, b) {
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let ea = a.length;
  let eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; }

  const out = [];
  for (let k = 0; k < s; k++) out.push([k, k]);

  const n = ea - s;
  const m = eb - s;
  if (n * m > MAX_DP_CELLS) {
    // 너무 큰 diff: 중간 구간은 통째로 교체로 처리
    for (let i = 0; i < n; i++) out.push([s + i, -1]);
    for (let j = 0; j < m; j++) out.push([-1, s + j]);
  } else {
    const w = m + 1;
    const dp = new Uint16Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] = a[s + i] === b[s + j]
          ? dp[(i + 1) * w + j + 1] + 1
          : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[s + i] === b[s + j]) { out.push([s + i, s + j]); i++; j++; }
      else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { out.push([s + i, -1]); i++; }
      else { out.push([-1, s + j]); j++; }
    }
    while (i < n) out.push([s + i++, -1]);
    while (j < m) out.push([-1, s + j++]);
  }

  for (let k = 0; k < a.length - ea; k++) out.push([ea + k, eb + k]);
  return out;
}

// 줄 단위 정렬: 일치하지 않는 연속 구간은 위치별로 짝지어 "수정된 줄"로 취급
function alignLines(a, b) {
  const out = [];
  let dels = [];
  let ins = [];
  const flush = () => {
    const n = Math.max(dels.length, ins.length);
    for (let k = 0; k < n; k++) out.push([k < dels.length ? dels[k] : -1, k < ins.length ? ins[k] : -1]);
    dels = [];
    ins = [];
  };
  for (const [i, j] of alignSeq(a, b)) {
    if (i >= 0 && j >= 0) { flush(); out.push([i, j]); }
    else if (i >= 0) dels.push(i);
    else ins.push(j);
  }
  flush();
  return out;
}

// 공통 prefix/suffix 길이 (겹치지 않게)
function commonAffix(a, b) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { p, s };
}

// ========== Rendering ==========

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// text에서 [p, len-s) 구간을 차이로 highlight
function appendHighlighted(parent, text, p, s) {
  const end = text.length - s;
  if (p > 0) parent.append(text.slice(0, p));
  if (end > p) parent.append(el('span', 'chg', text.slice(p, end)));
  if (s > 0) parent.append(text.slice(end));
}

// 값 text를 parent에 채운다. other: 반대편 text(없으면 null), differs: 차이 여부
function fillValue(parent, text, other, differs) {
  if (text === '') parent.classList.add('empty');
  if (!differs) { parent.textContent = text; return; }
  if (other === null) { appendHighlighted(parent, text, 0, 0); return; }
  const { p, s } = commonAffix(text, other);
  appendHighlighted(parent, text, p, s);
}

function missingCell(side, label) {
  const cell = el('div', `cell ${side} missing`);
  if (label !== undefined) cell.append(el('div', 'lbl', label));
  cell.append(el('div', 'val', label !== undefined ? MISSING_TEXT : ''));
  return cell;
}

function makeRow(cls, leftCell, rightCell) {
  const row = el('div', `row ${cls}`.trim());
  row.append(leftCell, rightCell);
  return row;
}

function renderHeader(L, R) {
  const level = (L || R).level;
  const diff = !(L && R);
  const cellOf = (side, e) => {
    if (!e) return missingCell(side);
    const cell = el('div', `cell ${side}`);
    cell.style.paddingLeft = `${12 + e.level * 16}px`;
    cell.append(el('div', 'val', e.title));
    return cell;
  };
  const row = makeRow(`hdr lvl${Math.min(level, 3)}${diff ? ' has-diff' : ''}`, cellOf('left', L), cellOf('right', R));
  const grp = el('div', 'grp');
  grp.append(row);
  return { grp, diff, level };
}

function itemDiffers(L, R) {
  if (L && R) return L.value !== R.value;
  return !(L || R).blank;
}

function renderItem(L, R) {
  const differs = itemDiffers(L, R);
  const grp = el('div', 'grp');
  if (differs) grp.classList.add('has-diff');
  const label = (L || R).label;

  const multiline = L && R && differs && (L.value.includes('\n') || R.value.includes('\n'));
  if (multiline) {
    // 항목명 행 + 줄 단위 정렬 행
    const head = (side) => {
      const cell = el('div', `cell ${side}`);
      cell.append(el('div', 'lbl', label));
      return cell;
    };
    grp.append(makeRow('has-diff', head('left'), head('right')));
    const la = L.value.split('\n');
    const lb = R.value.split('\n');
    for (const [i, j] of alignLines(la, lb)) {
      const lineDiff = i < 0 || j < 0 || la[i] !== lb[j];
      const lineCell = (side, idx, text, other) => {
        if (idx < 0) return missingCell(side);
        const cell = el('div', `cell ${side}`);
        cell.append(el('div', 'ln', String(idx + 1)));
        const v = el('div', 'val');
        fillValue(v, text, other, lineDiff);
        cell.append(v);
        return cell;
      };
      const lt = i >= 0 ? la[i] : null;
      const rt = j >= 0 ? lb[j] : null;
      grp.append(makeRow(`line ${lineDiff ? 'has-diff' : 'same'}`, lineCell('left', i, lt, rt), lineCell('right', j, rt, lt)));
    }
    return { grp, diff: true, level: null };
  }

  const cellOf = (side, e, other) => {
    if (!e) return missingCell(side, label);
    const cell = el('div', `cell ${side}`);
    cell.append(el('div', 'lbl', label));
    const v = el('div', 'val');
    fillValue(v, e.value, other ? other.value : null, differs);
    cell.append(v);
    return cell;
  };
  grp.append(makeRow(differs ? 'has-diff' : '', cellOf('left', L, R), cellOf('right', R, L)));
  return { grp, diff: differs, level: null };
}

function render(a, b) {
  const grid = $('grid');
  const groups = [];
  const pairs = alignSeq(a.entries.map((e) => e.key), b.entries.map((e) => e.key));
  for (const [i, j] of pairs) {
    const L = i >= 0 ? a.entries[i] : null;
    const R = j >= 0 ? b.entries[j] : null;
    groups.push((L || R).kind === 'header' ? renderHeader(L, R) : renderItem(L, R));
  }

  // 차이만 보기: 하위에 차이가 있는 header는 유지
  groups.forEach((g, idx) => {
    if (g.level === null || g.diff) return;
    for (let k = idx + 1; k < groups.length && (groups[k].level === null || groups[k].level > g.level); k++) {
      if (groups[k].diff) { g.grp.classList.add('has-diff'); return; }
    }
  });
  groups.forEach((g) => {
    if (g.diff) { g.grp.classList.add('has-diff'); g.grp.dataset.diff = '1'; }
    grid.append(g.grp);
  });

  const diffCount = groups.filter((g) => g.diff).length;
  const badge = $('diffCount');
  badge.textContent = diffCount ? `차이 ${diffCount}건` : '차이 없음';
  badge.classList.add(diffCount ? 'has-diff' : 'no-diff');
  const status = $('status');
  status.textContent = `${a.entries.length} / ${b.entries.length} entries`;
  status.classList.add('ok');
  compared = { a, b, pairs };
  document.querySelectorAll('input[name="viewMode"]').forEach((r) => { r.disabled = false; });
  setMode(currentMode());
  $('nextDiff').disabled = $('prevDiff').disabled = !diffCount;
}

// ========== View mode ==========
// raw: Jenkins 원문 형식 / table: 전체 entry 표 / diff: 차이 난 entry만 표

function currentMode() {
  return document.querySelector('input[name="viewMode"]:checked').value;
}

function setMode(mode) {
  navState = null;
  const raw = mode === 'raw';
  $('scroller').hidden = raw;
  $('rawView').hidden = !raw;
  $('grid').classList.toggle('only-diff', mode === 'diff');
  $('saveLeft').hidden = $('saveRight').hidden = !raw; // 편집은 원문 view에서만 가능
  $('saveLeft').disabled = $('saveRight').disabled = !compared || saving;
  if (raw && !rawBuilt) buildRawView(); // iframe이 보이는 상태에서 build
}

// ========== Raw (original layout) view ==========

let compared = null; // render() 결과: 원문 view가 같은 정렬/차이 판정을 재사용
let rawBuilt = false;
let rawDiffs = []; // 원문 view의 차이 항목: [left element | null, right element | null]

// iframe 안 원문 page에 주입: Jenkins 공통 chrome을 숨기고 차이 highlight style을 제공
const RAW_CSS = `
#side-panel, #page-head, #breadcrumbBar, #footer, #bottom-sticker, .bottom-sticker { display: none !important; }
/* Jenkins는 JS가 끝나면 "불러오는 중" overlay를 제거한다. JS를 실행하지 않으므로 직접 숨긴다. */
html .behavior-loading { display: none !important; }
#main-panel { margin: 0 !important; padding: 8px 16px !important; }
.cmp-diff { background: #fff176 !important; color: #d50000 !important; outline: 2px solid #ff9800 !important; }
.cmp-wrap { width: 100%; }
.cmp-ta { box-sizing: border-box; width: 100%; border: 1px solid #aaa; background: #fff; overflow-x: scroll; font: 12px/1.4 Consolas, 'Courier New', monospace; cursor: text; }
/* diff block을 click해 편집 중인 textarea: block과 같은 글꼴·줄 높이·여백으로 줄 위치를 맞춘다 */
textarea.cmp-editing { box-sizing: border-box !important; width: 100% !important; min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 4px !important; border: 1px solid #aaa !important; border-radius: 0 !important; background: #fff !important; color: #000 !important; white-space: pre !important; overflow: auto !important; resize: none !important; font: 12px/1.4 Consolas, 'Courier New', monospace !important; }
.cmp-ln { white-space: pre; min-height: 1.4em; padding: 0 4px; }
.cmp-ln.cmp-chg { background: #fff8c4; }
.cmp-ln.cmp-gap { background: repeating-linear-gradient(45deg, #fff 0 6px, #ddd 6px 12px); }
.chg { background: #ffeb3b; color: #d50000; font-weight: 700; }
`;

// fetch한 원문 DOM(entries가 참조하는 element 그대로)을 iframe document로 옮긴다.
// script는 제거(실행 안 함), 상대경로 css/image는 Jenkins 주소 기준으로 로드.
function mountDoc(frame, job) {
  const src = job.doc;
  src.querySelectorAll('script').forEach((s) => s.remove());
  const base = src.createElement('base');
  base.href = job.configUrl;
  base.target = '_blank';
  src.head.prepend(base);
  const style = src.createElement('style');
  style.textContent = RAW_CSS;
  src.head.append(style);

  const idoc = frame.contentDocument;
  idoc.replaceChild(idoc.adoptNode(src.documentElement), idoc.documentElement);
  idoc.querySelectorAll('form').forEach((f) => f.addEventListener('submit', (e) => e.preventDefault()));
}

function markEntry(e, other) {
  if (e.el.type === 'hidden') return; // 화면에 보이지 않는 type 정보
  e.el.classList.add('cmp-diff');
  if (e.labelEl) e.labelEl.classList.add('cmp-diff');
  if (e.kind === 'item') e.el.title = other ? `반대쪽 값: ${other.value}` : '반대쪽에 없는 항목';
}

// 값이 다른 여러 줄 textarea: 원래 textarea 자리에 줄 단위로 정렬한 diff block을 보여준다(두 pane의 block은 줄 수가 같아 align 유지).
// block을 click하면 같은 자리·같은 높이의 textarea로 바꿔 편집하고, focus가 빠지면 diff를 다시 계산해 block으로 돌아간다.
// 값이 같아지면 block 없이 textarea만 보인다.
function diffTextareas(L, R) {
  const sides = [L, R].map((entry) => {
    const ta = entry.el;
    const wrap = el('div', 'cmp-wrap');
    const box = el('div', 'cmp-ta');
    box.title = 'click하여 편집';
    ta.before(wrap);
    wrap.append(box, ta);
    entry.anchor = wrap; // 편집 모드와 관계없이 보이는 element를 scroll/diff 이동 기준으로 쓴다
    return { ta, box, editing: false };
  });
  const show = (side, differs) => {
    side.box.hidden = !differs || side.editing;
    side.ta.style.display = differs && !side.editing ? 'none' : '';
  };
  const rebuild = () => {
    const [lv, rv] = sides.map((side) => controlValue(side.ta, 'textarea'));
    sides.forEach((side) => { side.box.textContent = ''; show(side, lv !== rv); });
    if (lv === rv) return;
    const la = lv.split('\n');
    const lb = rv.split('\n');
    for (const [i, j] of alignLines(la, lb)) {
      const lt = i >= 0 ? la[i] : null;
      const rt = j >= 0 ? lb[j] : null;
      const differs = lt !== rt;
      for (const [box, text, other] of [[sides[0].box, lt, rt], [sides[1].box, rt, lt]]) {
        const ln = el('div', 'cmp-ln');
        if (text === null) ln.classList.add('cmp-gap');
        else {
          if (differs) ln.classList.add('cmp-chg');
          fillValue(ln, text, other, differs);
        }
        box.append(ln);
      }
    }
  };
  // click한 줄에 caret을 두고, 그 줄이 화면의 같은 위치에 오도록 textarea를 scroll한다.
  const startEdit = (side, ln) => {
    const { ta, box } = side;
    const height = box.offsetHeight;
    const scrollLeft = box.scrollLeft;
    const rel = ln ? ln.getBoundingClientRect().top - box.getBoundingClientRect().top : 0;
    let line = 0; // gap 줄을 뺀 실제 텍스트 줄 번호
    for (let n = ln?.previousElementSibling; n; n = n.previousElementSibling) if (!n.classList.contains('cmp-gap')) line++;
    side.editing = true;
    ta.classList.add('cmp-editing');
    ta.style.height = `${height}px`;
    show(side, true);
    const pos = ta.value.split('\n').slice(0, line).reduce((n, text) => n + text.length + 1, 0);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(pos, pos);
    ta.scrollTop = 1 + line * (ln?.offsetHeight || 0) - rel; // 1: border
    ta.scrollLeft = scrollLeft;
  };
  for (const side of sides) {
    side.box.addEventListener('click', (ev) => startEdit(side, ev.target.closest('.cmp-ln')));
    side.ta.addEventListener('blur', () => {
      if (side.ta.ownerDocument.activeElement === side.ta) return; // 창/tab 전환으로 인한 blur는 편집 유지
      side.editing = false;
      side.ta.classList.remove('cmp-editing');
      side.ta.style.height = '';
      rebuild();
    });
  }
  rebuild();
}

// 편집으로 값이 바뀐 쌍의 차이 highlight를 다시 계산
function refreshPair(L, R) {
  const lv = controlValue(L.el, L.type);
  const rv = controlValue(R.el, R.type);
  const differs = lv !== rv;
  [[L, rv], [R, lv]].forEach(([x, other]) => {
    x.el.classList.toggle('cmp-diff', differs);
    if (x.labelEl) x.labelEl.classList.toggle('cmp-diff', differs);
    x.el.title = differs ? `반대쪽 값: ${other}` : '';
  });
}

// ========== Save ==========
// 원문 view에서 편집한 값만 해당 job에 저장한다. 실제 Jenkins configure 페이지를 이 화면의 저장용 iframe에 띄우고
// (기존/new job tab은 사용하지 않음) Jenkins 자체 JS로 crumb/json을 처리해 POST한 뒤, configure를 다시 읽어 반영 여부를 확인한다.
let saving = false;
const sameRaw = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function changedEntries(job) {
  const edits = [];
  for (const entry of job.entries) {
    if (entry.kind !== 'item' || ['password', 'hidden'].includes(entry.type) || !entry.el.isConnected) continue;
    const value = readRaw(entry.el, entry.type);
    if (!sameRaw(value, entry.raw)) {
      edits.push({ name: entry.name, nth: entry.nth, type: entry.type, label: entry.label, orig: entry.raw, value });
    }
  }
  return edits;
}

async function sendSaveStep(step, data) {
  const response = await chrome.runtime.sendMessage({ type: 'compareSave', step, ...data });
  if (!response?.ok) throw new Error(response?.message || `저장 처리(${step}) 응답 없음`);
}

function loadSaveFrame(url) {
  const frame = $('saveFrame');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { frame.onload = null; reject(new Error('Jenkins 설정 화면 로딩 시간 초과')); }, 30000);
    frame.onload = () => { clearTimeout(timer); frame.onload = null; resolve(); };
    frame.src = url;
  });
}

// 저장 후 configure를 다시 읽어 각 항목의 실제 값을 기준값(entry.raw)으로 삼는다. 의도한 값과 다른 항목 목록을 돌려준다.
async function reloadSaved(job, edits) {
  const { doc } = await fetchConfigDoc(job.configUrl);
  const saved = extractEntries(doc).filter((entry) => entry.kind === 'item');
  const mismatched = [];
  for (const edit of edits) {
    const now = saved.find((entry) => entry.name === edit.name && entry.nth === edit.nth);
    const entry = job.entries.find((item) => item.kind === 'item' && item.name === edit.name && item.nth === edit.nth);
    if (now) entry.raw = now.raw;
    if (!now || !sameRaw(now.raw, edit.value)) mismatched.push(edit.label);
  }
  return mismatched;
}

async function saveJob(idx) {
  if (saving || !compared) return;
  const job = idx === 0 ? compared.a : compared.b;
  const status = $('status');
  const report = (text, ok) => {
    status.textContent = `${job.name}: ${text}`;
    status.classList.toggle('ok', ok);
  };
  const edits = changedEntries(job);
  if (!edits.length) return report('변경된 값이 없습니다', true);

  saving = true;
  $('saveLeft').disabled = $('saveRight').disabled = true;
  report(`저장 중... (변경 ${edits.length}건)`, true);
  $('saveProgressText').textContent = `${job.name}: 저장 중… (변경 ${edits.length}건)`;
  $('saveProgress').showModal();
  try {
    await sendSaveStep('allow', { configUrl: job.configUrl });
    await loadSaveFrame(job.configUrl);
    await sendSaveStep('run', { edits });
    const mismatched = await reloadSaved(job, edits);
    if (mismatched.length) report(`저장 요청은 완료됐지만 다시 읽은 값이 다릅니다: ${mismatched.join(', ')}`, false);
    else report(`저장 완료 (${edits.length}건, 저장 후 다시 읽어 확인)`, true);
  } catch (error) {
    report(`저장 실패 - ${error.message}`, false);
  } finally {
    $('saveFrame').src = 'about:blank';
    $('saveProgress').close();
    await sendSaveStep('end').catch(() => {});
    saving = false;
    $('saveLeft').disabled = $('saveRight').disabled = false;
  }
}

// 대응되는 anchor(같은 항목) 쌍을 기준으로 두 iframe의 scroll 위치를 맞춘다.
function syncScroll(frames, anchors) {
  const wins = frames.map((f) => f.contentWindow);
  const expected = [null, null]; // 프로그램이 설정한 scrollY (그 scroll event는 무시)
  let visible = null;
  const invalidate = () => { visible = null; };
  const list = () => visible || (visible = anchors.filter((p) => p.every((x) => x.getClientRects().length)));
  const top = (x, w) => x.getBoundingClientRect().top + w.scrollY;

  frames.forEach((f, s) => {
    f.contentDocument.querySelectorAll('link[rel~="stylesheet"]').forEach((l) => {
      l.addEventListener('load', invalidate);
      l.addEventListener('error', invalidate);
    });
    wins[s].addEventListener('resize', invalidate);
    wins[s].addEventListener('scroll', () => {
      const w = wins[s];
      if (expected[s] !== null && Math.abs(w.scrollY - expected[s]) < 1) { expected[s] = null; return; }
      expected[s] = null;
      const items = list();
      if (!items.length) return;
      // 화면 맨 위 이후 첫 anchor
      let lo = 0;
      let hi = items.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (top(items[mid][s], w) >= w.scrollY) hi = mid; else lo = mid + 1;
      }
      const pair = items[Math.min(lo, items.length - 1)];
      const o = 1 - s;
      const offset = top(pair[s], w) - w.scrollY;
      wins[o].scrollTo(0, top(pair[o], wins[o]) - offset);
      expected[o] = wins[o].scrollY;
    });
  });
}

function buildRawView() {
  rawBuilt = true;
  const { a, b, pairs } = compared;
  const frames = [$('rawLeft'), $('rawRight')];
  [a, b].forEach((job, i) => mountDoc(frames[i], job));

  const anchors = [];
  const pairOf = new Map(); // 편집 가능한 control element → [왼쪽 entry, 오른쪽 entry]
  for (const [i, j] of pairs) {
    const L = i >= 0 ? a.entries[i] : null;
    const R = j >= 0 ? b.entries[j] : null;
    const e = L || R;
    const differs = e.kind === 'header' ? !(L && R) : itemDiffers(L, R);
    let boxed = false;
    if (differs) {
      const bothText = L && R && e.kind === 'item' && L.el.tagName === 'TEXTAREA' && R.el.tagName === 'TEXTAREA';
      boxed = bothText && (L.value.includes('\n') || R.value.includes('\n'));
      if (boxed) diffTextareas(L, R);
      else [[L, R], [R, L]].forEach(([x, other]) => x && markEntry(x, other));
      rawDiffs.push([L && (L.anchor || L.el), R && (R.anchor || R.el)]);
    }
    if (L && R) anchors.push([L.anchor || L.el, R.anchor || R.el]);
    if (L && R && e.kind === 'item' && !boxed && e.type !== 'hidden') {
      pairOf.set(L.el, [L, R]);
      pairOf.set(R.el, [L, R]);
    }
  }

  frames.forEach((f) => {
    const idoc = f.contentDocument;
    const onEdit = (ev) => {
      const pair = pairOf.get(ev.target);
      if (!pair) return;
      refreshPair(pair[0], pair[1]);
      // radio: 같은 group의 다른 radio는 event 없이 해제되므로 함께 갱신
      if (ev.target.type === 'radio') {
        idoc.querySelectorAll('input[type="radio"]').forEach((r) => {
          const p = pairOf.get(r);
          if (p) refreshPair(p[0], p[1]);
        });
      }
    };
    idoc.addEventListener('input', onEdit, true);
    idoc.addEventListener('change', onEdit, true);
  });
  syncScroll(frames, anchors);
}

// ========== Diff navigation ==========

const NAV_OFFSET = 8; // 이동 후 diff 항목이 viewport 맨 위에서 떨어질 거리(px)
let navState = null; // 마지막 이동: { idx, rel }. scroll이 그대로면 위치 대신 idx로 다음/이전을 정한다 (scroll 끝에 막힌 항목 처리)

// 현재 view의 차이 위치 목록. rel(): viewport 맨 위 기준 항목 위치, scrollBy(d): 그 view를 d만큼 scroll
function diffTargets() {
  if (currentMode() === 'raw') {
    const wins = [$('rawLeft').contentWindow, $('rawRight').contentWindow];
    const targets = [];
    for (const pair of rawDiffs) {
      const s = [0, 1].find((k) => pair[k] && pair[k].getClientRects().length);
      if (s === undefined) continue; // 화면에 안 보이는 항목(hidden)
      targets.push({ rel: () => pair[s].getBoundingClientRect().top, scrollBy: (d) => wins[s].scrollBy(0, d) });
    }
    return targets;
  }
  const sc = $('scroller');
  return Array.from(document.querySelectorAll('#grid .grp[data-diff]'))
    .filter((g) => g.getClientRects().length)
    .map((g) => ({
      rel: () => g.getBoundingClientRect().top - sc.getBoundingClientRect().top,
      scrollBy: (d) => sc.scrollBy(0, d)
    }));
}

// dir > 0: 다음 diff, dir < 0: 이전 diff. 끝에서는 반대편 끝으로 순환.
function goDiff(dir) {
  const targets = diffTargets();
  const n = targets.length;
  if (!n) return;
  let k;
  if (navState && navState.idx < n && Math.abs(targets[navState.idx].rel() - navState.rel) < 1) {
    k = (navState.idx + dir + n) % n; // 직전 이동 이후 scroll이 그대로
  } else {
    // 사용자가 직접 scroll한 경우: 현재 화면 위치 기준 아래/위의 첫 항목
    const rels = targets.map((t) => t.rel());
    k = dir > 0 ? rels.findIndex((r) => r > NAV_OFFSET + 4) : rels.findLastIndex((r) => r < NAV_OFFSET - 4);
    if (k < 0) k = dir > 0 ? 0 : n - 1;
  }
  targets[k].scrollBy(targets[k].rel() - NAV_OFFSET);
  navState = { idx: k, rel: targets[k].rel() };
}

// ========== Main ==========

async function main() {
  const params = new URLSearchParams(location.search);
  const raws = [params.get('p1') || '', params.get('p2') || ''];
  document.querySelectorAll('input[name="viewMode"]').forEach((r) => r.addEventListener('change', () => setMode(currentMode())));
  $('nextDiff').addEventListener('click', () => goDiff(1));
  $('prevDiff').addEventListener('click', () => goDiff(-1));
  $('saveLeft').addEventListener('click', () => saveJob(0));
  $('saveRight').addEventListener('click', () => saveJob(1));
  $('saveProgress').addEventListener('cancel', (event) => event.preventDefault());

  const links = [$('leftLink'), $('rightLink')];
  raws.forEach((raw, i) => { links[i].textContent = raw; links[i].href = raw; });

  try {
    const [a, b] = await Promise.all(raws.map((raw, i) => loadJob(raw).catch((e) => {
      throw new Error(`${i === 0 ? 'PARAM1' : 'PARAM2'}: ${e.message}`);
    })));
    [a, b].forEach((job, i) => {
      links[i].textContent = job.name;
      links[i].href = job.configUrl;
      links[i].title = job.configUrl;
    });
    document.title = `Compare: ${a.name} ↔ ${b.name}`;
    render(a, b);
  } catch (e) {
    console.error(e);
    $('status').textContent = e.message;
  }
}

main();
