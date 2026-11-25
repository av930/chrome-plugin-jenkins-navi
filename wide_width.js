// Wide width: Jenkins 화면의 폭을 넓힌다.
//   카테고리: "config"(configure 화면), "bhistory"(왼쪽 하단 Build History)
//   기본값: config run."wide-width" = "config" | "Bhistory" | "all" (대소문자 무시)
//   토글: 팝업의 wide-width 버튼이 'toggleWideWidth' 메시지를 보내면 현재 화면에 해당하는
//         카테고리를 확장/축소하고, 그 상태를 chrome.storage.local('wideWidthState')에 저장한다.
//         저장된 상태는 모든 job/화면에 동일하게 적용된다 (저장값이 없으면 기본값을 따른다).
(function () {
  'use strict';

  // Jenkins 화면이 아니면 아무것도 하지 않는다 (content script는 모든 http(s) 페이지에 주입됨)
  if (!document.getElementById('jenkins') && !document.getElementById('main-panel')) return;
  if (!chrome.runtime?.id) return;

  const STATE_KEY = 'wideWidthState';
  const root = document.documentElement;

  let defaults = new Set(); // run."wide-width"로 지정된 기본 확장 카테고리
  let stored = {};          // 사용자가 버튼으로 지정한 카테고리별 상태 { config: bool, bhistory: bool }

  // ---------- 되돌릴 수 있는 inline style 변경 ----------

  function makeTracker() {
    const changes = [];
    return {
      set(el, prop, value) {
        changes.push({ el, prop, value: el.style.getPropertyValue(prop), priority: el.style.getPropertyPriority(prop) });
        el.style.setProperty(prop, value, 'important');
      },
      restore() {
        for (const { el, prop, value, priority } of changes.reverse()) {
          if (value) el.style.setProperty(prop, value, priority);
          else el.style.removeProperty(prop);
        }
        changes.length = 0;
      }
    };
  }

  // ---------- config 화면 ----------

  const configTracker = makeTracker();
  let configOn = false;

  function isConfigPage() {
    return /\/configure\/?$/.test(location.pathname);
  }

  const STRETCH_TAGS = new Set(['DIV', 'FORM', 'TABLE', 'FIELDSET', 'SECTION', 'MAIN']);

  // el이 부모의 안쪽 폭을 채우도록 폭 제한을 푼다. 이미 채우고 있으면 건드리지 않는다.
  function stretch(el) {
    if (!STRETCH_TAGS.has(el.tagName)) return;
    const parent = el.parentElement;
    if (!parent) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position === 'fixed' || cs.position === 'absolute') return;

    // 좌우 padding이 과하면(40px 초과) 기본값(15px)으로 줄인다
    for (const prop of ['padding-left', 'padding-right']) {
      if (parseFloat(cs.getPropertyValue(prop)) > 40) configTracker.set(el, prop, '15px');
    }

    const pcs = getComputedStyle(parent);
    const available = parent.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight);
    if (el.getBoundingClientRect().width >= available - 4) return;

    if (cs.maxWidth !== 'none') configTracker.set(el, 'max-width', 'none');
    configTracker.set(el, 'margin-left', '0px');
    configTracker.set(el, 'margin-right', '0px');
    configTracker.set(el, 'box-sizing', 'border-box');
    configTracker.set(el, 'width', '100%');
  }

  function setConfigWide(on) {
    if (on === configOn) return;
    if (!on) {
      root.classList.remove('jn-wide-config');
      configTracker.restore();
      configOn = false;
      return;
    }
    if (!isConfigPage()) return;
    root.classList.add('jn-wide-config');

    // 가장 안쪽 후보부터 시작해야 중간 컨테이너도 조상 탐색에 포함된다
    const start = document.querySelector('.jenkins-config')
      || document.querySelector('#main-panel form')
      || document.getElementById('main-panel');
    if (start) {
      // 폭 제한 방식(max-width, 고정 width, 좌우 auto margin, 큰 padding)을 가리지 않고
      // "부모 안쪽 폭을 다 채우지 못하는" 요소를 부모 폭까지 늘린다.
      for (let p = start; p && p !== document.body; p = p.parentElement) stretch(p);
      for (const child of start.children) {
        stretch(child);
        for (const grandChild of child.children) stretch(grandChild);
      }
    }
    configOn = true;
  }

  // ---------- Build History ----------

  const bhTracker = makeTracker();
  let bhOn = false;
  let bhFit = null;

  function setBuildHistoryWide(on) {
    if (on === bhOn) return;
    const el = document.getElementById('buildHistory');
    if (!on) {
      root.classList.remove('jn-wide-bhistory');
      for (const node of document.querySelectorAll('.jn-wide-bh-ancestor')) node.classList.remove('jn-wide-bh-ancestor');
      window.removeEventListener('resize', bhFit);
      bhTracker.restore();
      bhOn = false;
      return;
    }
    if (!el) return;
    root.classList.add('jn-wide-bhistory');

    // 가로로 잘라내는 조상(overflow)을 풀어 main-panel 영역으로 나갈 수 있게 한다
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') p.classList.add('jn-wide-bh-ancestor');
    }

    // 폭은 현재 위치(left)에서 화면 오른쪽 끝까지. 원래 inline width는 최초 1회만 기록한다
    let tracked = false;
    bhFit = () => {
      const width = root.clientWidth - el.getBoundingClientRect().left - 24;
      if (width <= 0) return;
      if (!tracked) {
        bhTracker.set(el, 'width', `${width}px`);
        tracked = true;
      } else {
        el.style.setProperty('width', `${width}px`, 'important');
      }
    };
    bhFit();
    window.addEventListener('resize', bhFit);
    bhOn = true;
  }

  // ---------- 상태 ----------

  const CATEGORIES = {
    config: { available: isConfigPage, set: setConfigWide },
    bhistory: { available: () => !!document.getElementById('buildHistory'), set: setBuildHistoryWide }
  };

  const effective = (category) => stored[category] ?? defaults.has(category);

  function applyAll() {
    for (const [category, { set }] of Object.entries(CATEGORIES)) set(effective(category));
  }

  // 현재 화면에 해당하는 카테고리 (configure 화면이 우선)
  function currentCategory() {
    return Object.keys(CATEGORIES).find((category) => CATEGORIES[category].available()) || null;
  }

  // ---------- 알림 ----------

  function toast(text) {
    const div = document.createElement('div');
    div.textContent = text;
    div.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;padding:8px 14px;'
      + 'background:#323232;color:#fff;font:13px sans-serif;border-radius:4px;'
      + 'box-shadow:0 2px 8px rgba(0,0,0,.4);pointer-events:none;';
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 2000);
  }

  // ---------- 토글 / 초기화 ----------

  async function toggle() {
    const category = currentCategory();
    if (!category) {
      toast('Wide width: 이 화면에는 확장할 항목이 없습니다 (configure / Build History)');
      return { ok: false };
    }
    const next = !effective(category);
    stored = { ...stored, [category]: next };
    await chrome.storage.local.set({ [STATE_KEY]: stored }); // storage.onChanged가 applyAll을 호출한다
    applyAll();
    toast(`Wide width [${category}]: ${next ? '확장' : '축소'}`);
    return { ok: true, category, enabled: next };
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request?.type !== 'toggleWideWidth') return;
    toggle().then(sendResponse);
    return true;
  });

  function parseDefaults(userConfigText) {
    try {
      const mode = String(JSON.parse(userConfigText)?.run?.['wide-width'] ?? '').trim().toLowerCase();
      if (mode === 'all') return new Set(Object.keys(CATEGORIES));
      return new Set(Object.keys(CATEGORIES).filter((category) => category === mode));
    } catch (error) {
      return new Set();
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[STATE_KEY]) stored = changes[STATE_KEY].newValue || {};
    if (changes.userConfigText) defaults = parseDefaults(changes.userConfigText.newValue);
    if (changes[STATE_KEY] || changes.userConfigText) applyAll();
  });

  chrome.storage.local.get(['userConfigText', STATE_KEY]).then((result) => {
    defaults = parseDefaults(result.userConfigText);
    stored = result[STATE_KEY] || {};
    applyAll();
  }).catch(() => {});
})();
