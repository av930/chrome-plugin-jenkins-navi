// Jenkins job 실행 (run 값 "job") for the run dialog.
// 여러 job URL을 shell 연산자(; && || & ( ))로 엮어 순차/병렬로 실행하고 각 build의 완료 결과를 기다린다.
// 성공 = build result가 SUCCESS (UNSTABLE/FAILURE/ABORTED 등은 실패).

const JobTrigger = (() => {
  const ACTION = 'job';
  const STOPPABLE = true; // dialog가 Stop 버튼(ui.signal)을 제공한다
  const POLL_MS = 3000;
  const STOP_WAIT_MS = 30000;

  const USAGE = `http://host/job/build_A/ BRANCH=main && http://host/job/test_A/
( http://host/job/test_1/ & http://host/job/test_2/ ) && http://host/job/deploy/
http://host/job/a/ && sleep 10 && http://host/job/b/

# job은 full URL(http(s)://…/job/<name>/)로 쓰고, 뒤에 KEY=VALUE로 build parameter를 준다. (값에 공백이 있으면 KEY="a b")
# a ; b (줄바꿈 포함)   a가 끝난 뒤 b
# a && b                 a가 성공했을 때만 b
# a || b                 a가 실패했을 때만 b
# a & b                  a, b 동시 실행 (a는 기다리지 않고 시작)
# ( … )                  그룹. 그룹 안의 병렬 job이 모두 끝나야 그룹이 끝나고, 안의 문장이 모두 성공해야 성공
# sleep N                N분 대기 (소수 가능, 항상 성공). a && sleep 10 && b | a ; sleep 20 ; b | a & ( sleep 10 && b )
# && || 가 ; & 보다 먼저 묶인다: a & b && c = a & (b && c). "a, b 모두 성공 후 c"는 ( a & b ) && c
# 연산자는 공백으로 띄워 쓴다. 단어 끝에 붙은 ; & && || ) 와 앞에 붙은 ( 도 연산자로 본다. (URL 안의 & 는 URL 그대로)
# Execute 하면 바로 실행한다. UNSTABLE은 실패로 본다.
# Stop: 실행 예정, queue 대기, 실행 중인 job을 모두 중단한다.`;

  // 대소문자, 앞뒤 공백/따옴표/기호는 무시
  function isAction(value) {
    return String(value || '').replace(/[^a-z]/gi, '').toLowerCase() === ACTION;
  }

  // 입력 전체가 실행 식이다. (dialog가 저장값 복원 시 parseParams(saved).action으로 판정한다)
  function parseParams(text) {
    return { action: ACTION, text };
  }

  function defaultParams() {
    return '';
  }

  // ---------- parser ----------

  const QUOTE_CLOSE = { '"': '"', "'": "'", '“': '”', '”': '”' };
  const TRAILING_OPS = ['&&', '||', '&;', ';', '&', ')']; // 긴 것 먼저

  function unquote(raw) {
    let out = '';
    for (let i = 0; i < raw.length;) {
      const close = QUOTE_CLOSE[raw[i]];
      if (close) {
        const end = raw.indexOf(close, i + 1);
        out += raw.slice(i + 1, end);
        i = end + 1;
      } else {
        out += raw[i++];
      }
    }
    return out;
  }

  // token: { type: 'word'|'op', value, line }. 줄바꿈은 ';' 연산자, '#' 로 시작하는 단어부터 줄 끝은 주석.
  function tokenize(text) {
    const tokens = [];
    let line = 1;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '\n') { tokens.push({ type: 'op', value: ';', line }); line++; i++; continue; }
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }

      const startLine = line;
      let raw = '';
      while (i < text.length && !/\s/.test(text[i])) {
        const close = QUOTE_CLOSE[text[i]];
        if (close) {
          const end = text.indexOf(close, i + 1);
          if (end < 0) throw new Error(`문법 오류 (${line}번째 줄): 닫히지 않은 따옴표 ${text[i]}`);
          const segment = text.slice(i, end + 1);
          line += segment.split('\n').length - 1;
          raw += segment;
          i = end + 1;
        } else {
          raw += text[i++];
        }
      }

      while (raw.startsWith('(')) { tokens.push({ type: 'op', value: '(', line: startLine }); raw = raw.slice(1); }
      const trailing = [];
      for (let found = true; found && raw;) {
        found = false;
        for (const op of TRAILING_OPS) {
          if (raw.endsWith(op)) {
            trailing.unshift(op === '&;' ? '&' : op);
            raw = raw.slice(0, -op.length);
            found = true;
            break;
          }
        }
      }
      if (raw) tokens.push({ type: 'word', value: unquote(raw), line: startLine });
      for (const op of trailing) tokens.push({ type: 'op', value: op, line });
    }
    return tokens;
  }

  function jobLabel(url) {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    const names = [];
    for (let i = 0; i < segments.length - 1; i++) {
      if (segments[i] === 'job') names.push(decodeURIComponent(segments[++i]));
    }
    return names.join('/') || segments.join('/');
  }

  // 식 -> AST. 문법 오류는 Error(message)
  // list  := stmt ((';' | '&') stmt)*          stmt := primary (('&&' | '||') primary)*  (좌결합)
  // primary := '(' list ')' | URL [KEY=VALUE ...]
  function parse(text) {
    const tokens = tokenize(text);
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (t, value) => !!t && t.type === 'op' && t.value === value;
    const fail = (t, message) => {
      throw new Error(`문법 오류 (${t ? `${t.line}번째 줄` : '끝'}): ${message}`);
    };

    function parseJob(urlToken) {
      if (!/^https?:\/\/\S+$/i.test(urlToken.value)) {
        fail(urlToken, `job은 full URL(http://…/job/<name>/)이어야 합니다: "${urlToken.value}"`);
      }
      let url;
      try {
        url = JobSearch.resolveBaseUrl(urlToken.value);
      } catch {
        fail(urlToken, `URL 형식 오류: "${urlToken.value}"`);
      }
      if (!/\/job\/[^/]+/.test(new URL(url).pathname)) {
        fail(urlToken, `job URL이 아닙니다 (/job/<name>/ 없음): "${urlToken.value}"`);
      }
      const params = [];
      while (peek() && peek().type === 'word') {
        const t = tokens[pos++];
        const eq = t.value.indexOf('=');
        const key = eq > 0 ? t.value.slice(0, eq) : '';
        if (!/^[A-Za-z_][\w.-]*$/.test(key)) {
          fail(t, `parameter는 KEY=VALUE 형식이어야 합니다: "${t.value}" (job 사이에 연산자가 필요한지 확인하세요)`);
        }
        params.push([key, t.value.slice(eq + 1)]);
      }
      return { type: 'job', url, params, label: jobLabel(url), host: new URL(url).host };
    }

    function parsePrimary() {
      const t = peek();
      if (!t) fail(null, `"${tokens[pos - 1].value}" 뒤에 job이 없습니다`);
      if (isOp(t, '(')) {
        pos++;
        const body = parseList(true);
        if (!isOp(peek(), ')')) fail(t, '"(" 에 대응하는 ")" 가 없습니다');
        pos++;
        return { type: 'group', body };
      }
      if (t.type === 'op') fail(t, `"${t.value}" 앞에 job이 없습니다`);
      pos++;
      if (t.value.toLowerCase() === 'sleep') {
        const n = peek();
        if (!n || n.type !== 'word' || !/^(\d+(\.\d*)?|\.\d+)$/.test(n.value)) {
          fail(n || t, 'sleep 뒤에는 분 단위 숫자가 필요합니다 (ex: sleep 10, sleep 0.5)');
        }
        pos++;
        return { type: 'sleep', minutes: Number(n.value) };
      }
      return parseJob(t);
    }

    function parseStatement() {
      let left = parsePrimary();
      while (isOp(peek(), '&&') || isOp(peek(), '||')) {
        const op = tokens[pos++];
        left = { type: op.value === '&&' ? 'and' : 'or', left, right: parsePrimary() };
      }
      return left;
    }

    function parseList(inGroup) {
      const items = [];
      for (;;) {
        while (isOp(peek(), ';')) pos++;
        const t = peek();
        if (!t || (inGroup && isOp(t, ')'))) break;
        const node = parseStatement();
        const next = peek();
        let bg = false;
        if (isOp(next, '&')) { bg = true; pos++; }
        else if (isOp(next, ';')) pos++;
        else if (next && !(inGroup && isOp(next, ')'))) fail(next, `예상하지 못한 "${next.value}"`);
        items.push({ node, bg });
      }
      return { type: 'list', items };
    }

    const root = parseList(false);
    if (pos < tokens.length) fail(tokens[pos], `예상하지 못한 "${tokens[pos].value}"`);
    return root;
  }

  function collectJobs(node, out = []) {
    if (node.type === 'job' || node.type === 'sleep') out.push(node);
    else if (node.type === 'group') collectJobs(node.body, out);
    else if (node.type === 'list') node.items.forEach(item => collectJobs(item.node, out));
    else { collectJobs(node.left, out); collectJobs(node.right, out); }
    return out;
  }

  // ---------- Jenkins 실행 ----------

  // ms 대기. signal이 abort되면 즉시 깨어난다.
  function sleep(ms, signal) {
    return new Promise(resolve => {
      if (signal && signal.aborted) return resolve();
      const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, ms);
      if (signal) signal.addEventListener('abort', done, { once: true });
    });
  }

  // Jenkins root별 CSRF crumb (실행 한 번 동안 재사용)
  function crumbFor(ctx, url) {
    const root = JobRemoveHistory.rootUrl(url);
    if (!ctx.crumbs.has(root)) ctx.crumbs.set(root, JobRemoveHistory.crumbHeaders(url));
    return ctx.crumbs.get(root);
  }

  // 응답 body가 필요 없는 POST (stop, cancelItem은 redirect로 응답한다)
  async function postAction(ctx, url) {
    const resp = await fetch(url, {
      method: 'POST', credentials: 'include', headers: await crumbFor(ctx, url), redirect: 'manual'
    });
    if (resp.type !== 'opaqueredirect' && !resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  }

  // job 하나를 실행하고 build가 끝날 때까지 기다린다. 성공 여부(boolean)를 돌려주며 throw하지 않는다.
  async function runJob(job, ctx) {
    const { signal } = ctx;
    if (signal.aborted) {
      ctx.set(job, 'ABORTED', '시작 전에 중단됨');
      return false;
    }
    try {
      const origin = new URL(job.url).origin;
      const root = JobRemoveHistory.rootUrl(job.url);
      const info = await JobSearch.fetchJson(`${job.url}api/json?tree=buildable,property[parameterDefinitions[name]]`);
      if (info.buildable === undefined) throw new Error('job이 아닙니다 (view/folder)');
      if (!info.buildable) throw new Error('비활성(disabled) job입니다');
      const parameterized = (info.property || []).some(p => (p.parameterDefinitions || []).length > 0);
      if (job.params.length && !parameterized) throw new Error('parameter가 없는 job에 parameter를 지정했습니다');

      const headers = await crumbFor(ctx, job.url);
      if (signal.aborted) {
        ctx.set(job, 'ABORTED', '시작 전에 중단됨');
        return false;
      }
      const resp = await fetch(`${job.url}${parameterized ? 'buildWithParameters' : 'build'}`, {
        method: 'POST', credentials: 'include', headers, body: new URLSearchParams(job.params), redirect: 'manual'
      });
      const location = resp.headers.get('Location');
      if (resp.status !== 201 || !location) throw new Error(`build 요청 실패 (HTTP ${resp.status})`);
      const queueUrl = origin + new URL(location, job.url).pathname;
      const itemId = (queueUrl.match(/\/queue\/item\/(\d+)\//) || [])[1];
      if (!itemId) throw new Error(`queue item URL을 알 수 없습니다: ${location}`);

      // queue 대기 -> build 시작. stopAt: 중단 요청 후 종료를 기다리는 한계 시각 (0 = 요청 전)
      ctx.set(job, 'QUEUED');
      let stopAt = 0;
      let build = null;
      while (!build) {
        if (signal.aborted && !stopAt) {
          stopAt = Date.now() + STOP_WAIT_MS;
          await postAction(ctx, `${root}queue/cancelItem?id=${itemId}`).catch(() => {});
        }
        const item = await JobSearch.fetchJson(`${queueUrl}api/json`);
        if (item.cancelled) {
          ctx.set(job, 'ABORTED', 'queue에서 취소됨');
          return false;
        }
        if (item.executable) {
          build = { number: item.executable.number, url: `${job.url}${item.executable.number}/` };
          break;
        }
        if (stopAt && Date.now() > stopAt) throw new Error('queue 취소 요청 후에도 대기 중입니다');
        await (stopAt ? sleep(1000) : sleep(POLL_MS, signal));
      }

      // build 실행 -> 완료
      ctx.set(job, 'RUNNING', '', build);
      stopAt = 0;
      for (;;) {
        if (signal.aborted && !stopAt) {
          stopAt = Date.now() + STOP_WAIT_MS;
          await postAction(ctx, `${build.url}stop`).catch(() => {});
        }
        const state = await JobSearch.fetchJson(`${build.url}api/json?tree=building,result`);
        if (!state.building && state.result) {
          ctx.set(job, state.result, '', build);
          return state.result === 'SUCCESS';
        }
        if (stopAt && Date.now() > stopAt) throw new Error('stop 요청 후에도 종료되지 않았습니다');
        await (stopAt ? sleep(1000) : sleep(POLL_MS, signal));
      }
    } catch (e) {
      ctx.set(job, 'ERROR', e.message);
      return false;
    }
  }

  const formatRemaining = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // sleep N: N분 대기 후 성공. 종료 시각 기준으로 계산한다 (창이 가려져 timer가 늦어져도 어긋나지 않음)
  async function runSleep(step, ctx) {
    const { signal } = ctx;
    if (signal.aborted) {
      ctx.set(step, 'ABORTED');
      return false;
    }
    const endAt = Date.now() + step.minutes * 60000;
    for (let left = endAt - Date.now(); left > 0; left = endAt - Date.now()) {
      ctx.set(step, 'WAITING', `남은 시간 ${formatRemaining(left)}`);
      await sleep(Math.min(1000, left), signal);
      if (signal.aborted) {
        ctx.set(step, 'ABORTED');
        return false;
      }
    }
    ctx.set(step, 'SUCCESS');
    return true;
  }

  // 실행되지 않는 하위 job을 SKIPPED(중단 중이면 ABORTED)로 표시
  function markNotRun(node, ctx) {
    for (const job of collectJobs(node)) {
      if (job.status === 'PENDING') ctx.set(job, ctx.signal.aborted ? 'ABORTED' : 'SKIPPED');
    }
  }

  // node를 평가해 성공 여부를 돌려준다.
  // list: 문장을 차례로 평가하되 '&' 문장은 기다리지 않고 시작한다. 끝에서 시작한 문장을 모두 기다리고, 전부 성공해야 성공.
  async function evaluate(node, ctx) {
    switch (node.type) {
      case 'job':
        return runJob(node, ctx);
      case 'sleep':
        return runSleep(node, ctx);
      case 'group':
        return evaluate(node.body, ctx);
      case 'and':
        if (await evaluate(node.left, ctx)) return evaluate(node.right, ctx);
        markNotRun(node.right, ctx);
        return false;
      case 'or':
        if (!(await evaluate(node.left, ctx))) return evaluate(node.right, ctx);
        markNotRun(node.right, ctx);
        return true;
      case 'list': {
        const background = [];
        let ok = true;
        for (const { node: statement, bg } of node.items) {
          if (ctx.signal.aborted) {
            markNotRun(statement, ctx);
            ok = false;
            continue;
          }
          const result = evaluate(statement, ctx);
          if (bg) background.push(result);
          else ok = (await result) && ok;
        }
        for (const result of await Promise.all(background)) ok = result && ok;
        return ok;
      }
    }
  }

  function rowHtml(job) {
    const esc = JobSearch.escapeHtml;
    if (job.type === 'sleep') {
      return `<span class="st st-${esc(job.status)}">${esc(job.status)}</span> sleep ${job.minutes}분` +
        (job.message ? ` <span class="line-no">${esc(job.message)}</span>` : '');
    }
    const link = job.build
      ? `<a href="${esc(job.build.url)}">${esc(job.label)} #${job.build.number}</a>`
      : `<a href="${esc(job.url)}">${esc(job.label)}</a>`;
    const params = job.params.length
      ? ` <span class="line-no">${esc(job.params.map(([k, v]) => `${k}=${v}`).join(' '))}</span>` : '';
    const message = job.message ? ` <span class="error">${esc(job.message)}</span>` : '';
    return `<span class="st st-${esc(job.status)}">${esc(job.status)}</span> ${link}${params}` +
      ` <span class="line-no">${esc(job.host)}</span>${message}`;
  }

  // ui: { status(text), line(html) -> { set(html) }, signal(AbortSignal) }
  async function run(params, pageUrl, ui) {
    const root = parse(params.text);
    const jobs = collectJobs(root);
    if (jobs.length === 0) throw new Error('실행할 job이 없습니다.');

    const counts = () => {
      const byStatus = {};
      for (const j of jobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1;
      return Object.entries(byStatus).map(([status, n]) => `${status} ${n}`).join(', ');
    };
    const ctx = {
      signal: ui.signal,
      crumbs: new Map(),
      set(job, status, message = '', build = job.build) {
        Object.assign(job, { status, message, build });
        job.row.set(rowHtml(job));
        ui.status(`${ui.signal.aborted ? '중단 중' : '실행 중'} (${jobs.length}단계): ${counts()}`);
      }
    };
    for (const job of jobs) {
      Object.assign(job, { status: 'PENDING', message: '', build: null });
      job.row = ui.line(rowHtml(job));
    }
    ui.status(`실행 시작 (${jobs.length}단계)`);

    const ok = await evaluate(root, ctx);
    ui.status(`${ok ? '성공' : '실패'}${ui.signal.aborted ? ' (중단됨)' : ''} (${jobs.length}단계): ${counts()}`);
  }

  return { USAGE, STOPPABLE, isAction, defaultParams, parseParams, run };
})();
