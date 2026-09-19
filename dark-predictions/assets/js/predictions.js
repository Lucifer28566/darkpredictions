/* Dark Predictions — renders the predictions board from /api/predictions
   Supports photos & videos. Locks content behind paid tiers (basic/gold/vip). */
(function () {
  var esc = function (s) { return window.DP ? window.DP.escapeHtml(s) : s; };

  var TIER_LABEL = {
    free:  'Free for all members',
    basic: 'Unlock with Basic, Gold or VIP',
    gold:  'Unlock with Gold or VIP',
    vip:   'VIP exclusive',
  };
  var TIER_BTN = { basic: 'Subscribe', gold: 'Subscribe', vip: 'Get VIP' };

  // Tier hierarchy — what each role can see (developer sees everything).
  // Free tier content is visible to all authenticated users.
  function canAccess(userRole, tier) {
    if (userRole === 'developer') return true;
    if (!tier || tier === 'free') return true; // All authenticated users see free content
    if (tier === 'basic') return ['trial', 'basic', 'gold', 'vip'].indexOf(userRole) !== -1;
    if (tier === 'gold')  return ['gold', 'vip'].indexOf(userRole) !== -1;
    if (tier === 'vip')   return userRole === 'vip';
    return false;
  }

  function youtubeId(url) {
    var m = url.match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/);
    return m ? m[1] : null;
  }
  function vimeoId(url) {
    var m = url.match(/vimeo\.com\/(?:.*\/)?(\d+)/);
    return m ? m[1] : null;
  }
  // YouTube Shorts and TikTok-style links are near-always vertical (9:16).
  // We can't read the real aspect ratio without an API call, so we use the
  // URL shape as a reliable heuristic for "this is portrait video".
  function isLikelyPortraitVideo(url) {
    return /youtube\.com\/shorts\//i.test(url) || /tiktok\.com/i.test(url);
  }

  function renderMedia(p) {
    var html = '';
    if (p.imageUrl) {
      html += '<div class="pick-media"><button type="button" class="pick-media-zoom" data-full="' + esc(p.imageUrl) + '" data-caption="' + esc(p.title || '') + '" aria-label="View image full size">' +
        '<img src="' + esc(p.imageUrl) + '" alt="" loading="lazy" onerror="this.closest(\'.pick-media\').style.display=\'none\'" />' +
      '</button></div>';
    }
    if (p.videoUrl) {
      var yt = youtubeId(p.videoUrl);
      var vm = vimeoId(p.videoUrl);
      var portraitCls = isLikelyPortraitVideo(p.videoUrl) ? ' portrait' : '';
      if (yt) {
        html += '<div class="pick-media video' + portraitCls + '"><iframe src="https://www.youtube.com/embed/' + esc(yt) + '" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>';
      } else if (vm) {
        html += '<div class="pick-media video' + portraitCls + '"><iframe src="https://player.vimeo.com/video/' + esc(vm) + '" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>';
      } else {
        html += '<div class="pick-media"><video src="' + esc(p.videoUrl) + '" controls preload="metadata"></video></div>';
      }
    }
    return html;
  }

  function renderUnlocked(p, i) {
    var delayClass = i % 4 === 1 ? ' d1' : i % 4 === 2 ? ' d2' : i % 4 === 3 ? ' d3' : '';
    var category = esc(p.league) + (p.timeLabel ? ' · ' + esc(p.timeLabel) : '');
    return (
      '<article class="pick reveal' + delayClass + '">' +
        renderMedia(p) +
        '<div class="body">' +
          '<div class="top"><span class="league"><span class="dot"></span>' + category + '</span></div>' +
          '<h4>' + esc(p.title) + '</h4>' +
          (p.pick ? '<p class="pick-body">' + esc(p.pick) + '</p>' : '') +
          (p.confidence ? '<div class="pick-tag">' + esc(p.confidence) + '</div>' : '') +
          '<div style="margin-top:12px">' +
            '<button type="button" class="btn-link thanks-btn" data-thanks="' + esc(p.id) + '" style="font-size:13px;padding:6px 12px;border:1px solid var(--line);border-radius:999px">' +
              '\uD83D\uDE4F Thank you' + (p.thanksCount ? ' \u00B7 ' + p.thanksCount : '') +
            '</button>' +
          '</div>' +
        '</div>' +
      '</article>'
    );
  }

  function renderLocked(p, i) {
    var delayClass = i % 4 === 1 ? ' d1' : i % 4 === 2 ? ' d2' : i % 4 === 3 ? ' d3' : '';
    var category = esc(p.league) + (p.timeLabel ? ' · ' + esc(p.timeLabel) : '');
    return (
      '<a href="pricing.html" class="pick locked clickable reveal' + delayClass + '" aria-label="Unlock this prediction — view pricing">' +
        '<div class="body">' +
          '<div class="top"><span class="league"><span class="dot"></span>' + category + '</span></div>' +
          '<h4>' + esc(p.title) + '</h4>' +
          '<div class="pick-blur">' +
            '<span>•••••••• ••••••••</span>' +
            '<span>•••••••• ••••••••</span>' +
            '<span>••••• ••••••</span>' +
          '</div>' +
        '</div>' +
        '<div class="lock">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
          '<span>' + TIER_LABEL[p.tier] + '</span>' +
          (TIER_BTN[p.tier] ? '<span class="btn btn-gold btn-sm pulse">' + TIER_BTN[p.tier] + '</span>' : '') +
        '</div>' +
      '</a>'
    );
  }

  function wireThanksButtons(root) {
    root.querySelectorAll('.thanks-btn').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-thanks');
        btn.disabled = true;
        try {
          var res = await fetch('/api/predictions/' + encodeURIComponent(id) + '/thanks', { method: 'POST', credentials: 'same-origin' });
          var data = await res.json();
          if (res.status === 401) { window.location.href = '/login.html'; return; }
          if (data.already) { btn.textContent = '\uD83D\uDE4F Thanked'; return; }
          if (data.ok) { btn.textContent = '\uD83D\uDE4F Thank you \u00B7 ' + data.thanksCount; }
        } catch (e) { console.error(e); btn.disabled = false; }
      });
    });
  }

  function wireLockedClicks(root) {
    // Locked cards are now real <a href="pricing.html"> links (see renderLocked),
    // so plain taps/clicks always navigate even without JS. We just keep
    // keyboard/focus niceties here for older markup if any is left around.
    root.querySelectorAll('.pick.locked[data-href]').forEach(function (card) {
      card.setAttribute('role', 'link');
      card.setAttribute('tabindex', '0');
      var dest = card.getAttribute('data-href');
      function go() { window.location.href = dest; }
      card.addEventListener('click', go);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });
  }

  /* Tap/click a prediction's image to view it full size (works on desktop
     and mobile — the mobile-only "looks clickable" feeling people get is
     just the browser's native pinch-zoom; this gives the same result with
     a plain click everywhere). */
  function wireImageLightbox(root) {
    var lb = document.getElementById('lightbox');
    var lbImg = document.getElementById('lightboxImg');
    var lbCap = document.getElementById('lightboxCaption');
    var lbClose = document.getElementById('lightboxClose');
    if (!lb || !lbImg) return;

    function open(src, caption) {
      lbImg.src = src;
      if (lbCap) lbCap.textContent = caption || '';
      lb.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      lb.classList.remove('is-open');
      lbImg.src = '';
      document.body.style.overflow = '';
    }

    root.querySelectorAll('.pick-media-zoom').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var full = btn.getAttribute('data-full');
        var cap = btn.getAttribute('data-caption') || '';
        if (full) open(full, cap);
      });
    });

    if (lbClose && !lbClose.dataset.wired) {
      lbClose.dataset.wired = '1';
      lbClose.addEventListener('click', close);
    }
    if (!lb.dataset.wired) {
      lb.dataset.wired = '1';
      lb.addEventListener('click', function (e) { if (e.target === lb) close(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && lb.classList.contains('is-open')) close();
      });
    }
  }

  /* Category filters match against the free-text `league` field using
     keyword sets, since admins type categories freely (e.g. "Crypto",
     "BTC forecast", "Gold & Silver"). "Other" catches anything that
     doesn't fall into the known buckets. */
  var CATEGORY_KEYWORDS = {
    crypto:    ['crypto', 'bitcoin', 'btc', 'ethereum', 'eth', 'altcoin', 'coin', 'token', 'blockchain', 'solana', 'xrp', 'defi'],
    stocks:    ['stock', 'stocks', 'equity', 'equities', 'share', 'shares', 'nasdaq', 'sp500', 's&p', 'dow', 'ticker', 'index'],
    goldsilver:['gold', 'silver', 'precious metal', 'bullion', 'xau', 'xag'],
    oil:       ['oil', 'crude', 'brent', 'wti', 'petroleum', 'energy', 'gas'],
  };
  var KNOWN_CATEGORIES = ['crypto', 'stocks', 'goldsilver', 'oil'];

  function matchesCategory(p, filter) {
    if (filter === 'all') return true;
    var hay = ((p.league || '') + ' ' + (p.title || '')).toLowerCase();
    if (filter === 'other') {
      // "Other" = doesn't match any of the known category keyword sets.
      return !KNOWN_CATEGORIES.some(function (cat) {
        return CATEGORY_KEYWORDS[cat].some(function (kw) { return hay.indexOf(kw) !== -1; });
      });
    }
    var keywords = CATEGORY_KEYWORDS[filter] || [];
    return keywords.some(function (kw) { return hay.indexOf(kw) !== -1; });
  }

  function matchesSearch(p, query) {
    if (!query) return true;
    // Search across every plausible text field a prediction might carry.
    // We include pick/body/description/details defensively: the current
    // schema uses `pick` for the description, but older or hand-edited
    // records may store it under a different key, and this way the search
    // finds the text regardless of which field holds it.
    var hay = [
      p.title, p.pick, p.body, p.description, p.details,
      p.league, p.confidence, p.timeLabel, p.createdBy
    ].filter(Boolean).join(' ').toLowerCase();
    // Every whitespace-separated term must be present (AND search) so
    // "gold q2" narrows rather than widens.
    return query.toLowerCase().split(/\s+/).filter(Boolean).every(function (term) {
      return hay.indexOf(term) !== -1;
    });
  }

  async function load() {
    var feed = document.getElementById('predFeed');
    var empty = document.getElementById('predFeedEmpty');
    var controls = document.getElementById('predControls');
    var noResults = document.getElementById('predNoResults');
    if (!feed) return;

    // Find out the current user's role for unlock logic.
    var userRole = 'free';
    try {
      var meRes = await fetch('/api/auth/me');
      var meData = await meRes.json();
      if (meData.user && meData.user.role) userRole = meData.user.role;
    } catch (e) {}

    var allPredictions = [];
    var activeFilter = 'all';
    var activeQuery = '';

    function applyFilters() {
      var filtered = allPredictions.filter(function (p) {
        return matchesCategory(p, activeFilter) && matchesSearch(p, activeQuery);
      });
      if (!filtered.length) {
        feed.innerHTML = '';
        if (noResults) noResults.style.display = 'block';
        return;
      }
      if (noResults) noResults.style.display = 'none';
      feed.innerHTML = filtered.map(function (p, i) {
        return canAccess(userRole, p.tier) ? renderUnlocked(p, i) : renderLocked(p, i);
      }).join('');
      feed.querySelectorAll('.reveal').forEach(function (el) { el.classList.add('in'); });
      wireLockedClicks(feed); wireThanksButtons(feed);
      wireImageLightbox(feed);
    }

    function wireControls() {
      var searchInput = document.getElementById('predSearch');
      var clearBtn = document.getElementById('predSearchClear');
      var filterBtns = document.querySelectorAll('.pred-filter');

      if (searchInput) {
        searchInput.addEventListener('input', function () {
          activeQuery = searchInput.value.trim();
          if (clearBtn) clearBtn.style.display = activeQuery ? '' : 'none';
          applyFilters();
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', function () {
          searchInput.value = '';
          activeQuery = '';
          clearBtn.style.display = 'none';
          searchInput.focus();
          applyFilters();
        });
      }
      filterBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          filterBtns.forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          activeFilter = btn.getAttribute('data-filter');
          applyFilters();
        });
      });
    }

    try {
      var res = await fetch('/api/predictions');
      var data = await res.json();
      var list = data.predictions || [];
      list.sort(function (a, b) {
        var ta = +new Date(a.createdAt || 0);
        var tb = +new Date(b.createdAt || 0);
        return (isFinite(tb) ? tb : 0) - (isFinite(ta) ? ta : 0);
      });
      if (!list.length) {
        feed.innerHTML = '';
        empty.style.display = 'block';
        if (controls) controls.style.display = 'none';
        return;
      }
      empty.style.display = 'none';
      allPredictions = list;
      if (controls) controls.style.display = '';
      wireControls();
      applyFilters();
    } catch (e) {
      console.error(e);
      feed.innerHTML = '';
    }
  }

  document.addEventListener('DOMContentLoaded', load);
})();
