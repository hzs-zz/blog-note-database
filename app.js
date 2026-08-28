// ========== 配置 ==========
const CONFIG = {
  owner: 'hzs-zz',
  repo: 'blog-note-database',
  label: 'note',
};

// ========== 状态 ==========
const token = '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';

// ========== DOM ==========
const $ = (s) => document.querySelector(s);

const noteList = $('#note-list');
const fabBtn = $('#fab-btn');
const modalOverlay = $('#modal-overlay');
const noteInput = $('#note-input');
const publishBtn = $('#publish-btn');
const publishStatus = $('#publish-status');
const modalCloseBtn = $('#modal-close-btn');

// ========== 加载笔记 ==========
loadNotes();

async function loadNotes() {
  noteList.innerHTML = '<div class="loading">加载中...</div>';

  try {
    const { owner, repo, label } = CONFIG;
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=${label}&sort=created&direction=desc&per_page=100&_t=${Date.now()}`;

    const headers = { Authorization: `Bearer ${token}` };
    const resp = await fetch(url, { headers });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const issues = await resp.json();
    const notes = issues.filter((i) => !i.pull_request);
    renderNotes(notes);
  } catch (err) {
    noteList.innerHTML = `<div class="error">加载失败：${err.message}</div>`;
  }
}

// ========== 按日期分组渲染 ==========
function renderNotes(notes) {
  if (notes.length === 0) {
    noteList.innerHTML = '<div class="loading">暂无笔记，点击右下角 + 开始写</div>';
    return;
  }

  const groups = {};
  notes.forEach((n) => {
    const date = new Date(n.created_at).toLocaleDateString('zh-CN');
    if (!groups[date]) groups[date] = [];
    groups[date].push(n);
  });

  let html = '';
  for (const [date, items] of Object.entries(groups)) {
    html += `<div class="date-group">`;
    html += `<div class="date-heading">${date}</div>`;
    items.forEach((item) => {
      const time = new Date(item.created_at).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
      });
      html += `
        <div class="note-card">
          <div class="note-time">${time}</div>
          <div class="md-body">${marked.parse(item.body || '')}</div>
        </div>`;
    });
    html += `</div>`;
  }

  noteList.innerHTML = html;
}

// ========== 弹窗开关 ==========
fabBtn.addEventListener('click', () => {
  modalOverlay.style.display = 'flex';
  noteInput.focus();
});

modalCloseBtn.addEventListener('click', closeModal);

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

function closeModal() {
  modalOverlay.style.display = 'none';
  noteInput.value = '';
  publishStatus.textContent = '';
}

// ========== 发布笔记 ==========
publishBtn.addEventListener('click', async () => {
  const body = noteInput.value.trim();
  if (!body) return;

  publishBtn.disabled = true;
  publishStatus.textContent = '发布中...';

  try {
    const { owner, repo, label } = CONFIG;

    // 1. 创建笔记
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: body.slice(0, 50),
          body: body,
          labels: [label],
        }),
      }
    );

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.message || `HTTP ${resp.status}`);
    }

    // 2. 追加日志（fire-and-forget）
    const logEntry = `- [${new Date().toLocaleString('zh-CN')}] ${body}\n`;
    appendLog(logEntry);

    closeModal();
    setTimeout(() => loadNotes(), 500);
  } catch (err) {
    publishStatus.textContent = `❌ ${err.message}`;
  } finally {
    publishBtn.disabled = false;
    setTimeout(() => {
      publishStatus.textContent = '';
    }, 3000);
  }
});

// ========== 日志追加 ==========
async function appendLog(entry) {
  try {
    const { owner, repo } = CONFIG;
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };

    // 查找已有的 log issue
    const listResp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=log&per_page=1`,
      { headers }
    );
    const issues = await listResp.json();
    const logIssue = issues.find((i) => !i.pull_request);

    if (logIssue) {
      // 超过 60000 字符就换新卷
      if ((logIssue.body || '').length > 60000) {
        await fetch(
          `https://api.github.com/repos/${owner}/${repo}/issues/${logIssue.number}`,
          { method: 'PATCH', headers, body: JSON.stringify({ state: 'closed' }) }
        );
        logIssue = null;
      }
    }

    if (logIssue) {
      // 追加内容
      const newBody = (logIssue.body || '') + entry;
      await fetch(
        `https://api.github.com/repos/${owner}/${repo}/issues/${logIssue.number}`,
        {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ body: newBody }),
        }
      );
    } else {
      // 新建日志 issue
      await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          title: '日志',
          body: entry,
          labels: ['log'],
        }),
      });
    }
  } catch (_) {
    // 日志不影响主流程
  }
}

// ========== 工具 ==========
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}