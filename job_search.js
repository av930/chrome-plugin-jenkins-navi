// Jenkins job search (Config / Log / Name) for the run dialog.
// 대상 결정:
//   - 현재 page가 view/folder: 보이는 job 전체 (FilterIn = job name RegExp)
//   - 현재 page가 job(또는 build): 그 job (FilterIn = build 범위, ex: 27~36, ~36, 27~)
// 검색 결과는 HTML(바로가기 link 포함)로 onHit callback에 전달한다.

const JobSearch = (() => {
  const ACTIONS = ['Config', 'Log', 'Name', 'History'];
  const CONCURRENCY = 6;
  const MAX_LINES_PER_HIT = 20;
  const MAX_LINE_LENGTH = 400;

  const USAGE = `Action=Config                     #[Config|Log|Name|History] (대소문자 무관)
SearchPattern=".*_build"          #Regexp(ex: .*_build)
FilterIn=".*_pipeline"            #Regexp(ex1:^trigger_*(di|ci)_release, ex2: 27~36|~36|27~ )

# 현재 page가 view/folder: 보이는 모든 job 검색, FilterIn = job name RegExp (ex1)
# 현재 page가 job/build : 해당 job 검색, FilterIn = build 범위 (ex2, 비우면 전체)
# Config=config.xml, Log=console log(view/folder에서는 lastBuild만), Name=build name/description
# History=job의 jobConfigHistory 각 version의 config (job page에서만). FilterIn = 날짜 범위
#   ex3: 2024-07-02_19-12-25~2026-07-23_17-04-12 | 2024-07-02_19-12-25~ | ~2026-07-23 (일부만 써도 됨)`;

  // 대소문자, 앞뒤 공백/따옴표/기호는 무시 (" log ", "NaMe", '"Config"' 모두 허용)
  function normalizeAction(value) {
    const key = String(value || '').replace(/[^a-z]/gi, '').toLowerCase();
    return ACTIONS.find(a => a.toLowerCase() === key) || '';
  }

  function isAction(value) {
    return normalizeAction(value) !== '';
  }

  function defaultParams(action) {
    return `Action=${normalizeAction(action) || 'Config'}\nSearchPattern=""\nFilterIn=""`;
  }

  // 값: "..." / “...” 따옴표 제거, 따옴표 밖의 " #comment" 제거
  function parseValue(raw) {
    const value = raw.trim();
    const quoted = value.match(/^["“”'](.*?)["“”'](\s*#.*)?$/);
    if (quoted) return quoted[1];
    return value.replace(/\s+#.*$/, '').trim();
  }

  function parseParams(text) {
    const params = { action: '', pattern: '', filterIn: '' };
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      const eq = trimmed.indexOf('=');
      if (eq <= 0 || trimmed.startsWith('#')) continue;
      const key = trimmed.substring(0, eq).trim().toLowerCase();
      const value = parseValue(trimmed.substring(eq + 1));
      if (key === 'action') params.action = normalizeAction(value) || value;
      else if (key === 'searchpattern') params.pattern = value;
      else if (key === 'filterin') params.filterIn = value;
    }
    return params;
  }

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const escapeHtml = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const decodeXmlEntities = (s) => s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

  // 문자열 검색 + RegExp 검색을 하나의 RegExp로 합친다 (RegExp가 잘못되면 문자열 검색만)
  function buildMatcher(pattern) {
    const literal = escapeRegExp(pattern);
    try {
      new RegExp(pattern);
      return new RegExp(`(?:${literal})|(?:${pattern})`, 'g');
    } catch {
      return new RegExp(literal, 'g');
    }
  }

  // match 부분을 <mark>로 감싼 HTML (긴 줄은 첫 match 주변만 표시)
  function highlight(line, matcher) {
    let text = line;
    let prefix = '';
    let suffix = '';
    if (text.length > MAX_LINE_LENGTH) {
      matcher.lastIndex = 0;
      const first = matcher.exec(text);
      const start = Math.max(0, (first ? first.index : 0) - 100);
      prefix = start > 0 ? '…' : '';
      suffix = start + MAX_LINE_LENGTH < text.length ? '…' : '';
      text = text.substring(start, start + MAX_LINE_LENGTH);
    }
    let html = '';
    let last = 0;
    matcher.lastIndex = 0;
    let m;
    while ((m = matcher.exec(text)) !== null) {
      if (m[0].length === 0) { matcher.lastIndex++; continue; }
      html += escapeHtml(text.substring(last, m.index)) + `<mark>${escapeHtml(m[0])}</mark>`;
      last = m.index + m[0].length;
    }
    return escapeHtml(prefix) + html + escapeHtml(text.substring(last)) + escapeHtml(suffix);
  }

  // 여러 줄 중 match되는 줄 목록 ({no, html})
  function matchLines(text, matcher) {
    const hits = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      matcher.lastIndex = 0;
      if (matcher.test(lines[i])) hits.push({ no: i + 1, html: highlight(lines[i], matcher) });
    }
    return hits;
  }

  // FilterIn build 범위: "27~36", "~36", "27~", "40" (, | 공백으로 여러 개)
  function parseBuildRange(filterIn) {
    const tokens = filterIn.split(/[,|\s]+/).filter(Boolean);
    if (tokens.length === 0) return null;
    return tokens.map(token => {
      const single = token.match(/^(\d+)$/);
      if (single) return { from: +single[1], to: +single[1] };
      const range = token.match(/^(\d*)~(\d*)$/);
      if (!range || (!range[1] && !range[2])) {
        throw new Error(`FilterIn build 범위 형식 오류: "${token}" (ex: 27~36|~36|27~)`);
      }
      return { from: range[1] ? +range[1] : -Infinity, to: range[2] ? +range[2] : Infinity };
    });
  }

  // History FilterIn 날짜 범위: "A~B", "A~", "~B", "A" (A,B는 2024-07-02_19-12-25 형식, 앞부분만 써도 됨)
  // 문자열 비교로 범위를 판정한다 (timestamp가 사전순 = 시간순). 끝값은 prefix로 보고 그 구간 전체를 포함한다.
  const TS_TOKEN = /^\d{4}(-\d{2}(-\d{2}(_\d{2}(-\d{2}(-\d{2})?)?)?)?)?$/;
  function parseDateRange(filterIn) {
    const tokens = filterIn.split(/[,|\s]+/).filter(Boolean);
    if (tokens.length === 0) return null;
    return tokens.map(token => {
      const bad = () => new Error(
        `FilterIn 날짜 범위 형식 오류: "${token}" (ex: 2024-07-02_19-12-25~2026-07-23_17-04-12 | 2024-07-02_19-12-25~ | ~2026-07-23)`);
      const parts = token.split('~');
      if (parts.length > 2 || parts.some(p => p && !TS_TOKEN.test(p))) throw bad();
      if (parts.length === 1) return { from: parts[0], to: parts[0] + '~' };
      if (!parts[0] && !parts[1]) throw bad();
      return { from: parts[0], to: parts[1] ? parts[1] + '~' : '\uffff' };
    });
  }

  const inDateRange = (ts, ranges) => !ranges || ranges.some(r => ts >= r.from && ts <= r.to);

  // 현재 page URL에서 job/view/folder URL 추출 (build 번호, configure 등 하위 path 제거)
  function resolveBaseUrl(pageUrl) {
    const url = new URL(pageUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    let end = segments.length;
    let seenItem = false;
    for (let i = 0; i < segments.length; i++) {
      if ((segments[i] === 'job' || segments[i] === 'view') && i + 1 < segments.length) {
        seenItem = true;
        i++;
        end = i + 1;
      } else if (seenItem) {
        break;
      }
    }
    const path = segments.slice(0, end).join('/');
    return `${url.origin}/${path ? path + '/' : ''}`;
  }

  async function fetchText(url) {
    const resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
    return resp.text();
  }

  async function fetchJson(url) {
    return JSON.parse(await fetchText(url));
  }

  // API가 돌려준 url은 Jenkins root URL 설정에 따라 host가 다를 수 있으므로 현재 page origin으로 맞춘다
  function withOrigin(apiUrl, origin) {
    const u = new URL(apiUrl);
    return origin + u.pathname;
  }

  async function runPool(items, worker, onProgress) {
    let next = 0;
    let done = 0;
    const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await worker(item);
        onProgress(++done, items.length);
      }
    });
    await Promise.all(runners);
  }

  function hitHtml(link, title, lines) {
    const shown = lines.slice(0, MAX_LINES_PER_HIT)
      .map(l => `<span class="line-no">${l.no}:</span> ${l.html}`).join('\n');
    const more = lines.length > MAX_LINES_PER_HIT ? `\n… ${lines.length - MAX_LINES_PER_HIT} more lines` : '';
    return `<div class="hit"><a href="${escapeHtml(link)}">${escapeHtml(title)}</a>` +
      `<span class="hit-count">(${lines.length})</span><pre>${shown}${more}</pre></div>`;
  }

  async function searchConfig(job, matcher) {
    const xml = await fetchText(`${job.url}config.xml`);
    const lines = matchLines(decodeXmlEntities(xml), matcher);
    return lines.length ? [hitHtml(`${job.url}configure`, `${job.name} : config.xml`, lines)] : [];
  }

  async function searchLog(job, builds, matcher, stats) {
    const results = [];
    for (const build of builds) {
      const buildUrl = `${job.url}${build}/`;
      let log;
      try {
        log = await fetchText(`${buildUrl}consoleText`);
      } catch (e) {
        if (/HTTP 404/.test(e.message)) { stats.missing++; continue; } // build 없음 (lastBuild 없는 job 포함)
        throw e;
      }
      stats.scanned++;
      stats.chars += log.length;
      const lines = matchLines(log, matcher);
      if (lines.length) results.push(hitHtml(`${buildUrl}console`, `${job.name} #${build}`, lines));
    }
    return results;
  }

  function searchDescription(job, builds, matcher) {
    const results = [];
    for (const b of builds) {
      const lines = [];
      for (const [label, value] of [['name', b.displayName], ['description', b.description]]) {
        if (!value) continue;
        for (const l of matchLines(value, matcher)) lines.push({ no: label, html: l.html });
      }
      if (lines.length) results.push(hitHtml(`${job.url}${b.number}/`, `${job.name} #${b.number}`, lines));
    }
    return results;
  }

  async function listBuilds(job, tree) {
    const data = await fetchJson(`${job.url}api/json?tree=allBuilds[${tree}]`);
    return (data.allBuilds || []).sort((a, b) => b.number - a.number);
  }

  // jobConfigHistory page의 main panel에서 version timestamp(2024-07-02_19-12-25) 목록 (최신 먼저)
  async function listConfigHistory(job) {
    const html = await fetchText(`${job.url}jobConfigHistory/`);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = doc.querySelector('#main-panel') || doc.body;
    const found = new Set(root.innerHTML.match(/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}/g) || []);
    return [...found].sort().reverse();
  }

  async function searchHistory(job, timestamp, matcher) {
    const link = `${job.url}jobConfigHistory/configOutput?type=raw&timestamp=${timestamp}`;
    const lines = matchLines(decodeXmlEntities(await fetchText(link)), matcher);
    return lines.length ? [hitHtml(link, `${job.name} @ ${timestamp}`, lines)] : [];
  }

  const inRange = (number, ranges) => !ranges || ranges.some(r => number >= r.from && number <= r.to);

  // ui: { status(text), hit(html), error(text) }
  async function run(params, pageUrl, ui) {
    const action = normalizeAction(params.action);
    if (!action) throw new Error(`Action 값 오류: "${params.action}" (${ACTIONS.join('|')})`);
    if (!params.pattern) throw new Error('SearchPattern을 입력하세요.');
    if (!pageUrl || !/^https?:/.test(pageUrl)) throw new Error('현재 page가 Jenkins page가 아닙니다.');

    const matcher = buildMatcher(params.pattern);
    const baseUrl = resolveBaseUrl(pageUrl);
    const origin = new URL(baseUrl).origin;

    ui.status(`대상 확인 중: ${baseUrl}`);
    const info = await fetchJson(`${baseUrl}api/json?tree=jobs[name,url]`);
    const isContainer = Array.isArray(info.jobs);
    if (action === 'History' && isContainer) {
      throw new Error('History는 job page에서 실행하세요 (view/folder 불가).');
    }

    let jobs;
    let ranges = null;
    let dateRanges = null;
    if (isContainer) {
      let filter = null;
      if (params.filterIn) {
        try {
          filter = new RegExp(params.filterIn);
        } catch (e) {
          throw new Error(`FilterIn RegExp 오류: ${e.message}`);
        }
      }
      jobs = info.jobs
        .filter(j => !filter || filter.test(j.name))
        .map(j => ({ name: j.name, url: withOrigin(j.url, origin) }));
      if (params.filterIn && jobs.length === 0) {
        throw new Error(`FilterIn "${params.filterIn}"에 해당하는 job이 없습니다 (전체 ${info.jobs.length}개).`);
      }
    } else {
      if (action === 'History') dateRanges = parseDateRange(params.filterIn);
      else ranges = parseBuildRange(params.filterIn);
      const name = decodeURIComponent(baseUrl.split('/').filter(Boolean).pop());
      jobs = [{ name, url: baseUrl }];
    }

    const scope = isContainer
      ? `view/folder, job ${jobs.length}개${params.filterIn ? ` (FilterIn=${params.filterIn})` : ''}`
      : `${action === 'History' ? 'job config history' : 'job'}${params.filterIn ? `, ${action === 'History' ? '' : 'build '}${params.filterIn}` : ''}`;
    let hitCount = 0;
    const stats = { scanned: 0, missing: 0, chars: 0 };
    const errors = [];
    const report = (htmls) => { for (const h of htmls) { hitCount++; ui.hit(h); } };
    const progress = (done, total, unit) => ui.status(`${action} [${scope}] ${unit} ${done}/${total}, 결과 ${hitCount}건`);
    const guard = (label, fn) => async (item) => {
      try {
        report(await fn(item));
      } catch (e) {
        errors.push(`${label(item)}: ${e.message}`);
      }
    };

    if (action === 'History') {
      const job = jobs[0];
      ui.status(`config history 목록 조회 중: ${job.url}jobConfigHistory/`);
      const all = await listConfigHistory(job);
      if (all.length === 0) throw new Error('jobConfigHistory 목록을 찾지 못했습니다 (로그인/권한/plugin 확인).');
      const versions = all.filter(ts => inDateRange(ts, dateRanges));
      if (dateRanges && versions.length === 0) {
        throw new Error(`FilterIn "${params.filterIn}"에 해당하는 config history가 없습니다 (전체 ${all.length}개, ${all[all.length - 1]} ~ ${all[0]}).`);
      }
      await runPool(versions, guard(ts => ts, ts => searchHistory(job, ts, matcher)), (d, t) => progress(d, t, 'version'));
      ui.info(`config history ${versions.length}개 대상 (${versions[versions.length - 1]} ~ ${versions[0]})`);
    } else if (action === 'Config') {
      await runPool(jobs, guard(j => j.name, j => searchConfig(j, matcher)), (d, t) => progress(d, t, 'job'));
    } else if (action === 'Name') {
      await runPool(jobs, guard(j => j.name, async j => {
        const builds = (await listBuilds(j, 'number,displayName,description')).filter(b => inRange(b.number, ranges));
        if (ranges && builds.length === 0) throw new Error(`FilterIn "${params.filterIn}"에 해당하는 build가 없습니다.`);
        return searchDescription(j, builds, matcher);
      }), (d, t) => progress(d, t, 'job'));
    } else if (isContainer) {
      // view/folder의 Log: 각 job의 lastBuild console log
      await runPool(jobs, guard(j => j.name, j => searchLog(j, ['lastBuild'], matcher, stats)), (d, t) => progress(d, t, 'job'));
    } else {
      const job = jobs[0];
      ui.status(`build 목록 조회 중: ${job.url}`);
      const builds = (await listBuilds(job, 'number')).map(b => b.number).filter(n => inRange(n, ranges));
      if (ranges && builds.length === 0) throw new Error(`FilterIn "${params.filterIn}"에 해당하는 build가 없습니다.`);
      await runPool(builds, guard(n => `#${n}`, n => searchLog(job, [n], matcher, stats)), (d, t) => progress(d, t, 'build'));
      ui.info(`build ${builds.length}개 대상 (#${builds[builds.length - 1]} ~ #${builds[0]})`);
    }

    for (const e of errors) ui.error(e);
    if (action === 'Log') {
      ui.info(`log 검색 ${stats.scanned}개 (${stats.chars} chars), log 없음(404) ${stats.missing}개`);
    }
    ui.status(`${action} [${scope}] 완료: 결과 ${hitCount}건${errors.length ? `, 오류 ${errors.length}건` : ''}`);
  }

  return {
    USAGE, isAction, defaultParams, parseParams, run, escapeHtml,
    // job_remove_history.js와 공유
    parseValue, parseBuildRange, resolveBaseUrl, fetchJson, listBuilds, inRange, runPool
  };
})();
