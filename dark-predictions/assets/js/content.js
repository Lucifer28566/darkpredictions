/* ============================================================
   content.js — render music / apps / paintings pages
   Exposes window.DPContent.renderMedia(kind, gridSel, emptySel)
   ============================================================ */
(function(){
  'use strict';

  function escapeHtml(s){
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function escapeAttr(s){ return escapeHtml(s); }

  function safeUrl(u){
    if(!u) return '';
    try{
      const url = new URL(u, window.location.href);
      if(url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    }catch(e){ return ''; }
  }

  /* Detect well-known embeds */
  function youtubeId(url){
    if(!url) return null;
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    return m ? m[1] : null;
  }
  function vimeoId(url){
    if(!url) return null;
    const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1] : null;
  }
  function spotifyEmbed(url){
    if(!url) return null;
    const m = url.match(/open\.spotify\.com\/(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
  }
  function soundcloudEmbed(url){
    if(!url || !/soundcloud\.com/.test(url)) return null;
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23F4D27A&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false`;
  }
  function isImageUrl(url){
    return /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url || '');
  }
  function isVideoFileUrl(url){
    return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(url || '');
  }
  function isAudioFileUrl(url){
    return /\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/i.test(url || '');
  }

  /* Build cover/embed HTML */
  function buildCoverHtml(item, kind){
    const cover = safeUrl(item.coverUrl || item.cover || '');
    const url = safeUrl(item.url || '');

    /* PAINTINGS: prefer image cover/url, no embeds */
    if(kind === 'paintings'){
      const img = cover || (isImageUrl(url) ? url : '');
      if(img){
        return `<div class="cover"><img src="${escapeAttr(img)}" alt="${escapeAttr(item.title || 'painting')}" loading="lazy"></div>`;
      }
      return `<div class="cover" style="display:grid;place-items:center;color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:12px;">no image</div>`;
    }

    /* MUSIC: prefer embed (YouTube, Spotify, SoundCloud, audio file) */
    if(kind === 'music'){
      const yt = youtubeId(url);
      if(yt) return `<div class="cover"><div class="embed"><iframe src="https://www.youtube.com/embed/${yt}" title="${escapeAttr(item.title)}" loading="lazy" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div></div>`;
      const sp = spotifyEmbed(url);
      if(sp) return `<div class="cover" style="aspect-ratio:auto;"><iframe src="${sp}" width="100%" height="232" frameborder="0" allow="encrypted-media" loading="lazy"></iframe></div>`;
      const sc = soundcloudEmbed(url);
      if(sc) return `<div class="cover" style="aspect-ratio:auto;height:166px;"><iframe src="${sc}" width="100%" height="166" frameborder="0" loading="lazy" allow="autoplay"></iframe></div>`;
      const vm = vimeoId(url);
      if(vm) return `<div class="cover"><div class="embed"><iframe src="https://player.vimeo.com/video/${vm}" title="${escapeAttr(item.title)}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div></div>`;
      if(isAudioFileUrl(url)){
        return `<div class="cover" style="aspect-ratio:auto;padding:18px;display:flex;align-items:center;"><audio controls preload="none" src="${escapeAttr(url)}" style="width:100%"></audio></div>`;
      }
      if(cover) return `<div class="cover"><img src="${escapeAttr(cover)}" alt="${escapeAttr(item.title || 'cover')}" loading="lazy"></div>`;
      return `<div class="cover" style="display:grid;place-items:center;color:var(--muted);font-family:'JetBrains Mono',monospace;font-size:12px;">audio</div>`;
    }

    /* APPS: prefer cover image; otherwise show a stylised placeholder */
    if(kind === 'apps'){
      if(cover) return `<div class="cover"><img src="${escapeAttr(cover)}" alt="${escapeAttr(item.title || 'app')}" loading="lazy"></div>`;
      const initials = (item.title || 'AP').slice(0,2).toUpperCase();
      return `<div class="cover" style="display:grid;place-items:center;background:linear-gradient(135deg,#1a1a22,#0d0d12);">
        <span style="font-family:'Sora',sans-serif;font-size:42px;font-weight:700;letter-spacing:.05em;background:linear-gradient(135deg,var(--gold),var(--gold-2));-webkit-background-clip:text;background-clip:text;color:transparent;">${escapeHtml(initials)}</span>
      </div>`;
    }

    return '';
  }

  function buildActions(item, kind){
    const url = safeUrl(item.url || '');
    if(!url) return '';
    let label = 'Open';
    if(kind === 'music') label = 'Listen';
    if(kind === 'apps')  label = 'Launch';
    if(kind === 'paintings') label = 'View original';

    // Pour la musique, si c'est un fichier audio direct (uploadé), on
    // propose aussi un téléchargement en plus de l'écoute.
    if(kind === 'music' && isAudioFileUrl(url)){
      const fileName = (item.title || 'track').replace(/[^a-z0-9\-_ ]/gi, '').trim() || 'track';
      return `<div class="actions" style="gap:14px;display:flex;flex-wrap:wrap">
        <a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label} →</a>
        <a href="${escapeAttr(url)}" download="${escapeAttr(fileName)}.mp3" rel="noopener noreferrer">Download ⭳</a>
      </div>`;
    }

    return `<div class="actions"><a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label} →</a></div>`;
  }

  function buildCard(item, kind){
    const title = escapeHtml(item.title || 'Untitled');
    const tag   = item.tag ? `<span class="meta">${escapeHtml(item.tag)}</span>` : '';
    const desc  = item.description ? `<p>${escapeHtml(item.description)}</p>` : '';
    const cover = buildCoverHtml(item, kind);
    const actions = buildActions(item, kind);

    if(kind === 'paintings'){
      const fullImg = safeUrl(item.url || item.coverUrl || '');
      return `<button type="button" class="media-card" data-full="${escapeAttr(fullImg)}" data-caption="${escapeAttr(item.title || '')}${item.description ? ' — ' + escapeAttr(item.description) : ''}" style="text-align:left;width:100%;border:0;background:none;padding:0;margin:0;cursor:pointer;font:inherit;color:inherit">
        ${cover}
        <div class="body">
          ${tag}
          <h3>${title}</h3>
          ${desc}
        </div>
      </button>`;
    }

    return `<article class="media-card">
      ${cover}
      <div class="body">
        ${tag}
        <h3>${title}</h3>
        ${desc}
        ${actions}
      </div>
    </article>`;
  }

  /* Lightbox wiring (paintings page) */
  function wireLightbox(grid){
    const lb     = document.querySelector('#lightbox');
    const lbImg  = document.querySelector('#lightboxImg');
    const lbCap  = document.querySelector('#lightboxCaption');
    const lbX    = document.querySelector('#lightboxClose');
    if(!lb || !lbImg) return;

    function open(src, caption){
      lbImg.src = src;
      if(lbCap) lbCap.textContent = caption || '';
      lb.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
    function close(){
      lb.classList.remove('is-open');
      lbImg.src = '';
      document.body.style.overflow = '';
    }

    function handleActivate(e){
      const card = e.target.closest('.media-card');
      if(!card) return;
      const full = card.getAttribute('data-full');
      const cap  = card.getAttribute('data-caption') || '';
      if(full) open(full, cap);
    }

    grid.addEventListener('click', handleActivate);

    if(lbX) lbX.addEventListener('click', close);
    lb.addEventListener('click', function(e){ if(e.target === lb) close(); });
    document.addEventListener('keydown', function(e){
      if(e.key === 'Escape' && lb.classList.contains('is-open')) close();
    });
  }

  async function renderMedia(kind, gridSel, emptySel){
    const grid  = document.querySelector(gridSel);
    const empty = document.querySelector(emptySel);
    if(!grid) return;

    grid.classList.add('media-grid');
    if(kind === 'paintings') grid.classList.add('paintings-grid');
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:32px;font-family:\'JetBrains Mono\',monospace;font-size:12px;">Loading…</div>';

    try{
      const res = await fetch('/api/' + kind, { credentials: 'include' });
      if(!res.ok) throw new Error('http_' + res.status);
      const data = await res.json();
      const items = Array.isArray(data) ? data : (data.items || []);

      if(empty) empty.style.display = 'none';
      if(!items.length){
        grid.innerHTML = '';
        return;
      }

      /* newest first */
      items.sort(function(a,b){
        const ta = +new Date(a.createdAt || a.created || 0);
        const tb = +new Date(b.createdAt || b.created || 0);
        return tb - ta;
      });

      grid.innerHTML = items.map(function(it){ return buildCard(it, kind); }).join('');

      if(kind === 'paintings') wireLightbox(grid);
    }catch(err){
      console.error('[content]', kind, err);
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:var(--muted);padding:32px;">Unable to load. Please refresh.</div>';
    }
  }

  window.DPContent = { renderMedia: renderMedia };
})();
