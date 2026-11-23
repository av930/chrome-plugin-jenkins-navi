// compare 화면의 저장용 iframe(실제 Jenkins configure 페이지)의 MAIN world에서 실행한다.
// Jenkins 자체 JS가 초기화한 form에 변경값만 넣고, Jenkins의 onsubmit(buildFormTree)으로 json/crumb을 채운 뒤
// configSubmit에 직접 POST한다. 저장 버튼 click이나 페이지 이동에 의존하지 않는다.
(function () {
  'use strict';

  const { extractEntries, readRaw } = globalThis.JobConfigExtract;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const describe = (edit) => `${edit.label} (name=${edit.name}, 순번=${edit.nth})`;

  // Jenkins behaviour가 form에 json field를 붙이고 "불러오는 중" overlay를 걷어낼 때까지 기다린다.
  async function jenkinsForm() {
    const deadline = Date.now() + 45000;
    for (;;) {
      const form = document.querySelector('form[name="config"]');
      const overlay = document.querySelector('.behavior-loading');
      const style = overlay && getComputedStyle(overlay);
      const loading = overlay && !overlay.classList.contains('behavior-loading--hidden') &&
        style.display !== 'none' && style.visibility === 'visible' && style.opacity !== '0';
      if (document.readyState === 'complete' && form?.elements.json && !loading) return form;
      if (Date.now() > deadline) {
        throw new Error(`Jenkins 설정 화면 초기화 시간 초과 (url=${location.href}, form=${!!form}, json=${!!form?.elements.json})`);
      }
      await sleep(200);
    }
  }

  function findTargets(edits) {
    const live = extractEntries(document).filter((entry) => entry.kind === 'item');
    return edits.map((edit) => {
      if (['password', 'hidden'].includes(edit.type)) throw new Error(`비밀번호/hidden 항목은 저장하지 않습니다: ${describe(edit)}`);
      const entry = live.find((item) => item.name === edit.name && item.nth === edit.nth);
      if (!entry || entry.type !== edit.type) throw new Error(`Jenkins 설정 화면에서 항목을 찾지 못했습니다: ${describe(edit)}`);
      if (!same(readRaw(entry.el, entry.type), edit.orig)) {
        throw new Error(`compare 이후 Jenkins의 값이 바뀌었습니다. 덮어쓰지 않습니다: ${describe(edit)}`);
      }
      if (edit.type === 'select' && edit.value.some((value) => !Array.from(entry.el.options).some((option) => option.value === value))) {
        throw new Error(`선택 항목이 Jenkins에 없습니다: ${describe(edit)}`);
      }
      return { el: entry.el, edit };
    });
  }

  // 사용자 입력과 같은 event를 발생시켜 Jenkins의 optional block/dropdown 등 연동 UI도 갱신되게 한다.
  function applyValue(el, { type, value }) {
    if (type === 'checkbox' || type === 'radio') {
      if (el.checked !== value && (type === 'checkbox' || value)) el.click(); // radio는 선택된 쪽만 click
      return;
    }
    if (type === 'select') {
      for (const option of el.options) option.selected = value.includes(option.value);
    } else {
      el.value = value;
      const editor = el.codemirrorObject || el.nextElementSibling?.CodeMirror; // Jenkins의 CodeMirror textarea
      if (editor) {
        editor.setValue(value);
        editor.save();
      }
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Jenkins 저장 버튼과 같은 처리: onsubmit이 buildFormTree로 json field를 채운다.
  function buildJenkinsForm(form) {
    let built;
    if (typeof form.onsubmit === 'function') built = form.onsubmit.call(form, new SubmitEvent('submit', { cancelable: true }));
    else if (typeof globalThis.buildFormTree === 'function') built = globalThis.buildFormTree(form);
    else throw new Error('Jenkins form 처리 함수(buildFormTree)를 찾지 못했습니다');
    if (built === false) throw new Error('Jenkins form 검증에 실패했습니다 (입력값 확인)');
    JSON.parse(form.elements.json.value); // 만들어지지 않았으면 여기서 실패
  }

  function errorText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const selectors = ['#error-description', '.error', '#main-panel h1', 'h1', 'h2', 'title']; // 앞쪽이 더 구체적인 문구
    const node = selectors.map((selector) => doc.querySelector(selector)).find((found) => found?.textContent.trim());
    return (node?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  async function post(form) {
    const data = new FormData(form);
    if (!data.has('Submit')) data.append('Submit', 'Save');
    const body = form.enctype === 'multipart/form-data' ? data : new URLSearchParams(data);
    const headers = {};
    const crumb = globalThis.crumb;
    if (crumb?.fieldName && crumb.value) headers[crumb.fieldName] = crumb.value;
    // 저장 성공 시 Jenkins는 job 페이지로 302 redirect한다. reverse proxy 때문에 Location이 다른 scheme/host이면
    // redirect를 따라갈 때 fetch가 "Failed to fetch"로 실패하므로 따라가지 않는다. 실제 반영 여부는 compare 화면이 다시 읽어 확인한다.
    const response = await fetch(form.action, { method: 'POST', body, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'manual' });
    if (response.type === 'opaqueredirect') return;
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Jenkins가 저장을 거부했습니다 (HTTP ${response.status}): ${errorText(text) || '응답 내용 없음'}`);
    }
  }

  async function save(edits) {
    if (!edits.length) throw new Error('변경된 항목이 없습니다');
    const form = await jenkinsForm();
    const targets = findTargets(edits); // 모든 항목을 확인한 뒤에만 값을 바꾼다
    targets.forEach(({ el, edit }) => applyValue(el, edit));
    for (const { el, edit } of targets) {
      if (!same(readRaw(el, edit.type), edit.value)) throw new Error(`값을 Jenkins form에 넣지 못했습니다: ${describe(edit)}`);
    }
    buildJenkinsForm(form);
    await post(form);
  }

  globalThis.ComparedJobSave = {
    save: (edits) => save(edits).then(() => ({ ok: true }), (error) => ({ ok: false, message: error.message }))
  };
})();
