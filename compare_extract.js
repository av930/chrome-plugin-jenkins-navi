// Jenkins job configure form → 비교 entry 목록 및 입력 값 읽기.
// compare_page.html과 저장용 Jenkins iframe의 실행기에서 로드된다.
(function () {
  'use strict';

  const CHECKED = '✔ checked';
  const UNCHECKED = '✘ unchecked';

  // configure form에서 값 비교에서 제외할 요소 / 값 없이 type 정보만 남길 hidden input
  const SKIP_CONTAINER = 'template, noscript, .prototype, .repeatable-prototype, .to-be-removed, [class*="prototype"]';
  const SECTION_SEL = '.section-header, .jenkins-section__title';
  const SKIP_TYPES = new Set(['submit', 'button', 'image', 'reset', 'file']);
  const HIDDEN_KEEP = new Set(['stapler-class', '$class', '_class']);
  const LABEL_NOISE = 'button, svg, script, style, input, select, textarea, .jenkins-sr-only, .help-button, .setting-help';

  // label/header에 쓸 텍스트: 버튼/아이콘/입력요소를 제외한 가시 텍스트
  function cleanText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll(LABEL_NOISE).forEach((n) => n.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  // 항목 행의 이름: 가장 가까운 form-item(new UI) / tr(old UI)의 label. repeated-chunk 경계를 넘지 않는다.
  function rowLabel(el, root) {
    for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
      const l = a.querySelector(':scope > .jenkins-form-label, :scope > .setting-name');
      if (l) return cleanText(l);
      if (a.classList.contains('repeated-chunk')) break;
    }
    return '';
  }

  // checkbox/radio 자신의 label element
  function ownLabelEl(el, doc) {
    const wrap = el.closest('label');
    if (wrap) return wrap;
    if (el.id) {
      const l = doc.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return l;
    }
    const next = el.nextElementSibling;
    return next && next.matches('label') ? next : null;
  }

  function chunksOf(el, root) {
    const list = [];
    for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
      if (a.classList.contains('repeated-chunk')) list.push(a);
    }
    return list.reverse();
  }

  function chunkTitle(chunk) {
    let t = cleanText(chunk.querySelector('.repeated-chunk__header, .dd-handle'));
    if (!t) t = chunk.getAttribute('descriptorid') || '(항목)';
    return t.slice(0, 100);
  }

  function controlType(el) {
    return el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase();
  }

  // 화면 표시/비교용 값
  function controlValue(el, type) {
    if (type === 'checkbox' || type === 'radio') return el.checked ? CHECKED : UNCHECKED;
    if (el.tagName === 'SELECT') {
      return Array.from(el.selectedOptions)
        .map((o) => {
          const text = o.textContent.replace(/\s+/g, ' ').trim();
          return o.value && o.value !== text ? `${text} [${o.value}]` : text;
        })
        .join(', ');
    }
    if (type === 'password') return el.value ? '(secret 설정됨 - 값은 비교하지 않음)' : '';
    return el.value.replace(/\r\n?/g, '\n');
  }

  function readRaw(el, type) {
    if (type === 'checkbox' || type === 'radio') return el.checked;
    if (el.tagName === 'SELECT') return Array.from(el.selectedOptions).map((option) => option.value);
    return el.value.replace(/\r\n?/g, '\n');
  }

  // configure form을 문서 순서대로 훑어 header(section / repeated-chunk 제목)와 item(입력 요소) 목록을 만든다.
  // key는 부모 header의 유일 key + label 이므로 두 job의 같은 위치 항목끼리 정렬된다.
  function extractEntries(doc) {
    const root = doc.querySelector('form[name="config"]');
    const entries = [];
    const counter = new Map();
    const nameCount = new Map();
    const chunkTitles = new Map();
    let stack = []; // [{ el, key }]
    let sectionEl = null;
    let sectionTitle = '';

    const uniq = (base) => {
      const n = (counter.get(base) || 0) + 1;
      counter.set(base, n);
      return n === 1 ? base : `${base}#${n}`;
    };

    // levels = [{ el, title }]; 이전 stack과 공통인 앞부분은 유지하고 새 level만 header로 emit
    const syncStack = (levels) => {
      let i = 0;
      while (i < stack.length && i < levels.length && stack[i].el === levels[i].el) i++;
      stack = stack.slice(0, i);
      for (; i < levels.length; i++) {
        const parentKey = i ? stack[i - 1].key : '';
        const key = uniq(`H|${parentKey}/${levels[i].title}`);
        stack.push({ el: levels[i].el, key });
        // 원문 view에서 highlight할 element: chunk는 header 제목 줄, section은 제목 자체
        const markEl = levels[i].el.classList.contains('repeated-chunk')
          ? levels[i].el.querySelector('.repeated-chunk__header, .dd-handle') || levels[i].el
          : levels[i].el;
        entries.push({ kind: 'header', level: i, title: levels[i].title, key, el: markEl });
      }
    };

    for (const el of root.querySelectorAll(`${SECTION_SEL}, input, select, textarea`)) {
      if (el.closest(SKIP_CONTAINER)) continue;

      if (el.matches(SECTION_SEL)) {
        if (el.querySelector(SECTION_SEL) || el.closest('.repeated-chunk')) continue;
        sectionEl = el;
        sectionTitle = cleanText(el) || '(section)';
        syncStack([{ el: sectionEl, title: sectionTitle }]);
        continue;
      }

      const type = controlType(el);
      if (!el.name || SKIP_TYPES.has(type)) continue;
      if (type === 'hidden' && !HIDDEN_KEEP.has(el.name)) continue;

      const levels = chunksOf(el, root).map((c) => {
        if (!chunkTitles.has(c)) chunkTitles.set(c, chunkTitle(c));
        return { el: c, title: chunkTitles.get(c) };
      });
      if (sectionEl) levels.unshift({ el: sectionEl, title: sectionTitle });
      syncStack(levels);

      const row = rowLabel(el, root);
      const labelEl = type === 'checkbox' || type === 'radio' ? ownLabelEl(el, doc) : null;
      const label = [row, cleanText(labelEl)].filter(Boolean).join(' › ') || el.name;
      const value = controlValue(el, type);
      const parentKey = stack.length ? stack[stack.length - 1].key : '';
      const nth = nameCount.get(el.name) || 0;
      nameCount.set(el.name, nth + 1);
      entries.push({
        kind: 'item',
        key: uniq(`I|${parentKey}|${label}`),
        label,
        type,
        name: el.name,
        nth,
        raw: readRaw(el, type),
        value,
        blank: value === '' || value === UNCHECKED,
        el,
        labelEl
      });
    }
    return entries;
  }

  globalThis.JobConfigExtract = { extractEntries, controlType, controlValue, readRaw };
})();
