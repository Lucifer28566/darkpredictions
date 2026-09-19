/* ============================================================
   wall.js — The Wall: public comments / reviews / suggestions.
   Anyone can read the list. Posting requires basic/gold/vip/developer.
   ============================================================ */
(function () {
  var POST_ROLES = ['basic', 'gold', 'vip', 'developer'];

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    var a = parts[0] ? parts[0][0] : '?';
    var b = parts[1] ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function showFormMsg(text, kind) {
    var el = $('#wallFormMsg');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = kind === 'error' ? '#ff6f6f' : (kind === 'ok' ? 'var(--gold-2)' : 'var(--muted)');
  }

  function renderPosts(posts) {
    var list = $('#wallList');
    var empty = $('#wallEmpty');
    var loading = $('#wallLoading');
    if (loading) loading.style.display = 'none';
    if (!list) return;
    if (!posts || !posts.length) {
      list.innerHTML = '';
      if (empty) empty.style.display = '';
      return;
    }
    if (empty) empty.style.display = 'none';
    list.innerHTML = posts.map(function (p) {
      return (
        '<article class="wall-post">' +
          '<div class="wall-post-head">' +
            '<div class="wall-post-author">' +
              '<div class="wall-post-avatar">' + esc(initials(p.authorName)) + '</div>' +
              '<div><div class="wall-post-name">' + esc(p.authorName || 'Member') + '</div>' +
              '<div class="wall-post-when">' + esc(fmtTime(p.createdAt)) + (p.editedByAdmin ? ' · edited by admin' : '') + '</div></div>' +
            '</div>' +
            '<span class="wall-post-tag">' + esc(p.type || 'Comment') + '</span>' +
          '</div>' +
          '<p class="wall-post-body">' + esc(p.body) + '</p>' +
        '</article>'
      );
    }).join('');
    list.querySelectorAll('.wall-post').forEach(function (el) {
      requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'none'; });
    });
  }

  async function loadPosts() {
    try {
      var res = await fetch('/api/wall');
      var data = await res.json();
      renderPosts(data.posts || []);
    } catch (err) {
      console.error(err);
      var loading = $('#wallLoading');
      if (loading) loading.textContent = 'Could not load the Wall right now.';
    }
  }

  function wireTypeButtons() {
    var row = $('#wallTypeRow');
    if (!row) return null;
    var selected = 'Comment';
    row.querySelectorAll('.wall-type-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        row.querySelectorAll('.wall-type-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        selected = btn.getAttribute('data-type');
      });
    });
    return function getSelected() { return selected; };
  }

  async function init() {
    var compose = $('#wallCompose');
    var guard = $('#wallGuard');
    var form = $('#wallForm');
    var input = $('#wallInput');
    var getSelectedType = wireTypeButtons();

    var user = (window.DP && window.DP.getMe) ? await window.DP.getMe() : null;
    var canPost = !!user && POST_ROLES.indexOf(user.role) !== -1;

    if (canPost) {
      if (compose) compose.style.display = '';
    } else {
      if (guard) {
        guard.style.display = 'flex';
        var msg = $('#wallGuardMsg');
        if (!user && msg) msg.textContent = 'Anyone can read the Wall below. Sign in with a Basic account or higher to post.';
        else if (user && msg) msg.textContent = 'Your current plan doesn\u2019t include posting on the Wall. Upgrade to Basic, Gold or VIP to join the conversation.';
      }
    }

    await loadPosts();

    if (form && input) {
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var text = input.value.trim();
        if (!text) return;
        var btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        showFormMsg('Posting…');
        try {
          var res = await fetch('/api/wall', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ body: text, type: getSelectedType ? getSelectedType() : 'Comment' }),
          });
          var data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Could not post.');
          input.value = '';
          showFormMsg('Posted \u2713', 'ok');
          await loadPosts();
        } catch (err) {
          showFormMsg(err.message || 'Could not post.', 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
