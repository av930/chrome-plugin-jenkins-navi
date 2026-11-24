// Jenkins build history 삭제 (Action=RemoveHistory) for the run dialog.
// 현재 보고 있는 job에서 Target(build 범위)에 해당하는 build를 삭제한다. view/folder page는 대상이 아니다.

const JobRemoveHistory = (() => {
  const ACTION = 'RemoveHistory';

  const USAGE = `Action=RemoveHistory
Target="1000~"                   #build 범위 (ex: 27~36|~36|27~|40), 필수

# 현재 page가 job/build일 때 해당 job의 build history에서 Target 범위의 build를 삭제한다. (되돌릴 수 없음)
# Execute 하면 삭제 대상 개수를 보여주고 확인 후 삭제한다.`;

  // 대소문자, 앞뒤 공백/따옴표/기호 무시
  function isAction(value) {
    return String(value || '').replace(/[^a-z]/gi, '').toLowerCase() === ACTION.toLowerCase();
  }

  function defaultParams() {
    return `Action=${ACTION}\nTarget=""`;
  }

  function parseParams(text) {
    const params = { action: '', target: '' };
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0 || trimmed.startsWith('#')) continue;
      const key = trimmed.substring(0, eq).trim().toLowerCase();
      const value = JobSearch.parseValue(trimmed.substring(eq + 1));
      if (key === 'action') params.action = value;
      else if (key === 'target') params.target = value;
    }
    return params;
  }

  // Jenkins root URL (…/jenkins06/): 첫 /job/ 또는 /view/ 앞까지
  const rootUrl = (url) => url.replace(/\/(job|view)\/.*$/, '/');

  // CSRF crumb header (crumb issuer가 없으면 빈 header)
  async function crumbHeaders(url) {
    try {
      const crumb = await JobSearch.fetchJson(`${rootUrl(url)}crumbIssuer/api/json`);
      return { [crumb.crumbRequestField]: crumb.crumb };
    } catch {
      return {};
    }
  }

  async function deleteBuild(job, number, headers) {
    const resp = await fetch(`${job.url}${number}/doDelete`, {
      method: 'POST', credentials: 'include', headers, redirect: 'manual'
    });
    // 성공 시 Jenkins가 job page로 redirect한다 (manual이면 opaqueredirect)
    if (resp.type !== 'opaqueredirect' && !resp.ok) throw new Error(`HTTP ${resp.status}`);
  }

  // ui: { status(text), info(text), error(text), confirm(text) -> boolean }
  async function run(params, pageUrl, ui) {
    if (!isAction(params.action)) throw new Error(`Action 값 오류: "${params.action}" (${ACTION})`);
    if (!params.target) throw new Error('Target(build 범위)을 입력하세요. (ex: 1000~, 27~36, ~36)');
    if (!pageUrl || !/^https?:/.test(pageUrl)) throw new Error('현재 page가 Jenkins page가 아닙니다.');

    const ranges = JobSearch.parseBuildRange(params.target);
    const url = JobSearch.resolveBaseUrl(pageUrl);
    ui.status(`대상 확인 중: ${url}`);
    const info = await JobSearch.fetchJson(`${url}api/json?tree=jobs[name]`);
    if (Array.isArray(info.jobs)) throw new Error('현재 page가 job이 아닙니다 (view/folder). job page에서 실행하세요.');

    const name = decodeURIComponent(url.split('/').filter(Boolean).pop());
    const job = { name, url };
    const builds = (await JobSearch.listBuilds(job, 'number')).map(b => b.number)
      .filter(n => JobSearch.inRange(n, ranges));
    if (builds.length === 0) throw new Error(`Target "${params.target}"에 해당하는 build가 없습니다.`);

    const range = `#${builds[builds.length - 1]} ~ #${builds[0]}`;
    if (!ui.confirm(`${name}\nbuild ${builds.length}개 (${range})를 삭제합니다. 되돌릴 수 없습니다.\n계속할까요?`)) {
      ui.status('삭제를 취소했습니다.');
      return;
    }

    const headers = await crumbHeaders(url);
    let deleted = 0;
    const failures = [];
    await JobSearch.runPool(builds, async (n) => {
      try {
        await deleteBuild(job, n, headers);
        deleted++;
      } catch (e) {
        failures.push(`#${n}: ${e.message}`);
      }
    }, (done, total) => ui.status(`${ACTION} [${name}] ${done}/${total}, 삭제 ${deleted}건`));

    for (const f of failures) ui.error(`삭제 실패 ${f}`);
    ui.info(`${name}: build ${deleted}개 삭제 (${range})${failures.length ? `, 실패 ${failures.length}개` : ''}`);
    ui.status(`${ACTION} [${name}] 완료: 삭제 ${deleted}건${failures.length ? `, 실패 ${failures.length}건` : ''}`);
  }

  return { USAGE, isAction, defaultParams, parseParams, run };
})();
