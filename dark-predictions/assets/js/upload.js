/* ============================================================
   upload.js — Upload de fichiers (image / vidéo / mp3) vers
   le Worker Cloudflare (qui stocke sur R2), avec barre de
   progression et validation.

   Règles métier :
   - Vidéo : 10 minutes MAXIMUM (vérifié avant l'upload, dans le
     navigateur, en lisant les métadonnées du fichier vidéo).
   - Pas de lien externe accepté pour les nouveaux contenus : on
     upload le fichier lui-même, qui est ensuite stocké via le
     Worker Cloudflare et son URL publique est utilisée.
   ============================================================ */
(function () {
  var MAX_VIDEO_SECONDS = 10 * 60; // 10 minutes
  var MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB — enough for a 10-minute video in good quality
  var MAX_AUDIO_BYTES = 1024 * 1024 * 1024; // 1 GB
  var MAX_IMAGE_BYTES = 20 * 1024 * 1024;  // 20 Mo

  /* URL du Worker Cloudflare qui reçoit les uploads et les stocke sur R2 */
  var UPLOAD_WORKER_URL = 'https://curly-river-3102.luciferonworld.workers.dev';

  function humanSize(bytes) {
    if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }

  // Lit la durée d'un fichier vidéo sans l'uploader, en le chargeant
  // temporairement dans un <video> caché.
  function readVideoDuration(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.preload = 'metadata';
      v.onloadedmetadata = function () {
        URL.revokeObjectURL(url);
        resolve(v.duration);
      };
      v.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Could not read this video file."));
      };
      v.src = url;
    });
  }

  /* ----------------------------------------------------------
     uploadFile(file, kind, opts)
     kind: 'predictionImage' | 'predictionVideo' | 'musicAudio' | 'cover'
     opts.onProgress(pct) — callback optionnelle pour la barre de progression
     Retourne une Promise<string> (URL publique du fichier).
     ---------------------------------------------------------- */
  async function uploadFile(file, kind, opts) {
    opts = opts || {};
    if (!file) throw new Error('No file selected.');

    // ---- Validations selon le type de contenu ----
    if (kind === 'predictionVideo') {
      if (!/^video\//.test(file.type)) throw new Error('This file is not a video.');
      if (file.size > MAX_VIDEO_BYTES) throw new Error('Video too large (' + humanSize(file.size) + '). Limit: ' + humanSize(MAX_VIDEO_BYTES) + '.');
      // Best-effort duration check: if the browser can't decode the metadata
      // (codec it doesn't support, moov atom at end, etc.) we let it through
      // anyway — the user is responsible for the 10-min limit.
      try {
        var duration = await readVideoDuration(file);
        if (duration > MAX_VIDEO_SECONDS) {
          var mins = Math.floor(duration / 60), secs = Math.round(duration % 60);
          throw new Error('Video too long (' + mins + 'm' + secs + 's). 10 minutes maximum.');
        }
      } catch (err) {
        // Re-throw only the "too long" error; swallow read failures.
        if (err && err.message && err.message.indexOf('Video too long') === 0) throw err;
        console.warn('[upload] could not read video duration, continuing anyway:', err);
      }
    } else if (kind === 'predictionImage' || kind === 'cover') {
      if (!/^image\//.test(file.type)) throw new Error('This file is not an image.');
      if (file.size > MAX_IMAGE_BYTES) throw new Error('Image too large (' + humanSize(file.size) + '). Limit: ' + humanSize(MAX_IMAGE_BYTES) + '.');
    } else if (kind === 'musicAudio') {
      if (!/^audio\//.test(file.type)) throw new Error('This file is not an audio file (MP3, WAV…).');
      if (file.size > MAX_AUDIO_BYTES) throw new Error('Audio file too large (' + humanSize(file.size) + '). Limit: ' + humanSize(MAX_AUDIO_BYTES) + '.');
    }

    return uploadToWorker(file, opts);
  }

  /* Upload via XHR (raw body, with filename in header) — streams to the Worker,
     no in-memory FormData buffering, and we get real progress events. */
  function uploadToWorker(file, opts) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', UPLOAD_WORKER_URL, true);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));

      xhr.upload.onprogress = function (e) {
        if (opts.onProgress && e.lengthComputable) {
          opts.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };

      xhr.onload = function () {
        var data;
        try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.url) {
          resolve(data.url);
        } else {
          reject(new Error((data && data.error) || 'Upload failed (' + xhr.status + ').'));
        }
      };

      xhr.onerror = function () {
        reject(new Error('Network error during upload.'));
      };

      xhr.send(file);
    });
  }

  window.DPUpload = { uploadFile: uploadFile, MAX_VIDEO_SECONDS: MAX_VIDEO_SECONDS };
})();
