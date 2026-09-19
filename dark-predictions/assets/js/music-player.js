/* Dark Predictions — Music Player
   Spotify-style list, single-track playback, animated equaliser, gold progress bar.
   Exposes window.DPMusicPlayer.render(containerSel, emptySel) */
(function () {
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function escapeAttr(s) { return escapeHtml(s); }

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) return '--:--';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* Try to extract a leading track number like "1__Title" or "01 - Title" */
  function trackNumber(title) {
    var m = String(title || '').match(/^\s*(\d+)/);
    return m ? parseInt(m[1], 10) : 9999;
  }

  /* Clean up auto-derived titles: strip leading "1__", underscores → spaces */
  function prettyTitle(title) {
    return String(title || 'Untitled')
      .replace(/^\s*\d+\s*[-_.]*\s*/, '')
      .replace(/_+/g, ' ')
      .trim() || 'Untitled';
  }

  /* ----------------------------------------------------------------
     A single shared <audio> element is used for every track instead
     of one per row. Creating a new HTMLAudioElement per song and
     loading all their metadata at once is unreliable on mobile
     browsers (iOS Safari in particular throttles/limits concurrent
     media elements, and .play() on an element that wasn't the one
     most recently "armed" by a user gesture is often silently
     blocked). Lazily pointing one shared element at the right file
     only when the user presses play avoids both problems and also
     cuts down on the number of simultaneous network requests when
     a long album loads, which was causing some tracks to fail to
     report their duration on slower mobile connections.
     ---------------------------------------------------------------- */
  var sharedAudio = new Audio();
  sharedAudio.preload = 'none';
  var currentRow = null;
  var currentItem = null;
  var rows = []; // ordered list of { row, durEl, bar, item } for auto-advance

  function clearPlayingState() {
    if (currentRow) {
      currentRow.classList.remove('playing');
      var bar = currentRow.querySelector('.mp-bar');
      if (bar) bar.style.width = '0%';
    }
    currentRow = null;
    currentItem = null;
  }

  function pauseCurrent() {
    sharedAudio.pause();
    clearPlayingState();
  }

  function playIndex(index) {
    if (index < 0 || index >= rows.length) { pauseCurrent(); return; }
    var entry = rows[index];
    clearPlayingState();
    currentRow = entry.row;
    currentItem = entry;
    currentRow.classList.add('playing');
    currentRow.classList.remove('mp-error');

    sharedAudio.src = entry.item.url;
    sharedAudio.play().catch(function (err) {
      if (err && err.name === 'AbortError') return;
      console.error('[music] play error for "' + entry.item.title + '"', err);
      currentRow.classList.remove('playing');
      currentRow.classList.add('mp-error');
      currentRow.title = 'Playback failed: ' + (err && err.message ? err.message : err);
    });
  }

  sharedAudio.addEventListener('loadedmetadata', function () {
    if (currentItem) currentItem.durEl.textContent = fmtTime(sharedAudio.duration);
  });

  sharedAudio.addEventListener('timeupdate', function () {
    if (!currentItem || !sharedAudio.duration) return;
    currentItem.bar.style.width = ((sharedAudio.currentTime / sharedAudio.duration) * 100) + '%';
  });

  sharedAudio.addEventListener('ended', function () {
    var idx = currentItem ? rows.indexOf(currentItem) : -1;
    clearPlayingState();
    if (idx !== -1 && idx + 1 < rows.length) {
      playIndex(idx + 1);
    }
  });

  sharedAudio.addEventListener('error', function () {
    if (!currentItem) return;
    var code = sharedAudio.error ? sharedAudio.error.code : 0;
    var reason = (code === 4) ? 'unsupported file format'
      : (code === 3) ? 'audio decode error'
      : (code === 2) ? 'network error loading file'
      : 'file missing or could not be loaded';
    currentItem.durEl.textContent = 'Error';
    currentItem.row.classList.add('mp-error');
    currentItem.row.classList.remove('playing');
    currentItem.row.title = 'This track could not be loaded (' + reason + ').';
    console.warn('[music] failed to load track "' + currentItem.item.title + '" from', currentItem.item.url, '— code', code);
  });

  function buildRow(item, index) {
    var title = item.title;
    var url = item.url || '';
    var li = document.createElement('li');
    li.className = 'mp-row';
    li.style.animationDelay = (index * 50) + 'ms';
    li.innerHTML =
      '<button type="button" class="mp-play" aria-label="Play ' + escapeHtml(title) + '">' +
        '<svg class="ico-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
        '<svg class="ico-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>' +
      '</button>' +
      '<div class="mp-meta">' +
        '<div class="mp-title">' + escapeHtml(title) + '</div>' +
        '<div class="mp-sub">' +
          '<span class="mp-eq" aria-hidden="true"><span></span><span></span><span></span><span></span></span>' +
          '<span class="mp-tag">Original track</span>' +
        '</div>' +
      '</div>' +
      '<div class="mp-right">' +
        '<span class="mp-dur">--:--</span>' +
        '<a class="mp-download" href="' + escapeAttr(url) + '" download aria-label="Download ' + escapeHtml(title) + '" title="Download">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>' +
        '</a>' +
      '</div>' +
      '<div class="mp-bar-wrap"><div class="mp-bar"></div></div>';

    var durEl = li.querySelector('.mp-dur');
    var barWrap = li.querySelector('.mp-bar-wrap');
    var bar = li.querySelector('.mp-bar');

    var entry = { row: li, durEl: durEl, bar: bar, item: item };

    function togglePlay() {
      if (!url) return;
      if (currentItem === entry && !sharedAudio.paused) {
        pauseCurrent();
        return;
      }
      if (currentItem === entry && sharedAudio.paused) {
        li.classList.add('playing');
        sharedAudio.play().catch(function (err) {
          // Ignore AbortError: it just means a pause() interrupted this
          // play() call (e.g. a fast double-tap), not a real failure.
          if (err && err.name === 'AbortError') return;
          console.error('[music] play error for "' + entry.item.title + '"', err);
          li.classList.remove('playing');
          li.classList.add('mp-error');
          li.title = 'Playback failed: ' + (err && err.message ? err.message : err);
        });
        return;
      }
      playIndex(rows.indexOf(entry));
    }

    li.querySelector('.mp-play').addEventListener('click', function (e) {
      e.stopPropagation();
      togglePlay();
    });
    li.addEventListener('click', function (e) {
      /* Click anywhere on the row to toggle, except on the seek bar, the
         download button, or the play button itself (handled above —
         without this guard the click would bubble up from the button
         and call togglePlay() a second time in the same tick). */
      if (e.target.closest('.mp-play')) return;
      if (e.target.closest('.mp-bar-wrap')) return;
      if (e.target.closest('.mp-download')) return;
      togglePlay();
    });

    /* Seek on click in the progress bar (only meaningful for the active track) */
    barWrap.addEventListener('click', function (e) {
      if (currentItem !== entry || !sharedAudio.duration) return;
      var rect = barWrap.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      sharedAudio.currentTime = Math.max(0, Math.min(sharedAudio.duration, pct * sharedAudio.duration));
    });

    return entry;
  }

  var allItems = []; // full unfiltered list, kept for album switching
  var openAlbum = null; // null = browsing the folder grid

  function buildGroups(items) {
    var groups = [];
    var byKey = {};
    items.forEach(function (it) {
      var key = it.album || '';
      if (!(key in byKey)) {
        byKey[key] = { name: key, items: [] };
        groups.push(byKey[key]);
      }
      byKey[key].items.push(it);
    });
    return groups;
  }

  var folderIcon =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>';

  function renderFolderGrid(container) {
    pauseCurrent();
    rows = [];
    // Tracks with no album assigned aren't shown as their own folder.
    var groups = buildGroups(allItems).filter(function (g) { return g.name; });

    if (!groups.length) {
      container.innerHTML = '<div class="mp-loading">No albums yet.</div>';
      return;
    }

    var grid = document.createElement('div');
    grid.className = 'mp-folder-grid';
    groups.forEach(function (g) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'mp-folder-card';
      card.innerHTML =
        '<span class="mp-folder-icon">' + folderIcon + '</span>' +
        '<span class="mp-folder-name">' + escapeHtml(g.name) + '</span>' +
        '<span class="mp-folder-count">' + g.items.length + (g.items.length === 1 ? ' track' : ' tracks') + '</span>';
      card.addEventListener('click', function () {
        openAlbum = g.name;
        renderAlbumView(container, g);
      });
      grid.appendChild(card);
    });

    container.innerHTML = '';
    container.appendChild(grid);
  }

  function renderAlbumView(container, group) {
    pauseCurrent();
    rows = [];

    var wrap = document.createElement('div');

    var back = document.createElement('button');
    back.type = 'button';
    back.className = 'mp-back-btn';
    back.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> All albums';
    back.addEventListener('click', function () {
      openAlbum = null;
      renderFolderGrid(container);
    });
    wrap.appendChild(back);

    var section = document.createElement('section');
    section.className = 'mp-album-group';
    var h = document.createElement('h3');
    h.className = 'mp-album-heading';
    h.textContent = group.name;
    section.appendChild(h);

    var ul = document.createElement('ul');
    ul.className = 'mp-list';
    group.items.forEach(function (it) {
      var entry = buildRow(it, rows.length);
      ul.appendChild(entry.row);
      rows.push(entry);
    });
    section.appendChild(ul);
    wrap.appendChild(section);

    container.innerHTML = '';
    container.appendChild(wrap);
  }

  async function render(containerSel, emptySel, opts) {
    opts = opts || {};
    var container = document.querySelector(containerSel);
    var empty = emptySel ? document.querySelector(emptySel) : null;
    var tabsEl = opts.albumTabsSel ? document.querySelector(opts.albumTabsSel) : null;
    if (!container) return;
    if (tabsEl) { tabsEl.style.display = 'none'; tabsEl.innerHTML = ''; } // folder grid replaces the old tab bar

    pauseCurrent();
    rows = [];
    allItems = [];
    openAlbum = null;
    container.innerHTML = '<div class="mp-loading">Loading tracks…</div>';

    /* All tracks come from the admin panel via /api/music */
    var items = [];
    try {
      var res = await fetch('/api/music', { credentials: 'include' });
      if (res.ok) {
        var data = await res.json();
        var uploaded = Array.isArray(data) ? data : (data.items || []);
        uploaded.forEach(function (it) {
          if (!it.url) {
            console.warn('[music] skipping track with no audio file:', it.title || it.id);
            return;
          }
          items.push({
            title: it.title,
            url: it.url,
            album: (it.album || '').trim(),
            _num: trackNumber(it.title),
            _created: +new Date(it.createdAt || 0) || 0
          });
        });
      } else {
        console.warn('[music] /api/music responded', res.status);
      }
    } catch (err) {
      console.warn('[music] could not load uploaded tracks', err);
    }

    if (empty) empty.style.display = 'none';
    if (!items.length) {
      container.innerHTML = '';
      return;
    }

    /* Within an album, tracks with a leading number in their title
       (e.g. "1__Title", "01 - Title") play in that numbered order,
       like a real album. Anything without a number falls back to
       upload order (oldest first), placed after the numbered ones.
       Albums themselves are ordered by their earliest track. */
    var albumOrder = {};
    items.forEach(function (it) {
      var key = it.album || 'Unsorted';
      if (!(key in albumOrder) || it._created < albumOrder[key]) albumOrder[key] = it._created;
    });
    items.sort(function (a, b) {
      var albA = a.album || 'Unsorted', albB = b.album || 'Unsorted';
      if (albA !== albB) return albumOrder[albA] - albumOrder[albB];
      var aHas = a._num !== 9999, bHas = b._num !== 9999;
      if (aHas && bHas) return a._num - b._num;
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a._created - b._created;
    });

    items.forEach(function (it) { it.title = prettyTitle(it.title); });

    allItems = items;

    renderFolderGrid(container);
  }

  window.DPMusicPlayer = { render: render };
})();
