/* Dark Predictions — auth: nav state, login/signup forms, logout */
(function () {
  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/);
    var a = parts[0] ? parts[0][0] : '?';
    var b = parts[1] ? parts[1][0] : '';
    return (a + b).toUpperCase();
  }

  async function getMe() {
    try {
      var res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      var data = await res.json();
      return data.user || null;
    } catch (e) {
      return null;
    }
  }

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); } catch (e) {}
    window.location.href = '/index.html';
  }

  function authAreaHtml(user) {
    if (!user) {
      return (
        '<a class="btn btn-ghost btn-sm" href="/login.html">Log in</a>' +
        '<a class="btn btn-gold btn-sm" href="/signup.html">Create account</a>'
      );
    }
    var adminLink = user.role === 'developer'
      ? '<a class="btn btn-gold btn-sm hide-sm" href="/admin.html">Admin panel</a>'
      : '';
    return (
      '<div class="who"><div class="avatar">' + escapeHtml(initials(user.displayName)) + '</div>' +
      '<b>' + escapeHtml(user.displayName) + '</b></div>' +
      adminLink +
      '<button type="button" class="btn-link" id="dpLogoutBtn">Log out</button>'
    );
  }

  function mobileExtraHtml(user) {
    if (!user) {
      return (
        '<a href="/login.html">Log in</a>' +
        '<a href="/signup.html">Create account</a>'
      );
    }
    var adminLink = user.role === 'developer' ? '<a href="/admin.html">Admin panel</a>' : '';
    return adminLink + '<a href="#" id="dpLogoutBtnMobile">Log out</a>';
  }

  async function renderNavAuth() {
    var area = document.getElementById('auth-area');
    var navLinks = document.querySelector('.nav-links');
    var user = await getMe();

    if (area) {
      area.innerHTML = authAreaHtml(user);
      var btn = document.getElementById('dpLogoutBtn');
      if (btn) btn.addEventListener('click', logout);
    }

    if (navLinks && !navLinks.querySelector('.mobile-auth-extra')) {
      var wrap = document.createElement('div');
      wrap.className = 'mobile-auth-extra';
      wrap.innerHTML = mobileExtraHtml(user);
      navLinks.appendChild(wrap);
      var btnM = document.getElementById('dpLogoutBtnMobile');
      if (btnM) btnM.addEventListener('click', function (e) { e.preventDefault(); logout(); });
    }

    return user;
  }

  function showMsg(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.className = 'form-msg show ' + (type || 'error');
  }

  // Firebase Auth writes the session to IndexedDB asynchronously. If we
  // navigate away the instant the sign-in/sign-up promise resolves, that
  // write can be cut short by the page unload, so the very next page loads
  // with no session at all (you get sent right back to the login/guard
  // screen). Waiting briefly before redirecting gives that write time to
  // finish so the next page actually recognizes you as logged in.
  function waitForAuthPersisted() {
    return new Promise(function (resolve) { setTimeout(resolve, 700); });
  }

  function wireLoginForm() {
    var form = document.getElementById('loginForm');
    if (!form) return;
    var msg = document.getElementById('loginMsg');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        var res = await fetch('/api/auth/login', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email.value,
            password: form.password.value,
          }),
        });
        var data = await res.json();
        if (!res.ok) { showMsg(msg, data.error || 'Could not log in.', 'error'); btn.disabled = false; return; }
        showMsg(msg, 'Logged in — redirecting…', 'ok');
        await waitForAuthPersisted();
        var params = new URLSearchParams(window.location.search);
        if (params.get('next') === 'checkout' && params.get('plan')) {
          window.location.href = '/pricing.html?next=checkout&plan=' + encodeURIComponent(params.get('plan'));
          return;
        }
        window.location.href = data.user.role === 'developer' ? '/admin.html' : '/predictions.html';
      } catch (err) {
        showMsg(msg, 'Network error, please try again.', 'error');
        btn.disabled = false;
      }
    });
  }

  function wireSignupForm() {
    var form = document.getElementById('signupForm');
    if (!form) return;
    var msg = document.getElementById('signupMsg');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      if (form.password.value !== form.confirm.value) {
        showMsg(msg, 'Passwords do not match.', 'error');
        return;
      }
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        var res = await fetch('/api/auth/signup', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email.value,
            password: form.password.value,
            displayName: form.displayName.value,
          }),
        });
        var data = await res.json();
        if (!res.ok) { showMsg(msg, data.error || 'Could not create account.', 'error'); btn.disabled = false; return; }
        showMsg(msg, 'Account created — redirecting…', 'ok');
        await waitForAuthPersisted();
        var params = new URLSearchParams(window.location.search);
        if (params.get('next') === 'checkout' && params.get('plan')) {
          window.location.href = '/pricing.html?next=checkout&plan=' + encodeURIComponent(params.get('plan'));
          return;
        }
        window.location.href = data.user.role === 'developer' ? '/admin.html' : '/predictions.html';
      } catch (err) {
        showMsg(msg, 'Network error, please try again.', 'error');
        btn.disabled = false;
      }
    });
  }

  function wireForgotPasswordForm() {
    var form = document.getElementById('forgotForm');
    if (!form) return;
    var msg = document.getElementById('forgotMsg');
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        var res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: form.email.value }),
        });
        var data = await res.json();
        if (!res.ok) { showMsg(msg, data.error || 'Could not send reset link.', 'error'); btn.disabled = false; return; }
        showMsg(msg, 'If an account exists for this email, a reset link is on its way. Check your inbox (and spam folder).', 'ok');
        form.reset();
      } catch (err) {
        showMsg(msg, 'Network error, please try again.', 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    renderNavAuth();
    wireLoginForm();
    wireSignupForm();
    wireForgotPasswordForm();
  });

  window.DP = { getMe: getMe, logout: logout, escapeHtml: escapeHtml, renderNavAuth: renderNavAuth };
})();
