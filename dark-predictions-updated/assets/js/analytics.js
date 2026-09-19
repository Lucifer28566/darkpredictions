/* ============================================================
   analytics.js — Tracker maison léger, sans cookies tiers.

   Pour chaque page vue :
   - on enregistre la page, la date, un identifiant de session
     (généré aléatoirement, stocké en mémoire seulement — pas de
     cookie, pas de tracking cross-site)
   - on mesure le temps passé sur la page avant de la quitter
   - on récupère un pays/ville approximatif via une API publique
     de géolocalisation par IP (aucune donnée précise type GPS)

   Toutes les données sont écrites dans Firestore (collection
   "pageViews"), lisibles uniquement par le compte developer
   (voir firestore.rules).
   ============================================================ */
(function () {
  // Identifiant de session : un par onglet/navigation, en mémoire
  // (sessionStorage), jamais partagé entre appareils ni persistant
  // après fermeture du navigateur.

  // ── Engagement par utilisateur (membres connectés uniquement) ──
  // Compte 1 "visite" par session de navigation (pas par page vue), et met
  // à jour lastSeenAt + points. Stocké dans userStats/{uid} — lisible
  // uniquement par l'admin (voir firestore.rules).
  function trackUserVisit(db) {
    try {
      var auth = window.firebase && window.firebase.auth && window.firebase.auth();
      var user = auth && auth.currentUser;
      if (!user) return;
      if (window.sessionStorage && sessionStorage.getItem('dp_visit_counted')) return;
      var FV = window.firebase.firestore.FieldValue;
      db.collection('userStats').doc(user.uid).set({
        uid: user.uid,
        email: user.email || null,
        displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Member'),
        visits: FV.increment(1),
        points: FV.increment(1),
        lastSeenAt: new Date().toISOString()
      }, { merge: true }).then(function () {
        if (window.sessionStorage) sessionStorage.setItem('dp_visit_counted', '1');
      }).catch(function (e) { console.warn('userStats skipped:', e && e.code); });
    } catch (e) { /* jamais bloquant */ }
  }

  function getSessionId() {
    try {
      var id = sessionStorage.getItem('dp_sid');
      if (!id) {
        id = 'sid_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        sessionStorage.setItem('dp_sid', id);
      }
      return id;
    } catch (e) {
      return 'sid_' + Date.now();
    }
  }

  function deviceType() {
    var ua = navigator.userAgent || '';
    if (/Mobi|Android/i.test(ua)) return 'mobile';
    if (/Tablet|iPad/i.test(ua)) return 'tablet';
    return 'desktop';
  }

  // Géolocalisation approximative par IP (pays + ville), via un service
  // public gratuit. Aucune information précise (pas de GPS, pas
  // d'adresse) — juste pays/région, à but statistique uniquement.
  // Timeout court : ce service tiers ne doit jamais retarder l'écriture
  // du pageView ci-dessous, donc on l'abandonne au bout de 2s.
  function getApproxLocation() {
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve({ country: null, city: null }); }, 2000);
    });
    var lookup = fetch('https://ipapi.co/json/')
      .then(function (r) { return r.json(); })
      .then(function (d) {
        return { country: d.country_name || null, city: d.city || null };
      })
      .catch(function () { return { country: null, city: null }; });
    return Promise.race([lookup, timeout]);
  }

  async function initFirebaseIfNeeded() {
    return new Promise(function (resolve) {
      var checks = 0;
      var interval = setInterval(function () {
        checks++;
        if (window.firebase && window.firebase.firestore) {
          clearInterval(interval);
          try { firebase.app('[DEFAULT]'); } catch (e) {
            try {
              firebase.initializeApp({
                apiKey: "AIzaSyC5tRjOXYkTdS_i_mtTJIXWzT8oN5F-kes",
                authDomain: "darkpredictions-ec67b.firebaseapp.com",
                projectId: "darkpredictions-ec67b",
                storageBucket: "darkpredictions-ec67b.firebasestorage.app",
                messagingSenderId: "924305486581",
                appId: "1:924305486581:web:020753c201bf6d287b4bbc"
              });
            } catch (e2) {}
          }
          resolve();
        } else if (checks > 100) {
          clearInterval(interval);
          resolve();
        }
      }, 50);
    });
  }

  async function track() {
    // On ne suit pas l'admin lui-même pour ne pas fausser les stats.
    if (window.location.pathname.indexOf('/admin.html') !== -1) return;

    try {
      await initFirebaseIfNeeded();
      if (!window.firebase || !window.firebase.firestore) {
        console.warn('[analytics] Firebase not available — page view not recorded.');
        return;
      }
      var db = firebase.firestore();
      var sessionId = getSessionId();
      var startedAt = Date.now();
      var loc = await getApproxLocation();

      var docRef = await db.collection('pageViews').add({
        page: window.location.pathname,
        sessionId: sessionId,
        device: deviceType(),
        country: loc.country,
        city: loc.city,
        referrer: document.referrer || null,
        createdAt: new Date().toISOString(),
        durationSeconds: 0,
      });
      trackUserVisit(db); // fire-and-forget, ne bloque jamais l'écriture pageViews
      // Note : les compteurs séparés (analyticsMeta/analyticsDaily) ont
      // été retirés — la source de vérité unique est pageViews, compté
      // via count() côté admin. Un seul chiffre, jamais divergent.

      // À la fermeture / changement de page, on enregistre le temps passé.
      function sendDuration() {
        var seconds = Math.round((Date.now() - startedAt) / 1000);
        try {
          db.collection('pageViews').doc(docRef.id).update({ durationSeconds: seconds });
        } catch (e) {}
      }
      window.addEventListener('pagehide', sendDuration);
      window.addEventListener('beforeunload', sendDuration);
    } catch (err) {
      // Erreur visible en console (quota Firestore dépassé, règles, réseau…)
      // pour qu'on puisse diagnostiquer au lieu d'échouer en silence.
      console.warn('[analytics] page view failed:', err && err.message ? err.message : err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', track);
  } else {
    track();
  }
})();
