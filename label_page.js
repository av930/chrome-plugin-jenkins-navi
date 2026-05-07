const pageParams = new URLSearchParams(window.location.search);
const serverName = pageParams.get('server') || '';
const siteUrl = pageParams.get('site') || '';
const labelsApiUrl = siteUrl
  ? `${siteUrl.replace(/\/+$/, '')}/computer/api/json?tree=computer[displayName,url,offline,temporarilyOffline,assignedLabels[name]]`
  : '';

const labelGrid = document.getElementById('labelGrid');
const labelCountElement = document.getElementById('labelCount');
const nodeCountElement = document.getElementById('nodeCount');
const nodeStatusSummaryElement = document.getElementById('nodeStatusSummary');
const frequentNodesElement = document.getElementById('frequentNodes');
const serverNameElement = document.getElementById('serverName');
const pageStatus = document.getElementById('pageStatus');
const serverNodeLink = document.getElementById('serverNodeLink');
const refreshButton = document.getElementById('refreshButton');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(message = '', isError = false) {
  pageStatus.textContent = message;
  pageStatus.className = isError ? 'page-status error' : 'page-status';
}

function getNodeUrl(computer) {
  if (typeof computer?.url === 'string' && computer.url.trim()) {
    return computer.url;
  }

  const nodeName = typeof computer?.displayName === 'string' ? computer.displayName.trim() : '';
  if (!siteUrl || !nodeName) {
    return '#';
  }

  return `${siteUrl.replace(/\/+$/, '')}/computer/${encodeURIComponent(nodeName)}/`;
}

function buildLabelEntries(computers = []) {
  const labels = new Map();

  computers.forEach(computer => {
    const nodeName = computer.displayName || 'unknown';
    const nodeLabels = Array.isArray(computer.assignedLabels) ? computer.assignedLabels.slice(1) : [];
    const nodeUrl = getNodeUrl(computer);

    nodeLabels.forEach(label => {
      const labelName = typeof label?.name === 'string' ? label.name.trim() : '';
      if (!labelName) {
        return;
      }

      if (!labels.has(labelName)) {
        labels.set(labelName, []);
      }

      labels.get(labelName).push({
        name: nodeName,
        url: nodeUrl,
        offline: Boolean(computer.offline || computer.temporarilyOffline)
      });
    });
  });

  return Array.from(labels.entries())
    .map(([name, nodes]) => ({
      name,
      nodes: nodes.sort((left, right) => left.name.localeCompare(right.name))
    }))
    .sort((left, right) => {
      if (right.nodes.length !== left.nodes.length) {
        return right.nodes.length - left.nodes.length;
      }
      return left.name.localeCompare(right.name);
    });
}

function buildNodeSummary(computers = []) {
  const summary = {
    online: 0,
    offline: 0,
    topNodes: []
  };

  const nodeLabelCounts = new Map();

  computers.forEach(computer => {
    const nodeName = computer.displayName || 'unknown';
    const nodeLabels = Array.isArray(computer.assignedLabels) ? computer.assignedLabels.slice(1) : [];
    const offline = Boolean(computer.offline || computer.temporarilyOffline);
    const nodeUrl = getNodeUrl(computer);

    if (offline) {
      summary.offline += 1;
    } else {
      summary.online += 1;
    }

    nodeLabelCounts.set(nodeName, {
      count: nodeLabels.length,
      url: nodeUrl
    });
  });

  summary.topNodes = Array.from(nodeLabelCounts.entries())
    .map(([name, data]) => ({ name, count: data.count, url: data.url }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, 3);

  return summary;
}

function renderFrequentNodes(topNodes = []) {
  if (topNodes.length === 0) {
    frequentNodesElement.innerHTML = '<span class="summary-list-empty">-</span>';
    return;
  }

  frequentNodesElement.innerHTML = topNodes.map((node, index) => (
    `<div class="summary-list-item"><span class="summary-rank">${index + 1}.</span><a class="summary-node-link" href="${escapeHtml(node.url)}">${escapeHtml(node.name)}</a><span class="summary-node-count">${node.count}</span></div>`
  )).join('');
}

function renderEmptyState(message) {
  labelGrid.innerHTML = `<div class="empty-state">${message}</div>`;
}

function renderLabels(computers) {
  const labelEntries = buildLabelEntries(computers);
  const nodeSummary = buildNodeSummary(computers);
  labelCountElement.textContent = String(labelEntries.length);
  nodeCountElement.textContent = String(Array.isArray(computers) ? computers.length : 0);
  nodeStatusSummaryElement.textContent = `${nodeSummary.online} online + ${nodeSummary.offline} offline`;
  renderFrequentNodes(nodeSummary.topNodes);

  if (labelEntries.length === 0) {
    renderEmptyState('No labels were found in assignedLabels[1:].');
    return;
  }

  labelGrid.innerHTML = labelEntries.map(entry => {
    const labelUrl = `${siteUrl.replace(/\/+$/, '')}/label/${encodeURIComponent(entry.name)}/`;
    const nodeChips = entry.nodes.map(node => {
      const chipClass = node.offline ? 'node-chip offline' : 'node-chip';
      return `<a class="${chipClass}" href="${escapeHtml(node.url)}">${escapeHtml(node.name)}</a>`;
    }).join('');

    return `
      <article class="label-card">
        <div class="label-card-header">
          <h2><a class="label-title-link" href="${labelUrl}">${escapeHtml(entry.name)}</a></h2>
        </div>
        <div class="node-list">${nodeChips}</div>
        ${entry.nodes.length > 3 ? `<div class="label-count-row"><span class="label-count-pill">${entry.nodes.length} node${entry.nodes.length === 1 ? '' : 's'}</span></div>` : ''}
      </article>
    `;
  }).join('');
}

async function fetchLabels() {
  if (!siteUrl) {
    setStatus('Missing Jenkins site URL.', true);
    renderEmptyState('Cannot load labels without a Jenkins server URL.');
    return;
  }

  setStatus('Loading labels from Jenkins...');
  renderEmptyState('Loading labels...');

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'getJenkinsLabels',
      url: labelsApiUrl
    });

    if (!response?.ok) {
      throw new Error(response?.error || 'Unknown error');
    }

    const computers = Array.isArray(response.data?.computer) ? response.data.computer : [];
    setStatus(`Loaded ${computers.length} nodes from Jenkins.`);
    renderLabels(computers);
  } catch (error) {
    console.error('Failed to load labels:', error);
    setStatus(`Failed to load labels: ${error.message}`, true);
    renderEmptyState('Jenkins label data could not be loaded.');
  }
}

function initializePage() {
  serverNameElement.textContent = serverName || 'Unknown';
  serverNodeLink.href = siteUrl ? `${siteUrl.replace(/\/+$/, '')}/computer/` : '#';

  refreshButton.addEventListener('click', () => {
    fetchLabels();
  });

  fetchLabels();
}

initializePage();