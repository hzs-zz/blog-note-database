// ========== 配置 ==========
const CONFIG = {
  owner: 'hzs-zz',
  repo: 'blog-note-database',
  label: 'note',
};

// ========== 状态 ==========
const ENCRYPTED_READ = '4354235760243d3b28422723107e0100072a1a261114723c3f053e403616051f592d393323523100593c0a230b4504040e675b572f143f2e25097f59203e094a1f332a6121203a20252b025162151d152927';
const ENCRYPTED_WRITE = 'sbBxqk69jPr3fYM2lWIx0VS5PUZacXz4n0pwZL8I1c0hI7CrxFGDJoCjdkxv6JCzneKwwaeoavKiG+WgcSIQolU+ZpN6LJ2wuifhYPQCKw6v0KPkwD6QlkxQICBNF1XqvbBG5ANFbvXup8qt588=';

function xorDecrypt(hex, key) {
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key.charCodeAt((i / 2) % key.length));
  }
  return out;
}

async function aesGcmDecrypt(base64, password) {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const data = raw.slice(28);
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  const key = await crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['decrypt']);
  const combined = new Uint8Array(data.length + tag.length);
  combined.set(data, 0);
  combined.set(tag, data.length);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined);
  return new TextDecoder().decode(decrypted);
}

let token = getToken();
let writeToken = null;

function getToken() {
  return 'github_pat_' + xorDecrypt(ENCRYPTED_READ, 'read-only');
}

async function getWriteToken() {
  if (writeToken) return writeToken;
  const cached = localStorage.getItem('gh_wtoken');
  if (cached) { writeToken = cached; return writeToken; }
  const key = prompt('请输入发布密码：');
  if (!key) return '';
  try {
    writeToken = 'github_pat_' + await aesGcmDecrypt(ENCRYPTED_WRITE, key);
    localStorage.setItem('gh_wtoken', writeToken);
    return writeToken;
  } catch {
    alert('密码错误');
    return '';
  }
}

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
document.addEventListener('DOMContentLoaded', loadNotes);

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
          <div class="md-body">${sanitizeHtml(marked.parse(item.body || ''))}</div>
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
    const wToken = await getWriteToken();
    if (!wToken) { publishStatus.textContent = '⚠️ 需要发布密码'; publishBtn.disabled = false; return; }

    // 1. 创建笔记
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${wToken}`,
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
    const wToken = await getWriteToken();
    if (!wToken) return;
    const headers = {
      Authorization: `Bearer ${wToken}`,
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
function sanitizeHtml(html) {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*\S+/gi, '')
    .replace(/javascript\s*:/gi, '');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}