/* Dark Predictions — shared interactions */
(function () {
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- Mobile nav ---- */
  var menuBtn = document.querySelector('.menu-btn');
  var navLinks = document.querySelector('.nav-links');
  if (menuBtn && navLinks) {
    menuBtn.addEventListener('click', function () {
      navLinks.classList.toggle('open');
    });
    navLinks.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () { navLinks.classList.remove('open'); });
    });
  }

  /* ---- Footer year ---- */
  var y = document.getElementById('year');
  if (y) y.textContent = new Date().getFullYear();

  /* ---- Locked picks: tap anywhere on the card to go subscribe ---- */
  document.querySelectorAll('.pick.locked[data-href]').forEach(function (card) {
    card.setAttribute('role', 'link');
    card.setAttribute('tabindex', '0');
    var dest = card.getAttribute('data-href');
    var external = /^https?:\/\//i.test(dest);
    function go() {
      if (external) { window.open(dest, '_blank', 'noopener'); }
      else { window.location.href = dest; }
    }
    card.addEventListener('click', go);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
  });

  /* ---- Global click ripple — fires on a click anywhere on the site ---- */
  (function () {
    if (reduce) return;
    function spawnRipple(x, y) {
      var r = document.createElement('span');
      r.className = 'click-ripple';
      r.style.left = x + 'px';
      r.style.top = y + 'px';
      document.body.appendChild(r);
      r.addEventListener('animationend', function () { r.remove(); });
      setTimeout(function () { if (r.parentNode) r.remove(); }, 900);
    }
    document.addEventListener('click', function (e) {
      spawnRipple(e.clientX, e.clientY);
    }, true);
  })();

  /* ---- Scroll reveal ---- */
  var revealEls = document.querySelectorAll('.reveal');
  if (revealEls.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      revealEls.forEach(function (el) { el.classList.add('in'); });
    } else {
      var ro = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); }
        });
      }, { threshold: 0.15 });
      revealEls.forEach(function (el) { ro.observe(el); });
    }
  }

  /* ---- Counter helper ---- */
  function animateNumber(el, to, suffix, decimals) {
    if (reduce) { el.textContent = (decimals ? to.toFixed(decimals) : to) + (suffix || ''); return; }
    var dur = 1300, start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var ease = 1 - Math.pow(1 - p, 3);
      var val = to * ease;
      el.textContent = (decimals ? val.toFixed(decimals) : Math.round(val)) + (suffix || '');
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ---- Gauge ---- */
  var arc = document.getElementById('arc');
  if (arc) {
    var pct = document.getElementById('pct');
    var C = 326.7, target = 97;
    function runGauge() {
      arc.style.transition = reduce ? 'none' : 'stroke-dashoffset 1.5s cubic-bezier(.22,1,.36,1)';
      arc.style.strokeDashoffset = C * (1 - target / 100);
      if (pct) animateNumber(pct, target, '%', 0);
      var s1 = document.getElementById('s1'), s2 = document.getElementById('s2'), s3 = document.getElementById('s3');
      if (s1) animateNumber(s1, 240, '', 0);
      if (s2) animateNumber(s2, 2.1, '', 1);
      if (s3) animateNumber(s3, 12, '', 0);
    }
    var card = document.querySelector('.gauge-card');
    if ('IntersectionObserver' in window && card) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { runGauge(); io.disconnect(); } });
      }, { threshold: 0.4 });
      io.observe(card);
    } else { runGauge(); }
  }

  /* ---- Stat counters ---- */
  var statEls = document.querySelectorAll('[data-count]');
  if (statEls.length && 'IntersectionObserver' in window) {
    var so = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var el = e.target;
          var to = parseFloat(el.getAttribute('data-count'));
          var suffix = el.getAttribute('data-suffix') || '';
          var dec = parseInt(el.getAttribute('data-dec') || '0', 10);
          animateNumber(el, to, suffix, dec);
          so.unobserve(el);
        }
      });
    }, { threshold: 0.5 });
    statEls.forEach(function (el) { so.observe(el); });
  } else {
    statEls.forEach(function (el) {
      el.textContent = el.getAttribute('data-count') + (el.getAttribute('data-suffix') || '');
    });
  }
})();
