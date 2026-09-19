/* ============================================================
   admin.js — Dark Predictions admin panel
   Tabs: predictions, music, apps, paintings, messages, users
   ============================================================ */
(function(){
  'use strict';

  const PRED_TIERS = ['free','basic','gold','vip'];
  const ALL_ROLES  = ['free','trial','basic','gold','vip','developer'];

  /* ---------------- helpers ---------------- */
  function $(s, root){ return (root || document).querySelector(s); }
  function $$(s, root){ return Array.from((root || document).querySelectorAll(s)); }

  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function formatDate(iso){
    if(!iso) return '—';
    try{
      return new Date(iso).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'short' });
    }catch(e){ return String(iso); }
  }

  function showToast(text, kind){
    const t = $('#toast');
    if(!t){ console.log('[toast]', text); return; }
    t.textContent = text;
    t.className = 'toast show' + (kind === 'error' ? ' err' : '');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function(){ t.classList.remove('show'); }, 3000);
  }

  /* ----------------------------------------------------------
     Wires an <input type="file"> to the Firebase Storage upload:
     - fileInputSel : selector of the (visually hidden) file input
     - hiddenInputSel : selector of the hidden input that receives the URL
     - progressSel : selector of the .upload-progress container
     - previewSel : selector of the .upload-preview container
     - kind : type passed to DPUpload.uploadFile (validation + folder)
     The visible "Choose file" button + filename label are plain
     HTML (a <label> + a <span id="...FileName">), kept in English
     regardless of the visitor's browser language — unlike the
     native file input button, which the browser translates itself.
     ---------------------------------------------------------- */
  function wireFileUpload(fileInputSel, hiddenInputSel, progressSel, previewSel, kind){
    const fileInput = $(fileInputSel);
    const hidden = $(hiddenInputSel);
    const progress = $(progressSel);
    const preview = $(previewSel);
    const fileNameLabel = document.getElementById(fileInputSel.replace('#', '') + 'Name');
    if(!fileInput || !hidden) return;

    function renderPreview(url, isImage){
      if(!preview) return;
      preview.style.display = 'flex';
      preview.innerHTML = (isImage ? `<img src="${escapeHtml(url)}" alt="" />` : '') +
        `<span>✓ File uploaded</span>` +
        `<button type="button" class="remove-upload">Remove</button>`;
      const rm = preview.querySelector('.remove-upload');
      if(rm) rm.addEventListener('click', function(){
        hidden.value = '';
        preview.style.display = 'none';
        preview.innerHTML = '';
        fileInput.value = '';
        if(fileNameLabel) fileNameLabel.textContent = 'No file chosen';
      });
    }

    fileInput.addEventListener('change', async function(){
      const file = fileInput.files && fileInput.files[0];
      if(!file) return;
      if(fileNameLabel) fileNameLabel.textContent = file.name;
      if(!window.DPUpload){ showToast('Upload module not loaded.', 'error'); return; }

      if(progress){ progress.style.display = 'block'; progress.querySelector('.bar').style.width = '0%'; }
      if(preview){ preview.style.display = 'none'; preview.innerHTML = ''; }
      fileInput.disabled = true;

      try{
        const url = await window.DPUpload.uploadFile(file, kind, {
          onProgress: function(pct){
            if(progress) progress.querySelector('.bar').style.width = pct + '%';
          }
        });
        hidden.value = url;
        renderPreview(url, /^image\//.test(file.type));
        showToast('File uploaded', 'ok');
      }catch(err){
        console.error(err);
        showToast(err.message || 'File upload failed.', 'error');
        fileInput.value = '';
        if(fileNameLabel) fileNameLabel.textContent = 'No file chosen';
      }finally{
        fileInput.disabled = false;
        if(progress) progress.style.display = 'none';
      }
    });
  }

  function setFormMsg(id, text, kind){
    const m = $('#' + id);
    if(!m) return;
    m.textContent = text || '';
    m.style.color = kind === 'error' ? '#ff6f6f' : (kind === 'ok' ? 'var(--gold-2)' : 'var(--muted)');
  }

  async function api(path, opts){
    opts = opts || {};
    opts.credentials = 'include';
    opts.headers = Object.assign({ 
      'Content-Type':'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Cache-Control': 'no-cache'
    }, opts.headers || {});
    if(opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    try {
      const res = await fetch(path, opts);
      if(!res.ok){
        let msg = 'HTTP ' + res.status;
        try{ const t = await res.text(); if(t) msg = t; }catch(e){}
        throw new Error(msg);
      }
      if(res.status === 204) return null;
      const ct = res.headers.get('content-type') || '';
      if(ct.indexOf('application/json') !== -1) return res.json();
      return res.text();
    } catch(err) {
      // Retry once if blocked by ad-blocker
      if(err.message.includes('Failed to fetch') || err.message.includes('blocked')) {
        console.warn('Retrying blocked request:', path);
        await new Promise(r => setTimeout(r, 500));
        const res = await fetch(path, opts);
        if(!res.ok) throw new Error('HTTP ' + res.status);
        if(res.status === 204) return null;
        const ct = res.headers.get('content-type') || '';
        if(ct.indexOf('application/json') !== -1) return res.json();
        return res.text();
      }
      throw err;
    }
  }

  /* ---------------- guard ---------------- */
  /* Wait for Firebase to be ready and initialize it */
  function waitForFirebase() {
    return new Promise(function(resolve) {
      if(window.firebase && window.firebase.auth && window.firebase.firestore) {
        // Firebase SDK loaded, now initialize the app if not already done
        try {
          var app = firebase.app('[DEFAULT]'); // Check if already initialized
          resolve();
        } catch(e) {
          // Not initialized yet, do it now
          try {
            firebase.initializeApp({
              apiKey:            "AIzaSyC5tRjOXYkTdS_i_mtTJIXWzT8oN5F-kes",
              authDomain:        "darkpredictions-ec67b.firebaseapp.com",
              projectId:         "darkpredictions-ec67b",
              storageBucket:     "darkpredictions-ec67b.firebasestorage.app",
              messagingSenderId: "924305486581",
              appId:             "1:924305486581:web:020753c201bf6d287b4bbc"
            });
            resolve();
          } catch(initErr) {
            console.error('Firebase init error:', initErr);
            resolve(); // Continue anyway
          }
        }
      } else {
        var checks = 0;
        var interval = setInterval(function() {
          checks++;
          if(window.firebase && window.firebase.auth && window.firebase.firestore) {
            clearInterval(interval);
            try {
              var app = firebase.app('[DEFAULT]');
              resolve();
            } catch(e) {
              try {
                firebase.initializeApp({
                  apiKey:            "AIzaSyC5tRjOXYkTdS_i_mtTJIXWzT8oN5F-kes",
                  authDomain:        "darkpredictions-ec67b.firebaseapp.com",
                  projectId:         "darkpredictions-ec67b",
                  storageBucket:     "darkpredictions-ec67b.firebasestorage.app",
                  messagingSenderId: "924305486581",
                  appId:             "1:924305486581:web:020753c201bf6d287b4bbc"
                });
                resolve();
              } catch(initErr) {
                resolve();
              }
            }
          }
          if(checks > 50) { clearInterval(interval); resolve(); }
        }, 100);
      }
    });
  }

  async function checkDeveloper(){
    try{
      // Wait for Firebase to be initialized
      await waitForFirebase();
      
      // Use Firebase directly to avoid ad-blocker blocking /api/auth/me
      const user = await new Promise((resolve) => {
        const unsubscribe = firebase.auth().onAuthStateChanged((u) => {
          unsubscribe();
          resolve(u);
        });
      });
      
      if(!user){
        showGuard('Sign in with the developer account to access the admin panel.', true);
        return null;
      }
      
      // Get user data from Firestore
      const db = firebase.firestore();
      const userDoc = await db.collection('users').doc(user.uid).get();
      const userData = userDoc.exists ? userDoc.data() : { role: 'free' };
      
      const me = {
        id: user.uid,
        email: user.email || userData.email || '',
        // Défensif : user.email peut être null (compte sans email, provider
        // externe, doc incomplet). Un crash ici avortait TOUT l'init du
        // panel → aucun formulaire câblé → les boutons Publish "morts".
        displayName: user.displayName || userData.displayName
          || (user.email ? user.email.split('@')[0] : 'Admin'),
        role: userData.role || 'free',
        createdAt: userData.createdAt
      };
      
      if(!me.id){
        showGuard('Sign in with the developer account to access the admin panel.', true);
        return null;
      }
      
      const roleCheck = (me.role || '').toLowerCase();
      if(roleCheck !== 'developer'){
        console.warn('User role is:', me.role, '— expected "developer"');
        showGuard('This panel is reserved for the developer account.', false);
        return null;
      }
      
      $('#adminGuard').style.display = 'none';
      $('#adminContent').style.display = '';
      console.log('✓ Developer access granted for:', me.displayName);
      return me;
      
    }catch(e){
      console.error('checkDeveloper error:', e);
      showGuard('Error: ' + (e.message || 'Could not verify access'), true);
      return null;
    }
  }

  function showGuard(msg, showLogin){
    const g  = $('#adminGuard');
    const c  = $('#adminContent');
    const m  = $('#adminGuardMsg');
    if(c) c.style.display = 'none';
    if(g) g.style.display = '';
    if(m) m.textContent = msg;
  }

  /* ---------------- tabs ---------------- */
  var ADMIN_JS_BUILD = '1787080896';
  function checkVersionConsistency(){
    try{
      var pageBuild = window.__PAGE_BUILD || null;
      var banner = document.getElementById('versionMismatchBanner');
      var vis = document.getElementById('buildMarker');
      if(vis) vis.textContent = 'build ' + ADMIN_JS_BUILD;
      console.log('[Dark Predictions] admin.js build:', ADMIN_JS_BUILD, '| admin.html build:', pageBuild);
      if(!banner) return;
      if(!pageBuild || pageBuild !== ADMIN_JS_BUILD){
        banner.textContent = '\u26A0\uFE0F DEPLOYMENT PROBLEM: admin.html is build ' + (pageBuild || 'OLD/unknown') + ' but admin.js is build ' + ADMIN_JS_BUILD + '. Old and new files are mixed on the server. Redeploy the FULL zip (all files at repo root) and hard-refresh (Ctrl+Shift+R).';
        banner.style.display = '';
      }
    }catch(e){ console.error(e); }
  }

  function wireTabs(){
    checkVersionConsistency();
    $$('.tab-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        const target = btn.getAttribute('data-tab');
        $$('.tab-btn').forEach(function(b){ b.classList.toggle('active', b === btn); });
        $$('.tab-panel').forEach(function(p){
          p.classList.toggle('active', p.id === 'tab-' + target);
        });
        // On ne charge les analytics QUE lorsque l'admin ouvre réellement
        // cet onglet — et une seule fois (le cache évite les rechargements).
        // Avant, loadAnalytics() tournait à chaque ouverture du panel admin,
        // ce qui consommait le quota Firestore gratuit inutilement (et
        // pouvait finir par bloquer les inscriptions sur tout le site).
        if(target === 'analytics'){ loadAnalytics(); }
      });
    });
    $$('.tab-panel').forEach(function(p, i){ p.classList.toggle('active', i === 0); });
  }

  /* ============================================================
     PREDICTIONS
     ============================================================ */
  function resetPredForm(){
    $('#predId').value = '';
    $('#predForm').reset();
    $('#predImage').value = '';
    $('#predVideo').value = '';
    $('#predTier').value = 'gold';
    $('#predFormTitle').textContent = 'Post a prediction';
    $('#predSubmitBtn').textContent = 'Publish';
    $('#predCancelBtn').style.display = 'none';
    setFormMsg('predMsg','');
    [['#predImagePreview'], ['#predVideoPreview']].forEach(function(sel){
      const el = $(sel[0]);
      if(el){ el.style.display = 'none'; el.innerHTML = ''; }
    });
  }

  function fillPredForm(p){
    $('#predId').value         = p.id || '';
    $('#predLeague').value      = p.league || '';
    $('#predTime').value        = p.timeLabel || p.time || '';
    $('#predTier').value        = PRED_TIERS.indexOf((p.tier||'').toLowerCase()) >= 0 ? p.tier.toLowerCase() : 'gold';
    $('#predTitle').value       = p.title || '';
    $('#predPick').value         = p.pick || '';
    $('#predImage').value        = p.imageUrl || '';
    $('#predVideo').value        = p.videoUrl || '';
    $('#predConfidence').value   = p.confidence || '';
    showExistingFile('#predImagePreview', p.imageUrl, true);
    showExistingFile('#predVideoPreview', p.videoUrl, false);
    $('#predFormTitle').textContent = 'Edit prediction';
    $('#predSubmitBtn').textContent  = 'Save changes';
    $('#predCancelBtn').style.display = '';
    setFormMsg('predMsg','');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Affiche le fichier déjà associé (image ou vidéo) quand on ouvre
  // l'édition d'une prédiction existante.
  function showExistingFile(previewSel, url, isImage){
    const el = $(previewSel);
    if(!el) return;
    if(!url){ el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'flex';
    el.innerHTML = (isImage ? `<img src="${escapeHtml(url)}" alt="" />` : '<span>🎬</span>') +
      `<span>Current file kept</span>`;
  }

  function tierBadge(t){
    const v = (t || 'gold').toLowerCase();
    return `<span style="font-family:'JetBrains Mono',monospace;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border-radius:999px;border:1px solid var(--line);color:var(--gold-2)">${escapeHtml(v)}</span>`;
  }

  async function loadPredictions(){
    const tbody = $('#predTableBody');
    const empty = $('#predEmpty');
    try{
      const data = await api('/api/predictions');
      const items = Array.isArray(data) ? data : (data.predictions || []);
      items.sort(function(a,b){ return +new Date(b.createdAt||0) - +new Date(a.createdAt||0); });

      if(!items.length){
        tbody.innerHTML = '';
        empty.style.display = '';
        $('#statPredictions').textContent = '0';
        return;
      }
      empty.style.display = 'none';
      $('#statPredictions').textContent = String(items.length);

      tbody.innerHTML = items.map(function(p){
        return `<tr>
          <td><b>${escapeHtml(p.title || '')}</b><div style="color:var(--muted);font-size:12.5px;margin-top:3px">${escapeHtml((p.pick||'').slice(0,90))}${(p.pick||'').length>90?'…':''}</div></td>
          <td>${escapeHtml(p.league || '')}</td>
          <td>${tierBadge(p.tier)}</td>
          <td style="color:var(--muted);font-size:12.5px">${escapeHtml(formatDate(p.createdAt))}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn-link" data-edit-pred="${escapeHtml(p.id)}">Edit</button>
            &nbsp;·&nbsp;
            <button class="btn-link" data-del-pred="${escapeHtml(p.id)}" style="color:#ff6f6f">Delete</button>
          </td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('[data-edit-pred]').forEach(function(b){
        b.addEventListener('click', async function(){
          try{
            const p = await api('/api/predictions/' + encodeURIComponent(b.getAttribute('data-edit-pred')));
            fillPredForm(p);
          }catch(e){ showToast('Could not load prediction', 'error'); }
        });
      });
      tbody.querySelectorAll('[data-del-pred]').forEach(function(b){
        b.addEventListener('click', async function(){
          if(!confirm('Delete this prediction?')) return;
          try{
            await api('/api/predictions/' + encodeURIComponent(b.getAttribute('data-del-pred')), { method:'DELETE' });
            showToast('Prediction deleted', 'ok');
            loadPredictions();
          }catch(e){ showToast('Delete failed', 'error'); }
        });
      });
    }catch(e){
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="6" style="color:#ff6f6f;text-align:center;padding:20px">Could not load predictions.</td></tr>';
    }
  }

  function wirePredForm(){
    $('#predForm').addEventListener('submit', async function(e){
      e.preventDefault();
      const id   = $('#predId').value.trim();
      const body = {
        league:     $('#predLeague').value.trim(),
        timeLabel:  $('#predTime').value.trim(),
        tier:       $('#predTier').value,
        title:      $('#predTitle').value.trim(),
        pick:       $('#predPick').value.trim(),
        imageUrl:   $('#predImage').value.trim(),
        videoUrl:   $('#predVideo').value.trim(),
        confidence: $('#predConfidence').value.trim()
      };
      if(PRED_TIERS.indexOf(body.tier) === -1){
        setFormMsg('predMsg', 'Pick a tier: free, basic, gold or vip.', 'error');
        return;
      }
      setFormMsg('predMsg', id ? 'Saving…' : 'Publishing…');
      try{
        if(id){
          await api('/api/predictions/' + encodeURIComponent(id), { method:'PUT', body: body });
          setFormMsg('predMsg', 'Prediction updated.', 'ok');
        }else{
          await api('/api/predictions', { method:'POST', body: body });
          setFormMsg('predMsg', 'Prediction published.', 'ok');
        }
        resetPredForm();
        loadPredictions();
      }catch(err){
        console.error(err);
        setFormMsg('predMsg', 'Failed to save. Please try again.', 'error');
      }
    });
    $('#predCancelBtn').addEventListener('click', resetPredForm);
  }

  /* ============================================================
     GENERIC MEDIA (music / apps / paintings)
     ============================================================ */
  function makeMediaModule(kind){
    const cap = kind[0].toUpperCase() + kind.slice(1);
    const idPrefix = kind; // 'music' | 'apps' | 'paintings'
    const isMusic = kind === 'music';

    const ids = {
      form:        '#' + idPrefix + 'Form',
      id:          '#' + idPrefix + 'Id',
      title:       '#' + idPrefix + 'Title',
      album:       '#' + idPrefix + 'Album',
      tag:         '#' + idPrefix + 'Tag',
      desc:        '#' + idPrefix + 'Desc',
      url:         '#' + idPrefix + 'Url',
      cover:       '#' + idPrefix + 'Cover',
      formTitle:   '#' + idPrefix + 'FormTitle',
      submitBtn:   '#' + idPrefix + 'SubmitBtn',
      cancelBtn:   '#' + idPrefix + 'CancelBtn',
      msg:         idPrefix + 'Msg',
      tableBody:   '#' + idPrefix + 'TableBody',
      empty:       '#' + idPrefix + 'Empty'
    };

    const KIND_LABELS = {
      music: ['a music track', 'track'],
      apps: ['an app', 'app'],
      paintings: ['a painting', 'painting'],
      correctpredictions: ['a correct prediction video', 'video'],
      socials: ['a social link', 'link'],
      pricelist: ['a personal prediction option', 'option'],
    };
    const kl = KIND_LABELS[kind] || ['an item', 'item'];
    const labels = {
      formTitleAdd:  'Add ' + kl[0],
      formTitleEdit: 'Edit ' + kl[1],
      submitAdd:     'Publish',
      submitEdit:    'Save changes',
      confirmDel:    'Delete this ' + kl[1] + '?'
    };

    // Some kinds (pricelist, socials, correctpredictions) have no real
    // file-upload UI — their hidden #...Url input just carries a fixed
    // placeholder value (e.g. "#") baked into the HTML so the required
    // "Title + URL" check still passes. Clearing it on every reset (as we
    // must for kinds that DO upload a file) would permanently blank that
    // placeholder after the first reset, silently breaking every Publish
    // from then on. So: remember the URL field's original HTML value once,
    // and for non-upload kinds restore THAT instead of an empty string.
    const hasUploadUi = isMusic || kind === 'apps';
    const urlEl0 = $(ids.url);
    if (urlEl0 && urlEl0.dataset.staticValue === undefined) {
      urlEl0.dataset.staticValue = urlEl0.getAttribute('value') || '';
    }

    function resetForm(){
      const f = $(ids.form); if(f) f.reset();
      if($(ids.id)) $(ids.id).value = '';
      if($(ids.url)) $(ids.url).value = hasUploadUi ? '' : $(ids.url).dataset.staticValue;
      if($(ids.cover)) $(ids.cover).value = '';
      if($(ids.formTitle)) $(ids.formTitle).textContent = labels.formTitleAdd;
      if($(ids.submitBtn)) $(ids.submitBtn).textContent = labels.submitAdd;
      if($(ids.cancelBtn)) $(ids.cancelBtn).style.display = 'none';
      setFormMsg(ids.msg, '');
      if(isMusic){
        ['#musicAudioPreview','#musicCoverPreview'].forEach(function(sel){
          const el = $(sel);
          if(el){ el.style.display = 'none'; el.innerHTML = ''; }
        });
      }
      if(kind === 'apps'){
        const el = $('#appsCoverPreview');
        if(el){ el.style.display = 'none'; el.innerHTML = ''; }
      }
    }

    function fillForm(item){
      if($(ids.id))    $(ids.id).value    = item.id || '';
      if($(ids.title)) $(ids.title).value = item.title || '';
      if(isMusic && $(ids.album)) $(ids.album).value = item.albumId || '';
      if($(ids.tag))   $(ids.tag).value   = item.tag || '';
      if($(ids.desc))  $(ids.desc).value  = item.description || '';
      if($(ids.url))   $(ids.url).value   = item.url || '';
      if($(ids.cover)) $(ids.cover).value = item.cover || item.coverUrl || '';
      if(isMusic){
        const audioPrev = $('#musicAudioPreview');
        if(audioPrev){
          audioPrev.style.display = item.url ? 'flex' : 'none';
          audioPrev.innerHTML = item.url ? '<span>🎵 Current file kept</span>' : '';
        }
        const coverPrev = $('#musicCoverPreview');
        if(coverPrev){
          const coverVal = item.cover || item.coverUrl || '';
          coverPrev.style.display = coverVal ? 'flex' : 'none';
          coverPrev.innerHTML = coverVal ? `<img src="${escapeHtml(coverVal)}" alt="" /><span>Current cover kept</span>` : '';
        }
      }
      if(kind === 'apps'){
        const coverPrev = $('#appsCoverPreview');
        if(coverPrev){
          const coverVal = item.cover || item.coverUrl || '';
          coverPrev.style.display = coverVal ? 'flex' : 'none';
          coverPrev.innerHTML = coverVal ? `<img src="${escapeHtml(coverVal)}" alt="" /><span>Current screenshot kept</span>` : '';
        }
      }
      if($(ids.formTitle)) $(ids.formTitle).textContent = labels.formTitleEdit;
      if($(ids.submitBtn)) $(ids.submitBtn).textContent = labels.submitEdit;
      if($(ids.cancelBtn)) $(ids.cancelBtn).style.display = '';
      setFormMsg(ids.msg, '');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function load(){
      const tbody = $(ids.tableBody);
      const empty = $(ids.empty);
      if(!tbody) return 0;
      try{
        const data = await api('/api/' + kind);
        const items = Array.isArray(data) ? data : (data.items || []);
        items.sort(function(a,b){ return +new Date(b.createdAt||0) - +new Date(a.createdAt||0); });

        if(isMusic){
          await populateMusicAlbumSelect();
        }

        if(!items.length){
          tbody.innerHTML = '';
          if(empty) empty.style.display = '';
          return 0;
        }
        if(empty) empty.style.display = 'none';

        tbody.innerHTML = items.map(function(it){
          return `<tr>
            <td><b>${escapeHtml(it.title || '')}</b><div style="color:var(--muted);font-size:12.5px;margin-top:3px">${escapeHtml((it.description||'').slice(0,90))}${(it.description||'').length>90?'…':''}</div></td>
            ${isMusic ? `<td>${escapeHtml(it.album || '—')}</td>` : ''}
            <td>${escapeHtml(it.tag || '—')}</td>
            <td style="color:var(--muted);font-size:12.5px">${escapeHtml(formatDate(it.createdAt))}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn-link" data-edit="${escapeHtml(it.id)}">Edit</button>
              &nbsp;·&nbsp;
              <button class="btn-link" data-del="${escapeHtml(it.id)}" style="color:#ff6f6f">Delete</button>
            </td>
          </tr>`;
        }).join('');

        tbody.querySelectorAll('[data-edit]').forEach(function(b){
          b.addEventListener('click', async function(){
            try{
              const it = await api('/api/' + kind + '/' + encodeURIComponent(b.getAttribute('data-edit')));
              fillForm(it);
            }catch(e){ showToast('Could not load item', 'error'); }
          });
        });
        tbody.querySelectorAll('[data-del]').forEach(function(b){
          b.addEventListener('click', async function(){
            if(!confirm(labels.confirmDel)) return;
            try{
              await api('/api/' + kind + '/' + encodeURIComponent(b.getAttribute('data-del')), { method:'DELETE' });
              showToast('Deleted', 'ok');
              load().then(updateMediaStat);
            }catch(e){ showToast('Delete failed', 'error'); }
          });
        });
        return items.length;
      }catch(e){
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="' + (isMusic ? 5 : 4) + '" style="color:#ff6f6f;text-align:center;padding:20px">Could not load.</td></tr>';
        return 0;
      }
    }

    function wireForm(){
      const form = $(ids.form);
      if(!form) return;

      if(isMusic){
        wireFileUpload('#musicAudioFile', '#musicUrl', '#musicAudioProgress', '#musicAudioPreview', 'musicAudio');
        wireFileUpload('#musicCoverFile', '#musicCover', '#musicCoverProgress', '#musicCoverPreview', 'cover');
      }
      if(kind === 'apps'){
        wireFileUpload('#appsCoverFile', '#appsCover', '#appsCoverProgress', '#appsCoverPreview', 'cover');
      }

      form.addEventListener('submit', async function(e){
        e.preventDefault();
        const id = $(ids.id) ? $(ids.id).value.trim() : '';
        const body = {
          title:       $(ids.title) ? $(ids.title).value.trim() : '',
          tag:         $(ids.tag)   ? $(ids.tag).value.trim()   : '',
          description: $(ids.desc)  ? $(ids.desc).value.trim()  : '',
          url:         $(ids.url)   ? $(ids.url).value.trim()   : '',
          cover:       $(ids.cover) ? $(ids.cover).value.trim() : ''
        };
        if(isMusic){
          const albumSel = $(ids.album);
          const albumId = albumSel ? albumSel.value : '';
          body.albumId = albumId;
          body.album = albumId && albumSel.selectedOptions.length ? albumSel.selectedOptions[0].textContent : '';
        }
        if(!body.title || (!body.url && kind !== 'pricelist')){
          setFormMsg(ids.msg, kind === 'pricelist' ? 'Service name is required.' : 'Title and URL are required.', 'error');
          return;
        }
        // pricelist n'a pas d'URL réelle (paiement par email direct) : on
        // met une valeur placeholder pour satisfaire la contrainte serveur.
        if(kind === 'pricelist' && !body.url){ body.url = '#'; }
        setFormMsg(ids.msg, id ? 'Saving…' : 'Publishing…');
        try{
          if(id){
            await api('/api/' + kind + '/' + encodeURIComponent(id), { method:'PUT', body: body });
          }else{
            await api('/api/' + kind, { method:'POST', body: body });
          }
          // resetForm() efface aussi le message — on affiche donc la
          // confirmation APRÈS le reset, sinon "Published." disparaît
          // instantanément et on a l'impression que rien ne s'est passé.
          resetForm();
          setFormMsg(ids.msg, id ? 'Saved ✓' : 'Published ✓', 'ok');
          load().then(updateMediaStat);
        }catch(err){
          console.error(err);
          setFormMsg(ids.msg, 'Failed to save.', 'error');
        }
      });
      if($(ids.cancelBtn)) $(ids.cancelBtn).addEventListener('click', resetForm);
    }

    return { load: load, wireForm: wireForm, resetForm: resetForm };
  }

  /* ============================================================
     ALBUMS (music folders) — create/rename/delete, and a checklist
     to assign existing songs to an album.
     ============================================================ */
  let albumsCache = [];

  async function fetchAlbums(){
    try{
      const data = await api('/api/albums');
      albumsCache = Array.isArray(data) ? data : (data.items || []);
    }catch(e){
      console.error(e);
      albumsCache = [];
    }
    return albumsCache;
  }

  async function populateMusicAlbumSelect(){
    const sel = $('#musicAlbum');
    if(!sel) return;
    const keepValue = sel.value;
    await fetchAlbums();
    sel.innerHTML = '<option value="">No album</option>' +
      albumsCache.map(function(a){ return `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`; }).join('');
    if(keepValue && albumsCache.some(function(a){ return a.id === keepValue; })) sel.value = keepValue;
  }

  let allTracksCache = [];

  async function populateAlbumSongsList(currentAlbumId){
    const box = $('#albumSongsList');
    if(!box) return;
    box.innerHTML = '<div style="color:var(--muted);font-size:13px">Loading songs…</div>';
    try{
      const data = await api('/api/music');
      const tracks = Array.isArray(data) ? data : (data.items || []);
      allTracksCache = tracks;
      if(!tracks.length){
        box.innerHTML = '<div style="color:var(--muted);font-size:13px">No songs uploaded yet — add some in the Music tab first.</div>';
        return;
      }
      box.innerHTML = tracks.map(function(t){
        const checked = currentAlbumId && t.albumId === currentAlbumId ? 'checked' : '';
        const otherAlbum = t.albumId && t.albumId !== currentAlbumId ? `<span style="margin-left:auto;color:var(--muted);font-size:12px">in “${escapeHtml(t.album || 'another album')}”</span>` : '';
        return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);cursor:pointer">
          <input type="checkbox" data-song-id="${escapeHtml(t.id)}" ${checked} />
          <span>${escapeHtml(t.title || 'Untitled')}</span>
          ${otherAlbum}
        </label>`;
      }).join('');
    }catch(e){
      console.error(e);
      box.innerHTML = '<div style="color:#ff6f6f;font-size:13px">Could not load songs.</div>';
    }
  }

  function makeAlbumsModule(){
    function resetForm(){
      const f = $('#albumForm'); if(f) f.reset();
      $('#albumId').value = '';
      $('#albumFormTitle').textContent = 'Create an album';
      $('#albumSubmitBtn').textContent = 'Create album';
      $('#albumCancelBtn').style.display = 'none';
      setFormMsg('albumMsg', '');
      populateAlbumSongsList('');
    }

    function fillForm(album){
      $('#albumId').value = album.id || '';
      $('#albumName').value = album.name || '';
      $('#albumFormTitle').textContent = 'Rename album';
      $('#albumSubmitBtn').textContent = 'Save changes';
      $('#albumCancelBtn').style.display = '';
      setFormMsg('albumMsg', '');
      populateAlbumSongsList(album.id || '');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function closeAssign(){
      $('#albumAssignCard').style.display = 'none';
      $('#albumAssignList').innerHTML = '';
    }

    async function openAssign(album){
      $('#albumAssignCard').style.display = '';
      $('#albumAssignTitle').textContent = 'Assign songs — ' + album.name;
      $('#albumAssignList').innerHTML = '<div style="color:var(--muted);font-size:13px">Loading songs…</div>';
      setFormMsg('albumAssignMsg', '');
      try{
        const data = await api('/api/music');
        const tracks = Array.isArray(data) ? data : (data.items || []);
        if(!tracks.length){
          $('#albumAssignList').innerHTML = '<div style="color:var(--muted);font-size:13px">No songs uploaded yet — add some in the Music tab first.</div>';
          return;
        }
        $('#albumAssignList').innerHTML = tracks.map(function(t){
          const checked = t.albumId === album.id ? 'checked' : '';
          return `<label style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;border:1px solid var(--line);cursor:pointer">
            <input type="checkbox" data-track-id="${escapeHtml(t.id)}" ${checked} />
            <span>${escapeHtml(t.title || 'Untitled')}</span>
            ${t.albumId && t.albumId !== album.id ? `<span style="margin-left:auto;color:var(--muted);font-size:12px">in “${escapeHtml(t.album || 'another album')}”</span>` : ''}
          </label>`;
        }).join('');

        $('#albumAssignSaveBtn').onclick = async function(){
          const checked = Array.from($('#albumAssignList').querySelectorAll('input[type="checkbox"]:checked')).map(function(c){ return c.getAttribute('data-track-id'); });
          const unchecked = Array.from($('#albumAssignList').querySelectorAll('input[type="checkbox"]:not(:checked)'))
            .map(function(c){ return c.getAttribute('data-track-id'); })
            .filter(function(id){ const t = tracks.find(function(x){ return x.id === id; }); return t && t.albumId === album.id; });
          setFormMsg('albumAssignMsg', 'Saving…');
          try{
            if(checked.length) await api('/api/albums/assign', { method:'POST', body:{ albumId: album.id, trackIds: checked } });
            if(unchecked.length) await api('/api/albums/assign', { method:'POST', body:{ albumId: '', trackIds: unchecked } });
            setFormMsg('albumAssignMsg', 'Saved.', 'ok');
            showToast('Album updated', 'ok');
            await load();
          }catch(e){
            console.error(e);
            setFormMsg('albumAssignMsg', 'Failed to save.', 'error');
          }
        };
      }catch(e){
        console.error(e);
        $('#albumAssignList').innerHTML = '<div style="color:#ff6f6f;font-size:13px">Could not load songs.</div>';
      }
    }

    async function load(){
      const tbody = $('#albumTableBody');
      const empty = $('#albumEmpty');
      if(!tbody) return 0;
      try{
        await fetchAlbums();
        let songCounts = {};
        try{
          const musicData = await api('/api/music');
          const tracks = Array.isArray(musicData) ? musicData : (musicData.items || []);
          tracks.forEach(function(t){ if(t.albumId) songCounts[t.albumId] = (songCounts[t.albumId] || 0) + 1; });
        }catch(e){}

        if(!albumsCache.length){
          tbody.innerHTML = '';
          if(empty) empty.style.display = '';
          return 0;
        }
        if(empty) empty.style.display = 'none';

        tbody.innerHTML = albumsCache.map(function(a){
          return `<tr>
            <td><b>${escapeHtml(a.name)}</b></td>
            <td>${songCounts[a.id] || 0}</td>
            <td style="text-align:right;white-space:nowrap">
              <button class="btn-link" data-assign="${escapeHtml(a.id)}">Assign songs</button>
              &nbsp;·&nbsp;
              <button class="btn-link" data-edit="${escapeHtml(a.id)}">Rename</button>
              &nbsp;·&nbsp;
              <button class="btn-link" data-del="${escapeHtml(a.id)}" style="color:#ff6f6f">Delete</button>
            </td>
          </tr>`;
        }).join('');

        tbody.querySelectorAll('[data-assign]').forEach(function(b){
          b.addEventListener('click', function(){
            const album = albumsCache.find(function(a){ return a.id === b.getAttribute('data-assign'); });
            if(album) openAssign(album);
          });
        });
        tbody.querySelectorAll('[data-edit]').forEach(function(b){
          b.addEventListener('click', function(){
            const album = albumsCache.find(function(a){ return a.id === b.getAttribute('data-edit'); });
            if(album) fillForm(album);
          });
        });
        tbody.querySelectorAll('[data-del]').forEach(function(b){
          b.addEventListener('click', async function(){
            if(!confirm('Delete this album? Songs inside will stay, just unassigned.')) return;
            try{
              await api('/api/albums/' + encodeURIComponent(b.getAttribute('data-del')), { method:'DELETE' });
              showToast('Album deleted', 'ok');
              closeAssign();
              await load();
              await populateMusicAlbumSelect();
            }catch(e){ showToast('Delete failed', 'error'); }
          });
        });
        return albumsCache.length;
      }catch(e){
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="3" style="color:#ff6f6f;text-align:center;padding:20px">Could not load.</td></tr>';
        return 0;
      }
    }

    function wireForm(){
      const form = $('#albumForm');
      if(!form) return;
      populateAlbumSongsList('');
      form.addEventListener('submit', async function(e){
        e.preventDefault();
        const id = $('#albumId').value.trim();
        const name = $('#albumName').value.trim();
        if(!name){
          setFormMsg('albumMsg', 'Album name is required.', 'error');
          return;
        }
        setFormMsg('albumMsg', id ? 'Saving…' : 'Creating…');
        try{
          let albumId = id;
          if(id){
            await api('/api/albums/' + encodeURIComponent(id), { method:'PUT', body:{ name: name } });
          }else{
            const created = await api('/api/albums', { method:'POST', body:{ name: name } });
            albumId = (created && (created.id || (created.item && created.item.id))) || '';
          }

          // Assign / unassign songs based on the checklist in the form
          const box = $('#albumSongsList');
          if(albumId && box){
            const checkedIds = Array.from(box.querySelectorAll('input[type="checkbox"]:checked')).map(function(c){ return c.getAttribute('data-song-id'); });
            const uncheckedIds = Array.from(box.querySelectorAll('input[type="checkbox"]:not(:checked)'))
              .map(function(c){ return c.getAttribute('data-song-id'); })
              .filter(function(tid){ const t = allTracksCache.find(function(x){ return x.id === tid; }); return t && t.albumId === albumId; });
            try{
              if(checkedIds.length) await api('/api/albums/assign', { method:'POST', body:{ albumId: albumId, trackIds: checkedIds } });
              if(uncheckedIds.length) await api('/api/albums/assign', { method:'POST', body:{ albumId: '', trackIds: uncheckedIds } });
            }catch(assignErr){
              console.error(assignErr);
            }
          }

          setFormMsg('albumMsg', id ? 'Saved.' : 'Created.', 'ok');
          resetForm();
          await load();
          await populateMusicAlbumSelect();
        }catch(err){
          console.error(err);
          setFormMsg('albumMsg', 'Failed to save.', 'error');
        }
      });
      $('#albumCancelBtn').addEventListener('click', resetForm);
      $('#albumAssignCancelBtn').addEventListener('click', closeAssign);
    }

    return { load: load, wireForm: wireForm, resetForm: resetForm };
  }

  /* ============================================================
     MEDIA stat aggregator
     ============================================================ */
  let mediaCounts = { music:0, apps:0, paintings:0 };
  function updateMediaStat(){
    const songsEl = $('#statSongs');
    if(songsEl) songsEl.textContent = String(mediaCounts.music || 0);
    const appsEl = $('#statApps');
    if(appsEl) appsEl.textContent = String(mediaCounts.apps || 0);
  }

  /* ============================================================
     MESSAGES (VIP conversations)
     ============================================================ */
  var currentConvUserId = null;

  function escapeMessageHtml(s){
    return String(s || '').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  async function loadMessages(){
    const listWrap = $('#convListWrap');
    const chatWrap = $('#convChatWrap');
    const list = $('#convList');
    const empty = $('#convEmpty');

    // Show list view, hide chat view
    if (listWrap) listWrap.style.display = '';
    if (chatWrap) chatWrap.style.display = 'none';
    currentConvUserId = null;

    try{
      const data = await api('/api/admin/vip/conversations');
      const items = Array.isArray(data) ? data : (data.conversations || []);

      let totalUnread = 0;
      items.forEach(function(c){ totalUnread += (c.unreadByAdmin || 0); });
      $('#statMessages').textContent = String(totalUnread);

      if(!items.length){
        list.innerHTML = '';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';

      list.innerHTML = items.map(function(c){
        const who = c.userName || c.userEmail || c.userId || '—';
        const preview = (c.lastFrom === 'admin' ? 'You: ' : '') + (c.lastMessage || '');
        const badge = c.unreadByAdmin > 0 ? '<span class="conv-badge">' + c.unreadByAdmin + ' new</span>' : '';
        const tier = c.userRole || 'free';
        const tierLabel = tier === 'vip' ? 'VIP' : tier === 'gold' ? 'Gold' : tier === 'basic' ? 'Basic' : tier === 'developer' ? 'Dev' : 'Free';
        const tierTag = '<span class="conv-tier conv-tier-' + escapeMessageHtml(tier) + '">' + tierLabel + '</span>';
        return '<div class="conv-row" data-userid="' + escapeMessageHtml(c.userId) + '">' +
          '<div>' +
            '<div class="conv-who">' + escapeMessageHtml(who) + ' ' + tierTag + '</div>' +
            '<div class="conv-preview">' + escapeMessageHtml(preview) + '</div>' +
          '</div>' +
          '<div class="conv-side">' +
            badge +
            '<div class="conv-time">' + escapeMessageHtml(formatDate(c.lastUpdated)) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      list.querySelectorAll('.conv-row').forEach(function(row){
        row.addEventListener('click', function(){
          openConversation(row.getAttribute('data-userid'));
        });
      });
    }catch(e){
      console.error(e);
      if (list) list.innerHTML = '<div style="color:#ff6f6f;text-align:center;padding:20px">Could not load conversations.</div>';
    }
  }

  async function openConversation(userId){
    currentConvUserId = userId;
    const listWrap = $('#convListWrap');
    const chatWrap = $('#convChatWrap');
    const thread = $('#convChatThread');
    const header = $('#convChatHeader');

    if (listWrap) listWrap.style.display = 'none';
    if (chatWrap) chatWrap.style.display = '';
    if (thread) thread.innerHTML = '<div class="chat-empty">Loading…</div>';

    try{
      const data = await api('/api/admin/vip/conversation/' + encodeURIComponent(userId));
      const messages = data.messages || [];
      if (header) {
        const who = data.userName || data.userEmail || userId;
        header.innerHTML = '<b>' + escapeMessageHtml(who) + '</b>' +
          (data.userEmail && data.userName ? ' <span style="color:var(--muted);font-size:13px">· ' + escapeMessageHtml(data.userEmail) + '</span>' : '');
      }
      renderAdminChat(messages);
    }catch(e){
      console.error(e);
      if (thread) thread.innerHTML = '<div class="chat-empty" style="color:#ff6f6f">Could not load conversation.</div>';
    }
  }

  function renderAdminChat(messages){
    const thread = $('#convChatThread');
    if (!thread) return;
    thread.innerHTML = '';
    if (!messages.length){
      thread.innerHTML = '<div class="chat-empty">No messages yet.</div>';
      return;
    }
    messages.forEach(function(m){
      const isAdmin = m.from === 'admin';
      const row = document.createElement('div');
      // From admin's POV: their own messages = "me"
      row.className = 'chat-msg ' + (isAdmin ? 'chat-msg-me' : 'chat-msg-admin');
      row.innerHTML =
        '<div class="chat-bubble">' +
          '<div class="chat-bubble-body">' + escapeMessageHtml(m.body).replace(/\n/g, '<br>') + '</div>' +
          '<div class="chat-bubble-time">' + escapeMessageHtml(formatDate(m.createdAt)) + '</div>' +
        '</div>';
      thread.appendChild(row);
    });
    thread.scrollTop = thread.scrollHeight;
  }

  /* ============================================================
     THE WALL — moderation (edit text / delete any post)
     ============================================================ */
  async function loadWallPosts(){
    const tbody = $('#wallTableBody');
    const empty = $('#wallEmptyAdmin');
    if(!tbody) return;
    try{
      const data = await api('/api/wall');
      const posts = Array.isArray(data) ? data : (data.posts || []);
      posts.sort(function(a,b){ return +new Date(b.createdAt||0) - +new Date(a.createdAt||0); });

      if(!posts.length){
        tbody.innerHTML = '';
        if(empty) empty.style.display = '';
        return;
      }
      if(empty) empty.style.display = 'none';

      tbody.innerHTML = posts.map(function(p){
        return `<tr>
          <td><b>${escapeHtml(p.authorName || 'Member')}</b></td>
          <td>${escapeHtml(p.type || 'Comment')}</td>
          <td style="max-width:360px">${escapeHtml((p.body||'').slice(0,140))}${(p.body||'').length>140?'…':''}${p.editedByAdmin ? ' <span style="color:var(--muted);font-size:11px">(edited)</span>' : ''}</td>
          <td style="color:var(--muted);font-size:12.5px">${escapeHtml(formatDate(p.createdAt))}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="btn-link" data-edit="${escapeHtml(p.id)}">Edit</button>
            &nbsp;·&nbsp;
            <button class="btn-link" data-del="${escapeHtml(p.id)}" style="color:#ff6f6f">Delete</button>
          </td>
        </tr>`;
      }).join('');

      tbody.querySelectorAll('[data-edit]').forEach(function(b){
        b.addEventListener('click', function(){
          const id = b.getAttribute('data-edit');
          const post = posts.find(function(p){ return p.id === id; });
          if(!post) return;
          $('#wallEditId').value = post.id;
          $('#wallEditBody').value = post.body || '';
          $('#wallEditForm').style.display = '';
          setFormMsg('wallAdminMsg', '');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      tbody.querySelectorAll('[data-del]').forEach(function(b){
        b.addEventListener('click', async function(){
          if(!confirm('Delete this post from the Wall?')) return;
          try{
            await api('/api/wall/' + encodeURIComponent(b.getAttribute('data-del')), { method:'DELETE' });
            showToast('Deleted', 'ok');
            loadWallPosts();
          }catch(e){ showToast('Delete failed', 'error'); }
        });
      });
    }catch(e){
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="5" style="color:#ff6f6f;text-align:center;padding:20px">Could not load.</td></tr>';
    }
  }

  function wireWallModeration(){
    const form = $('#wallEditForm');
    const cancelBtn = $('#wallEditCancelBtn');
    if(!form) return;
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      const id = $('#wallEditId').value.trim();
      const body = $('#wallEditBody').value.trim();
      if(!id || !body){ setFormMsg('wallAdminMsg', 'Post text cannot be empty.', 'error'); return; }
      setFormMsg('wallAdminMsg', 'Saving…');
      try{
        await api('/api/wall/' + encodeURIComponent(id), { method:'PUT', body:{ body: body } });
        form.style.display = 'none';
        form.reset();
        setFormMsg('wallAdminMsg', 'Saved ✓', 'ok');
        loadWallPosts();
      }catch(err){
        console.error(err);
        setFormMsg('wallAdminMsg', 'Failed to save.', 'error');
      }
    });
    if(cancelBtn) cancelBtn.addEventListener('click', function(){
      form.style.display = 'none';
      form.reset();
      setFormMsg('wallAdminMsg', '');
    });
  }

  function wireConversationUI(){
    const backBtn = $('#convBackBtn');
    if (backBtn) backBtn.addEventListener('click', loadMessages);

    const form = $('#convChatForm');
    const input = $('#convChatInput');
    const status = $('#convChatStatus');

    if (form && input){
      form.addEventListener('submit', async function(e){
        e.preventDefault();
        if (!currentConvUserId) return;
        const text = input.value.trim();
        if (!text) return;
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        if (status){ status.textContent = 'Sending…'; status.style.color = 'var(--muted)'; }
        try{
          await api('/api/admin/vip/conversation/' + encodeURIComponent(currentConvUserId), {
            method: 'POST',
            body: JSON.stringify({ body: text }),
          });
          input.value = '';
          if (status) status.textContent = '';
          // Reload the conversation to show the new message
          await openConversation(currentConvUserId);
        }catch(err){
          if (status){ status.textContent = err.message || 'Send failed.'; status.style.color = '#ff6f6f'; }
        }finally{
          if (btn) btn.disabled = false;
        }
      });

      input.addEventListener('keydown', function(e){
        if (e.key === 'Enter' && !e.shiftKey){
          e.preventDefault();
          form.requestSubmit();
        }
      });
    }
  }

  /* ============================================================
     LEGACY MESSAGE MODAL (kept as no-op to avoid breaking existing wiring)
     ============================================================ */
  function openMessageModal(m){
    if(!m) return;
    const modal = $('#msgModal');
    const meta  = $('#msgModalMeta');
    const subj  = $('#msgModalSubject');
    const body  = $('#msgModalBody');
    if(meta) meta.textContent = (m.fromName || m.fromEmail || m.fromUserId || '—') + ' · ' + formatDate(m.createdAt);
    if(subj) subj.textContent = m.subject || '(no subject)';
    if(body) body.textContent = m.body || '';
    if(modal){
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden','false');
      document.body.style.overflow = 'hidden';
    }
  }
  function closeMessageModal(){
    const modal = $('#msgModal');
    if(modal){
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden','true');
      document.body.style.overflow = '';
    }
  }
  function wireMessageModal(){
    const modal = $('#msgModal');
    const x     = $('#msgModalClose');
    if(x) x.addEventListener('click', closeMessageModal);
    if(modal){
      modal.addEventListener('click', function(e){ if(e.target === modal) closeMessageModal(); });
    }
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape') closeMessageModal();
    });
  }

  /* ============================================================
     USERS
     ============================================================ */
  var userPaginationState = { page: 1, perPage: 50, allUsers: [], totalCount: 0 };
  var usersUnsubscribe = null;

  // Le compteur "Accounts created" écoute Firestore en temps réel : dès
  // qu'un nouveau document users/{uid} est créé (à l'inscription d'un
  // client), le chiffre se met à jour seul, sans recharger la page.
  function wireUsersRealtimeCounter(){
    // NOTE : on n'utilise plus onSnapshot() ici. Un listener temps réel sur
    // TOUTE la collection users relit tous les documents à chaque ouverture
    // du panel ET reste actif en permanence — gros consommateur de quota
    // Firestore (plan gratuit = 50k lectures/jour). Le compteur "Accounts
    // created" est désormais rempli par loadUsers() (une seule lecture),
    // ce qui suffit largement : pas besoin de temps réel pour un compteur.
    return;
  }

  async function loadUsers(){
    const tbody = $('#userTableBody');
    const empty = $('#userEmpty');
    const paginationWrap = $('#userPaginationWrap');
    try{
      const data = await api('/api/users');
      const items = Array.isArray(data) ? data : (data.users || []);
      userPaginationState.allUsers = items;
      userPaginationState.totalCount = data.totalCount || items.length;
      userPaginationState.page = 1;
      // Alimente aussi l'onglet Paid Users avec les mêmes données (une
      // seule lecture de la collection au lieu de deux).
      loadPaidUsers(items);

      // Compteur "Accounts created" : rempli ici, à partir des données déjà
      // chargées (aucune lecture Firestore supplémentaire). Remplace l'ancien
      // listener onSnapshot temps réel, trop coûteux en quota.
      var statUsersEl = $('#statUsers');
      if(statUsersEl) statUsersEl.textContent = String(data.totalCount || items.length);

      if(!items.length){
        tbody.innerHTML = '';
        paginationWrap.style.display = 'none';
        empty.style.display = '';
        return;
      }
      empty.style.display = 'none';
      renderUserPage();
      setupUserPagination();
    }catch(e){
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="5" style="color:#ff6f6f;text-align:center;padding:20px">Could not load users.</td></tr>';
      paginationWrap.style.display = 'none';
    }
  }

  function renderUserPage(){
    const tbody = $('#userTableBody');
    const paginationWrap = $('#userPaginationWrap');
    const perPage = userPaginationState.perPage;
    const page = userPaginationState.page;
    const allUsers = userPaginationState.allUsers;
    const totalCount = userPaginationState.totalCount;

    const totalPages = Math.ceil(totalCount / perPage);
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const pageUsers = allUsers.slice(start, end);

    tbody.innerHTML = pageUsers.map(function(u){
      const role = (u.role || 'free').toLowerCase();
      const roleOpts = ALL_ROLES.map(function(r){
        return '<option value="' + r + '"' + (r === role ? ' selected' : '') + '>' + r + '</option>';
      }).join('');
      const displayName = u.displayName || (u.email ? u.email.split('@')[0] : '') || '(no name)';
      const email = u.email || '(no email on file)';
      return `<tr>
        <td><b>${escapeHtml(displayName)}</b></td>
        <td style="color:var(--muted);font-size:13px">${escapeHtml(email)}</td>
        <td>
          <select class="select-sm" data-role-user="${escapeHtml(u.id)}" style="padding:6px 8px;font-size:12.5px">
            ${roleOpts}
          </select>
        </td>
        <td style="color:var(--muted);font-size:12.5px">${escapeHtml(formatDate(u.createdAt))}</td>
        <td style="text-align:right;white-space:nowrap">
          ${role === 'developer' ? '<span style="color:var(--muted);font-size:12.5px">protected</span>' : `<button class="btn-link" data-del-user="${escapeHtml(u.id)}" style="color:#ff6f6f">Delete</button>`}
        </td>
      </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-role-user]').forEach(function(sel){
      sel.addEventListener('change', async function(){
        const id   = sel.getAttribute('data-role-user');
        const role = sel.value;
        try{
          await api('/api/users/' + encodeURIComponent(id), { method:'PUT', body:{ role: role } });
          showToast('Role updated to ' + role, 'ok');
          loadPaidUsers();
        }catch(e){ showToast('Could not update role', 'error'); loadUsers(); }
      });
    });
    tbody.querySelectorAll('[data-del-user]').forEach(function(b){
      b.addEventListener('click', async function(){
        if(!confirm('Delete this user account?')) return;
        try{
          await api('/api/users/' + encodeURIComponent(b.getAttribute('data-del-user')), { method:'DELETE' });
          showToast('User deleted', 'ok');
          loadUsers();
        }catch(e){ showToast('Delete failed', 'error'); }
      });
    });

    // Afficher/masquer la pagination
    if(totalPages > 1){
      paginationWrap.style.display = '';
      $('#userPageCurrent').textContent = String(page);
      $('#userPageTotal').textContent = String(totalPages);
      $('#userPageCount').textContent = String(totalCount);
    }else{
      paginationWrap.style.display = 'none';
    }
  }

  function setupUserPagination(){
    const totalCount = userPaginationState.totalCount;
    const perPage = userPaginationState.perPage;
    const totalPages = Math.ceil(totalCount / perPage);
    const currentPage = userPaginationState.page;
    const pageNumbersWrap = $('#userPageNumbers');

    // Générer les numéros de page (avec limitation intelligente)
    var pageNumbers = [];
    var maxPagesToShow = 10;
    var startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    var endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    if(endPage - startPage + 1 < maxPagesToShow) startPage = Math.max(1, endPage - maxPagesToShow + 1);

    if(startPage > 1) pageNumbers.push(1, '...');
    for(var i = startPage; i <= endPage; i++) pageNumbers.push(i);
    if(endPage < totalPages) pageNumbers.push('...', totalPages);

    pageNumbersWrap.innerHTML = pageNumbers.map(function(p){
      if(p === '...') return '<span style="padding:0 4px;color:var(--muted)">…</span>';
      const isActive = p === currentPage;
      return `<button type="button" class="btn-link" data-page="${p}" style="padding:6px 10px;${isActive ? 'background:var(--gold);color:var(--bg);border-radius:4px;font-weight:600' : ''}">${p}</button>`;
    }).join('');

    pageNumbersWrap.querySelectorAll('[data-page]').forEach(function(btn){
      btn.addEventListener('click', function(){
        userPaginationState.page = parseInt(btn.getAttribute('data-page'), 10);
        renderUserPage();
        setupUserPagination();
      });
    });

    const prevBtn = $('#userPagePrev');
    const nextBtn = $('#userPageNext');
    prevBtn.disabled = currentPage <= 1;
    nextBtn.disabled = currentPage >= totalPages;
    prevBtn.addEventListener('click', function(){
      if(currentPage > 1){
        userPaginationState.page--;
        renderUserPage();
        setupUserPagination();
      }
    });
    nextBtn.addEventListener('click', function(){
      if(currentPage < totalPages){
        userPaginationState.page++;
        renderUserPage();
        setupUserPagination();
      }
    });
  }

  /* ============================================================
     PAID USERS TAB
     ============================================================ */
  async function loadPaidUsers(usersData){
    const tbody = $('#paidUserTableBody');
    const empty = $('#paidUserEmpty');
    if(!tbody) return;
    try{
      // Réutilise les données déjà chargées par loadUsers() quand c'est
      // possible, pour ne pas relire toute la collection une 2e fois
      // (économie de quota Firestore).
      let items = usersData;
      if(!items){
        const data = await api('/api/users');
        items = Array.isArray(data) ? data : (data.users || []);
      }
      const paid = items.filter(function(u){
        return ['basic','gold','vip'].indexOf((u.role||'free').toLowerCase()) !== -1;
      });

      const countBasic = paid.filter(function(u){ return (u.role||'').toLowerCase() === 'basic'; }).length;
      const countGold  = paid.filter(function(u){ return (u.role||'').toLowerCase() === 'gold'; }).length;
      const countVip   = paid.filter(function(u){ return (u.role||'').toLowerCase() === 'vip'; }).length;
      if($('#paidCountBasic')) $('#paidCountBasic').textContent = String(countBasic);
      if($('#paidCountGold'))  $('#paidCountGold').textContent  = String(countGold);
      if($('#paidCountVip'))   $('#paidCountVip').textContent   = String(countVip);
      const countTrial = items.filter(function(u){ return (u.role||'').toLowerCase() === 'trial'; }).length;
      if($('#paidCountTrial')) $('#paidCountTrial').textContent = String(countTrial);
      if($('#paidCountTotal')) $('#paidCountTotal').textContent = String(paid.length);
      if($('#statPaidUsers'))  $('#statPaidUsers').textContent  = String(paid.length);

      if(!paid.length){
        tbody.innerHTML = '';
        if(empty) empty.style.display = '';
        return;
      }
      if(empty) empty.style.display = 'none';

      paid.sort(function(a,b){
        const ta = +new Date(a.createdAt || 0);
        const tb = +new Date(b.createdAt || 0);
        return (isFinite(tb) ? tb : 0) - (isFinite(ta) ? ta : 0);
      });

      tbody.innerHTML = paid.map(function(u){
        const role = (u.role || 'free').toLowerCase();
        const displayName = u.displayName || (u.email ? u.email.split('@')[0] : '') || '(no name)';
        const email = u.email || '(no email on file)';
        return `<tr>
          <td><b>${escapeHtml(displayName)}</b></td>
          <td style="color:var(--muted);font-size:13px">${escapeHtml(email)}</td>
          <td>${escapeHtml(role.charAt(0).toUpperCase() + role.slice(1))}</td>
          <td style="color:var(--muted);font-size:12.5px">${escapeHtml(formatDate(u.createdAt))}</td>
        </tr>`;
      }).join('');
    }catch(e){
      console.error(e);
      tbody.innerHTML = '<tr><td colspan="4" style="color:#ff6f6f;text-align:center;padding:20px">Could not load paid members.</td></tr>';
    }
  }

  /* ============================================================
     ANALYTICS
     ============================================================ */
  let analyticsRangeDays = 7; // 7 | 30 | 'all'
  let analyticsCache = null;       // { rows: [...], fetchedAt: number }
  const ANALYTICS_CACHE_MS = 30 * 60 * 1000; // 30 min de cache — sur le plan Firebase gratuit (50k lectures/jour), lire les pageViews à chaque ouverture épuise vite le quota et bloque alors TOUT le site, y compris les inscriptions. Un cache long protège le quota.
  const ANALYTICS_READ_LIMIT = 5000; // sample pour les répartitions bas de page (pays/pages/device/referrer). Le total en haut est exact via count() paginé — ce sample sert juste aux tables.

  function withinRange(iso, days){
    if(days === 'all') return true;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return +new Date(iso) >= cutoff;
  }

  function topEntries(counts, limit){
    return Object.keys(counts)
      .map(function(k){ return [k, counts[k]]; })
      .sort(function(a,b){ return b[1]-a[1]; })
      .slice(0, limit || 10);
  }

  function fillTable(tbodySel, emptySel, rows, labelFn){
    const tbody = $(tbodySel), empty = $(emptySel);
    if(!tbody) return;
    if(!rows.length){
      tbody.innerHTML = '';
      if(empty) empty.style.display = '';
      return;
    }
    if(empty) empty.style.display = 'none';
    tbody.innerHTML = rows.map(function(r){
      return `<tr><td>${escapeHtml(labelFn(r[0]))}</td><td>${r[1]}</td></tr>`;
    }).join('');
  }

  async function loadAnalytics(){
    const statViews = $('#statViews');
    try{
      const now = Date.now();
      const cacheIsFresh = analyticsCache && (now - analyticsCache.fetchedAt) < ANALYTICS_CACHE_MS;

      let all;
      if(cacheIsFresh){
        all = analyticsCache.rows;
      }else{
        if(statViews) statViews.textContent = '…';
        await waitForFirebase();
        const db = firebase.firestore();
        // Firestore (compat) ne permet pas de filtrer facilement par date
        // ET trier sans index composite — on charge un lot raisonnable et
        // on filtre/agrège côté client. 2000 vues récentes suffisent
        // largement pour des stats agrégées (pays/pages/device/referrer),
        // et on met le résultat en cache 2 min pour que changer de range
        // (7j/30j/all) ne redéclenche pas un téléchargement complet.
        const snap = await db.collection('pageViews').orderBy('createdAt', 'desc').limit(ANALYTICS_READ_LIMIT).get();
        all = [];
        snap.forEach(function(d){ all.push(d.data()); });
        analyticsCache = { rows: all, fetchedAt: now, capped: all.length >= ANALYTICS_READ_LIMIT };
      }

      const rows = all.filter(function(v){ return withinRange(v.createdAt, analyticsRangeDays); });

      // ── Total EXACT via pagination ──
      // count() de Firestore n'est pas exposé dans notre SDK compat, donc
      // on pagine : on lit par lots de 1000 documents (limite max en une
      // requête), on avance avec startAfter() sur le dernier doc de chaque
      // lot, et on compte au fur et à mesure. Aucune limite haute totale :
      // 5000 vues = 5 lots, 50000 = 50 lots, etc. Chaque lot = 1000
      // lectures Firestore, coût maîtrisé.
      let exactCount = null;
      let countError = null;
      try{
        const db2 = firebase.firestore();
        const cutoff = analyticsRangeDays === 'all'
          ? null
          : new Date(Date.now() - analyticsRangeDays*24*60*60*1000).toISOString();
        let total = 0;
        let lastDoc = null;
        const BATCH = 1000;
        const HARD_MAX_BATCHES = 100; // garde-fou : 100 000 vues max, largement au-dessus des besoins
        for(let i = 0; i < HARD_MAX_BATCHES; i++){
          let q = db2.collection('pageViews').orderBy('createdAt', 'desc');
          if(cutoff){ q = q.where('createdAt', '>=', cutoff); }
          if(lastDoc){ q = q.startAfter(lastDoc); }
          q = q.limit(BATCH);
          const snap = await q.get();
          total += snap.size;
          if(snap.size < BATCH) break; // dernier lot
          lastDoc = snap.docs[snap.docs.length - 1];
        }
        exactCount = total;
      }catch(e){
        countError = (e && (e.code || e.message)) || String(e);
        console.error('[analytics] paginated count failed:', e);
      }


      const sessions = {};
      const countryCounts = {};
      const pageCounts = {};
      const deviceCounts = {};
      const referrerCounts = {};
      let totalDuration = 0, durationCount = 0;

      rows.forEach(function(v){
        sessions[v.sessionId] = true;
        if(v.country) countryCounts[v.country] = (countryCounts[v.country]||0) + 1;
        if(v.page) pageCounts[v.page] = (pageCounts[v.page]||0) + 1;
        if(v.device) deviceCounts[v.device] = (deviceCounts[v.device]||0) + 1;
        const ref = v.referrer ? (function(){ try{ return new URL(v.referrer).hostname; }catch(e){ return v.referrer; } })() : 'Direct / none';
        referrerCounts[ref] = (referrerCounts[ref]||0) + 1;
        if(typeof v.durationSeconds === 'number' && v.durationSeconds > 0){
          totalDuration += v.durationSeconds;
          durationCount++;
        }
      });

      // Si on a atteint la limite de lecture, le vrai total est plus élevé :
      // on l'indique avec un "+" plutôt que d'afficher un faux total exact.
      // Ça s'applique quel que soit le range affiché (7j/30j/all) : la limite
      // porte sur le nombre de documents LUS depuis Firestore, donc même la
      // vue "30 days" peut être tronquée si le site a beaucoup de trafic.
      if(exactCount !== null){
        $('#statViews').textContent = String(exactCount);
      } else {
        // Pas de fallback plafonné — on montre '?' et le vrai souci en
        // toast pour qu'il soit corrigeable, plutôt qu'un chiffre faux.
        $('#statViews').textContent = '?';
        if(countError) showToast('Analytics count failed: ' + countError, 'error');
      }
      $('#statVisitors').textContent = String(Object.keys(sessions).length);
      $('#statAvgDuration').textContent = durationCount ? Math.round(totalDuration/durationCount) + 's' : '—';
      const topPage = topEntries(pageCounts, 1)[0];
      $('#statTopPage').textContent = topPage ? topPage[0].replace(/^\//, '').replace('.html','') || 'home' : '—';

      fillTable('#statsCountryBody', '#statsCountryEmpty', topEntries(countryCounts, 10), function(k){ return k; });
      fillTable('#statsPagesBody', '#statsPagesEmpty', topEntries(pageCounts, 10), function(k){ return k.replace(/^\//, '').replace('.html','') || 'home'; });
      fillTable('#statsDeviceBody', '#statsDeviceEmpty', topEntries(deviceCounts, 10), function(k){ return k; });
      loadUserEngagement();
      fillTable('#statsReferrerBody', '#statsReferrerEmpty', topEntries(referrerCounts, 10), function(k){ return k; });
    }catch(e){
      console.error('Analytics load error:', e);
      var detail = (e && e.message) ? e.message : String(e);
      showToast('Could not load analytics: ' + detail, 'error');
      if(statViews) statViews.textContent = '—';
    }
  }

  async function loadUserEngagement(){
    const tbody = $('#engagementBody');
    if(!tbody) return;
    try{
      const db = firebase.firestore();
      const snap = await db.collection('userStats').orderBy('visits','desc').limit(50).get();
      const rows = [];
      snap.forEach(function(d){ rows.push(d.data()); });
      if(!rows.length){
        tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;padding:16px">No member visits tracked yet — data starts collecting once members browse the site.</td></tr>';
        return;
      }
      tbody.innerHTML = rows.map(function(u, i){
        const last = u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleDateString() + ' ' + new Date(u.lastSeenAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
        return '<tr>'
          + '<td style="color:var(--gold);font-weight:700">#' + (i+1) + '</td>'
          + '<td><b>' + escapeHtml(u.displayName || '(no name)') + '</b><div style="color:var(--muted);font-size:12px">' + escapeHtml(u.email || '') + '</div></td>'
          + '<td>' + (u.visits || 0) + '</td>'
          + '<td>' + (u.points || 0) + '</td>'
          + '<td style="color:var(--muted);font-size:12.5px">' + escapeHtml(last) + '</td>'
          + '</tr>';
      }).join('');
    }catch(e){
      console.error('Engagement load error:', e);
      tbody.innerHTML = '<tr><td colspan="5" style="color:#ff6f6f;text-align:center;padding:16px">Could not load engagement data.</td></tr>';
    }
  }

  function wireAnalyticsRangeButtons(){
    $$('.analytics-range').forEach(function(btn){
      btn.addEventListener('click', function(){
        $$('.analytics-range').forEach(function(b){ b.classList.toggle('active', b === btn); });
        const r = btn.getAttribute('data-range');
        analyticsRangeDays = r === 'all' ? 'all' : parseInt(r, 10);
        loadAnalytics();
      });
    });
  }

  /* ============================================================
     INIT
     ============================================================ */
  async function init(){
    wireTabs();
    wireMessageModal();

    const me = await checkDeveloper();
    if(!me) return;

    /* Predictions */
    wirePredForm();
    wireFileUpload('#predImageFile', '#predImage', '#predImageProgress', '#predImagePreview', 'predictionImage');
    wireFileUpload('#predVideoFile', '#predVideo', '#predVideoProgress', '#predVideoPreview', 'predictionVideo');
    resetPredForm();
    loadPredictions();

    /* Media modules */
    const music     = makeMediaModule('music');
    const apps      = makeMediaModule('apps');
    const paintings = makeMediaModule('paintings');
    const correctpredictions = makeMediaModule('correctpredictions');
    const socials  = makeMediaModule('socials');
    const pricelist = makeMediaModule('pricelist');
    const albums    = makeAlbumsModule();
    music.wireForm();      music.resetForm();
    apps.wireForm();       apps.resetForm();
    paintings.wireForm();  paintings.resetForm();
    correctpredictions.wireForm();  correctpredictions.resetForm();
    socials.wireForm();   socials.resetForm();
    pricelist.wireForm(); pricelist.resetForm();
    albums.wireForm();     albums.resetForm();

    Promise.all([
      music.load().then(function(n){ mediaCounts.music = n; }),
      apps.load().then(function(n){ mediaCounts.apps = n; }),
      paintings.load().then(function(n){ mediaCounts.paintings = n; }),
      correctpredictions.load(),
      socials.load(),
      pricelist.load(),
      albums.load(),
      populateMusicAlbumSelect()
    ]).then(updateMediaStat);

    /* Messages + users */
    wireConversationUI();
    loadMessages();
    wireWallModeration();
    loadWallPosts();
    wireUsersRealtimeCounter();
    loadUsers(); // alimente aussi l'onglet Paid Users

    /* Analytics — chargé à la demande quand on ouvre l'onglet (voir wireTabs),
       pour ne pas consommer le quota Firestore à chaque ouverture du panel. */
    wireAnalyticsRangeButtons();
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
