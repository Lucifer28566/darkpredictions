/* ============================================================
   vip.js — VIP private 1-on-1 chat with the admin.
   Reads:  #vipGuard, #vipShell, #vipChatThread, #vipChatEmpty,
           #vipChatForm, #vipChatInput, #vipChatStatus
   ============================================================ */
(function () {
  var POLL_MS = 8000;

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function showStatus(text, kind) {
    var el = $('#vipChatStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = kind === 'error' ? '#ff6f6f' : (kind === 'ok' ? 'var(--gold-2)' : 'var(--muted)');
  }

  function renderMessages(messages) {
    var thread = $('#vipChatThread');
    var empty = $('#vipChatEmpty');
    if (!thread) return;
    if (!messages || !messages.length) {
      if (empty) empty.style.display = '';
      thread.querySelectorAll('.chat-msg').forEach(function (n) { n.remove(); });
      return;
    }
    if (empty) empty.style.display = 'none';
    thread.querySelectorAll('.chat-msg').forEach(function (n) { n.remove(); });
    messages.forEach(function (m) {
      var isMe = m.from === 'user';
      var row = document.createElement('div');
      row.className = 'chat-msg ' + (isMe ? 'chat-msg-me' : 'chat-msg-admin');
      row.innerHTML =
        '<div class="chat-bubble">' +
          '<div class="chat-bubble-body">' + esc(m.body).replace(/\n/g, '<br>') + '</div>' +
          '<div class="chat-bubble-time">' + esc(fmtTime(m.createdAt)) + '</div>' +
        '</div>';
      thread.appendChild(row);
    });
    // Scroll to bottom
    thread.scrollTop = thread.scrollHeight;
  }

  async function loadConversation() {
    try {
      var res = await fetch('/api/vip/conversation', { credentials: 'include' });
      var data = await res.json();
      if (!res.ok) {
        showStatus(data.error || 'Could not load messages.', 'error');
        return;
      }
      renderMessages(data.messages || []);
    } catch (err) {
      console.error(err);
    }
  }

  async function sendMessage(body) {
    var res = await fetch('/api/vip/conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ body: body }),
    });
    var data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Send failed.');
    return data;
  }

  async function init() {
    var guard = $('#vipGuard');
    var shell = $('#vipShell');

    var user = (window.DP && window.DP.getMe) ? await window.DP.getMe() : null;
    if (!user) {
      if (guard) {
        guard.style.display = 'flex';
        var msg = $('#vipGuardMsg');
        if (msg) msg.textContent = 'Sign in with your VIP account to open the private line.';
      }
      return;
    }
    if (user.role !== 'vip' && user.role !== 'developer') {
      if (guard) guard.style.display = 'flex';
      return;
    }

    if (shell) shell.style.display = '';
    await loadConversation();

    var form = $('#vipChatForm');
    var input = $('#vipChatInput');
    if (form && input) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        var btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        showStatus('Sending…');
        try {
          await sendMessage(text);
          input.value = '';
          showStatus('');
          await loadConversation();
        } catch (err) {
          showStatus(err.message || 'Send failed.', 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });

      // Enter to send, Shift+Enter for newline
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          form.requestSubmit();
        }
      });
    }

    // Poll for new admin replies every 8s while page is visible
    setInterval(function () {
      if (document.visibilityState === 'visible') loadConversation();
    }, POLL_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
