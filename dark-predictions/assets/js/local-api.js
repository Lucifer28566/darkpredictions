/* Dark Predictions — Firebase backend (Auth + Firestore) */

(function () {
  // ============================================================
  // FIREBASE CONFIG
  // ============================================================
  var FIREBASE_CONFIG = {
    apiKey:            "AIzaSyC5tRjOXYkTdS_i_mtTJIXWzT8oN5F-kes",
    authDomain:        "darkpredictions-ec67b.firebaseapp.com",
    projectId:         "darkpredictions-ec67b",
    storageBucket:     "darkpredictions-ec67b.firebasestorage.app",
    messagingSenderId: "924305486581",
    appId:             "1:924305486581:web:020753c201bf6d287b4bbc"
  };

  // ⚠️ À REMPLIR après le déploiement du Worker Cloudflare (voir
  // GUIDE-DEPLOIEMENT-CLOUDFLARE.md). Format attendu :
  // "https://dark-predictions-stripe.<ton-compte>.workers.dev"
  var CLOUD_FUNCTIONS_BASE = "https://dark-predictions-stripe.luciferonworld.workers.dev";

  var _initPromise = null;
  var _app = null;

  function initFirebase() {
    if (_initPromise) return _initPromise;
    _initPromise = new Promise(function (resolve, reject) {
      var checkCount = 0;
      var checkInterval = setInterval(function () {
        checkCount++;
        if (window.firebase && window.firebase.initializeApp) {
          clearInterval(checkInterval);
          try {
            _app = firebase.initializeApp(FIREBASE_CONFIG);
          } catch (e) {
            if (e.code === 'app/duplicate-app') { _app = firebase.app(); }
            else { throw e; }
          }
          // Force les messages d'erreur Firebase Auth (signup, login,
          // paiement, reset…) en anglais. Sans ça, ils sortent dans la
          // langue du navigateur — donc en français pour beaucoup de nos
          // visiteurs, ce qui ruine l'expérience d'un site anglophone.
          try { if (firebase.auth) firebase.auth().languageCode = 'en'; } catch (e) {}
          resolve();
        } else if (checkCount > 100) {
          clearInterval(checkInterval);
          reject(new Error('Firebase SDK failed to load'));
        }
      }, 50);
    });
    return _initPromise;
  }

  function getAuth() { return firebase.auth(); }
  function getDB() { return firebase.firestore(); }

  // ────────────────────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────────────────────
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var ROLES = ['free', 'trial', 'basic', 'gold', 'vip', 'developer'];
  // Predictions: now includes 'free' tier for free users
  var TIERS = ['free', 'basic', 'gold', 'vip'];

  function jsonRes(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ────────────────────────────────────────────────────────────
  // Cloudflare Worker media storage — best-effort delete.
  // Only attempts deletion for URLs that point at our own Worker
  // (external/legacy URLs, e.g. old Bunny/Firebase links, are left alone).
  // ────────────────────────────────────────────────────────────
  var MEDIA_WORKER_ORIGIN = 'https://curly-river-3102.luciferonworld.workers.dev';

  async function deleteFromWorkerStorage(url) {
    if (!url || typeof url !== 'string') return;
    if (url.indexOf(MEDIA_WORKER_ORIGIN) !== 0) return; // not one of ours, skip
    try {
      await fetch(url, { method: 'DELETE' });
    } catch (err) {
      console.warn('Could not delete media file from storage:', url, err);
      // Non-blocking: we still proceed with deleting the Firestore record.
    }
  }

  async function deleteMediaUrlsForDoc(data) {
    if (!data) return;
    var urls = [data.url, data.cover, data.coverUrl, data.imageUrl, data.videoUrl].filter(Boolean);
    await Promise.all(urls.map(deleteFromWorkerStorage));
  }

  function publicUser(u) {
    if (!u) return null;
    return { id: u.id, email: u.email, displayName: u.displayName, role: u.role, createdAt: u.createdAt, trialExpiresAt: u.trialExpiresAt || null };
  }

  function tsToISO(val) {
    if (!val) return new Date().toISOString();
    if (typeof val === 'string') return val;
    if (val.toDate) return val.toDate().toISOString();
    return new Date(val).toISOString();
  }

  async function requireDeveloper() {
    var auth = getAuth();
    var db = getDB();
    var user = auth.currentUser;
    if (!user) return { error: jsonRes({ error: 'Login required.' }, 401) };
    var snap = await db.collection('users').doc(user.uid).get();
    if (!snap.exists || snap.data().role !== 'developer') {
      return { error: jsonRes({ error: 'Access restricted to the developer account.' }, 403) };
    }
    return { user: user, data: snap.data() };
  }

  async function requireLoggedIn() {
    var auth = getAuth();
    var db = getDB();
    var user = auth.currentUser;
    if (!user) return { error: jsonRes({ error: 'Login required.' }, 401) };
    var snap = await db.collection('users').doc(user.uid).get();
    var data = snap.exists ? snap.data() : { role: 'free', email: user.email, displayName: user.email.split('@')[0] };
    return { user: user, data: data };
  }

  // ────────────────────────────────────────────────────────────
  // Auth
  // ────────────────────────────────────────────────────────────
  async function handleSignup(body) {
    try {
      await initFirebase();
      var auth = getAuth();
      var db = getDB();
      var email = String(body.email || '').trim().toLowerCase();
      var password = String(body.password || '');
      var displayName = String(body.displayName || email.split('@')[0]).trim().slice(0, 60);
      if (!EMAIL_RE.test(email)) return jsonRes({ error: 'Please enter a valid email address.' }, 400);
      if (password.length < 8) return jsonRes({ error: 'Password must be at least 8 characters long.' }, 400);
      var cred = await auth.createUserWithEmailAndPassword(email, password);
      var uid = cred.user.uid;
      if (displayName) {
        try { await cred.user.updateProfile({ displayName: displayName }); } catch (e) {}
      }
      // On crée le profil Firestore nous-mêmes, tout de suite, côté client.
      // (La Cloud Function onUserCreate, si elle est déployée, fera la même
      // chose en parallèle avec des droits admin — ça ne casse rien, le
      // document existe déjà. Mais on ne dépend plus uniquement d'elle :
      // si elle n'est pas déployée, le compte est tout de même comptabilisé
      // immédiatement.) Les règles de sécurité Firestore n'autorisent la
      // création que avec role === 'free', donc un client ne peut pas
      // s'auto-attribuer un rôle plus élevé via ce chemin.
      var userData = await ensureUserDoc(db, uid, email, displayName);
      return jsonRes({ user: publicUser(Object.assign({ id: uid }, userData)) }, 201);
    } catch (err) {
      console.error('Signup error:', err);
      if (err.code === 'auth/email-already-in-use') return jsonRes({ error: 'An account already exists with this email.' }, 409);
      if (err.code === 'auth/weak-password') return jsonRes({ error: 'Password is too weak — please use at least 8 characters.' }, 400);
      if (err.code === 'auth/invalid-email') return jsonRes({ error: 'Please enter a valid email address.' }, 400);
      // Quota Firestore/Firebase épuisé (fréquent sur le plan gratuit) :
      // on renvoie un message compréhensible plutôt qu'une erreur brute.
      if (err.code === 'resource-exhausted' || (err.message && err.message.indexOf('RESOURCE_EXHAUSTED') !== -1)) {
        return jsonRes({ error: 'We are experiencing very high traffic right now. Please try again in a little while.' }, 503);
      }
      return jsonRes({ error: err.message || 'Signup failed.' }, 400);
    }
  }

  // Crée le document users/{uid} immédiatement après l'inscription, si la
  // Cloud Function onUserCreate ne l'a pas déjà fait. On boucle d'abord
  // quelques fois (très court) au cas où la fonction est en train de
  // s'exécuter en parallèle, pour éviter une double écriture inutile ;
  // si rien n'apparaît, on le crée nous-mêmes côté client.
  async function ensureUserDoc(db, uid, fallbackEmail, fallbackName) {
    for (var i = 0; i < 3; i++) {
      var snap = await db.collection('users').doc(uid).get();
      if (snap.exists) return snap.data();
      await new Promise(function (resolve) { setTimeout(resolve, 250); });
    }
    var newUser = {
      email: fallbackEmail,
      displayName: fallbackName,
      role: 'free',
      createdAt: new Date().toISOString(),
    };
    try {
      await db.collection('users').doc(uid).set(newUser);
    } catch (e) {
      // Si une autre écriture (Cloud Function) est passée juste entre les
      // deux, on relit le document final plutôt que d'échouer.
      console.warn('ensureUserDoc: create failed, re-reading doc:', e);
      var finalSnap = await db.collection('users').doc(uid).get();
      if (finalSnap.exists) return finalSnap.data();
      throw e;
    }
    return newUser;
  }

  async function handleLogin(body) {
    try {
      await initFirebase();
      var auth = getAuth();
      var db = getDB();
      var email = String(body.email || '').trim().toLowerCase();
      var password = String(body.password || '');
      if (!email || !password) return jsonRes({ error: 'Email and password are required.' }, 400);
      var cred = await auth.signInWithEmailAndPassword(email, password);
      var uid = cred.user.uid;
      var snap = await db.collection('users').doc(uid).get();
      var userData;
      if (snap.exists) {
        userData = snap.data();
      } else {
        // Compte Auth créé avant ce correctif (ou pendant que la Cloud
        // Function onUserCreate n'était pas déployée) : son profil
        // Firestore n'existe pas encore. On le crée maintenant, au
        // premier login, pour qu'il apparaisse dans le compteur admin.
        userData = {
          email: email,
          displayName: (cred.user.displayName || email.split('@')[0]),
          role: 'free',
          createdAt: new Date().toISOString(),
        };
        try { await db.collection('users').doc(uid).set(userData); } catch (e) { console.warn('Could not backfill user doc on login:', e); }
      }
      return jsonRes({ user: publicUser(Object.assign({ id: uid }, userData)) }, 200);
    } catch (err) {
      console.error('Login error:', err);
      return jsonRes({ error: 'Incorrect email or password.' }, 401);
    }
  }

  async function handleLogout() {
    try { await initFirebase(); await getAuth().signOut(); } catch (e) {}
    return jsonRes({ ok: true }, 200);
  }

  async function handleMe() {
    try {
      await initFirebase();
      var auth = getAuth();
      var db = getDB();
      return new Promise(function (resolve) {
        var unsub = auth.onAuthStateChanged(async function (user) {
          unsub();
          if (!user) return resolve(jsonRes({ user: null }, 200));
          try {
            var snap = await db.collection('users').doc(user.uid).get();
            var userData = snap.exists ? snap.data() : {
              email: user.email,
              displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Member'),
              role: 'free',
              createdAt: new Date().toISOString()
            };
            // Trial expiré → rétrogradation automatique en 'free'.
            if (userData.role === 'trial' && userData.trialExpiresAt && new Date(userData.trialExpiresAt) < new Date()) {
              userData.role = 'free';
              try { await db.collection('users').doc(user.uid).update({ role: 'free' }); } catch (e) {}
            }
            resolve(jsonRes({ user: publicUser(Object.assign({ id: user.uid }, userData)) }, 200));
          } catch (e) {
            console.error('Me error (Firestore fallback):', e);
            resolve(jsonRes({ user: publicUser({
              id: user.uid,
              email: user.email,
              displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'User'),
              role: 'free',
              createdAt: new Date().toISOString(),
            }) }, 200));
          }
        });
      });
    } catch (err) {
      console.error('Me error:', err);
      return jsonRes({ user: null }, 200);
    }
  }

  async function handleForgotPassword(body) {
    try {
      await initFirebase();
      var auth = getAuth();
      var email = String(body.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(email)) return jsonRes({ error: 'Please enter a valid email address.' }, 400);
      // Redirige vers notre propre page (au style du site) plutôt que la
      // page générique hébergée par Firebase. Ce domaine doit être ajouté
      // dans Firebase Console → Authentication → Settings → Authorized
      // domains, sinon Firebase renverra une erreur "domain not authorized".
      var actionCodeSettings = {
        url: window.location.origin + '/reset-password.html',
        handleCodeInApp: false,
      };
      try {
        await auth.sendPasswordResetEmail(email, actionCodeSettings);
      } catch (err) {
        // On ne révèle jamais si l'email existe ou non côté client — ça
        // éviterait à quelqu'un de mal intentionné de vérifier quels emails
        // ont un compte. 'auth/user-not-found' est donc traité en silence,
        // comme un succès, comme le fait la plupart des sites.
        if (err.code !== 'auth/user-not-found') {
          console.error('Forgot password error:', err);
        }
      }
      return jsonRes({ ok: true, message: 'If an account exists for this email, a reset link has been sent.' }, 200);
    } catch (err) {
      console.error('Forgot password error (outer):', err);
      return jsonRes({ ok: true, message: 'If an account exists for this email, a reset link has been sent.' }, 200);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Users
  // ────────────────────────────────────────────────────────────
  async function handleUsersList() {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      // On ne fait PAS de orderBy('createdAt') côté Firestore : les comptes
      // créés sans ce champ (anciens comptes "fantômes", bugs antérieurs)
      // seraient silencieusement exclus des résultats par Firestore. On
      // récupère TOUS les documents et on trie ensuite côté JS, en mettant
      // les comptes sans date à la fin plutôt que de les faire disparaître.
      var usersSnap = await db.collection('users').limit(10000).get();
      var users = [];
      usersSnap.forEach(function (d) { users.push(publicUser(Object.assign({ id: d.id }, d.data()))); });
      users.sort(function (a, b) {
        if (!a.createdAt && !b.createdAt) return 0;
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return a.createdAt < b.createdAt ? 1 : -1;
      });
      return jsonRes({ users: users, totalCount: users.length }, 200);
    } catch (err) {
      console.error('List users error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleUserPatch(id, body) {
    try {
      await initFirebase();
      var auth = getAuth();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var role = body.role;
      if (ROLES.indexOf(role) === -1) return jsonRes({ error: 'Invalid role.' }, 400);
      if (id === dev.user.uid) return jsonRes({ error: "You can't change your own role." }, 400);
      var idToken = await auth.currentUser.getIdToken();
      var resp = await realFetch(CLOUD_FUNCTIONS_BASE + '/adminSetUserRole', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ targetUid: id, role: role }),
      });
      var data = await resp.json();
      if (!resp.ok) return jsonRes({ error: data.error || 'Could not update role.' }, resp.status);
      // Trial : on pose la date d'expiration (30 jours) directement dans le
      // profil Firestore. À l'expiration, handleMe() rétrograde en 'free'.
      try {
        var db2 = getDB();
        if (role === 'trial') {
          var expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          await db2.collection('users').doc(id).update({ trialExpiresAt: expires });
        } else {
          await db2.collection('users').doc(id).update({ trialExpiresAt: firebase.firestore.FieldValue.delete() });
        }
      } catch (e) { console.warn('trialExpiresAt update skipped:', e); }
      return jsonRes({ user: { id: id, role: role } }, 200);
    } catch (err) {
      console.error('Patch user error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleUserDelete(id) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      if (id === dev.user.uid) return jsonRes({ error: "You can't delete your own account." }, 400);
      var targetSnap = await db.collection('users').doc(id).get();
      if (!targetSnap.exists) return jsonRes({ error: 'User not found.' }, 404);
      await db.collection('users').doc(id).delete();
      return jsonRes({ ok: true }, 200);
    } catch (err) {
      console.error('Delete user error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Predictions
  // ────────────────────────────────────────────────────────────
  async function handlePredictionsGet() {
    try {
      await initFirebase();
      var db = getDB();
      // No orderBy() on Firestore here: if one doc has a missing or
      // malformed createdAt, orderBy() fails the WHOLE query (empty
      // list, nothing to show — and depending on which docs load
      // first from cache, the feed can appear to flip order). We
      // fetch everything and sort ourselves instead, newest first.
      var snap = await db.collection('predictions').get();
      var list = [];
      snap.forEach(function (d) {
        list.push(Object.assign({ id: d.id }, d.data(), { createdAt: tsToISO(d.data().createdAt) }));
      });
      list.sort(function (a, b) {
        var ta = +new Date(a.createdAt || 0);
        var tb = +new Date(b.createdAt || 0);
        return (isFinite(tb) ? tb : 0) - (isFinite(ta) ? ta : 0);
      });
      return jsonRes({ predictions: list }, 200);
    } catch (err) {
      console.error('Get predictions error:', err);
      return jsonRes({ predictions: [] }, 200);
    }
  }

  async function handlePredictionsCreate(body) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var league = String(body.league || '').trim().slice(0, 40);
      var timeLabel = String(body.timeLabel || '').trim().slice(0, 40);
      var title = String(body.title || '').trim().slice(0, 120);
      var pick = String(body.pick || '').trim().slice(0, 2000);
      var imageUrl = String(body.imageUrl || '').trim().slice(0, 500);
      var videoUrl = String(body.videoUrl || '').trim().slice(0, 500);
      var confidence = String(body.confidence || '').trim().slice(0, 40);
      var tier = TIERS.indexOf(body.tier) !== -1 ? body.tier : 'gold';
      if (!league || !title || !pick) return jsonRes({ error: 'Category, title and prediction are required.' }, 400);
      var prediction = {
        league: league, timeLabel: timeLabel, title: title, pick: pick,
        imageUrl: imageUrl, videoUrl: videoUrl,
        confidence: confidence, tier: tier,
        createdAt: new Date().toISOString(), createdBy: dev.data.displayName,
      };
      var ref = await db.collection('predictions').add(prediction);
      return jsonRes({ prediction: Object.assign({ id: ref.id }, prediction) }, 201);
    } catch (err) {
      console.error('Create prediction error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handlePredictionUpdate(id, body) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var predSnap = await db.collection('predictions').doc(id).get();
      if (!predSnap.exists) return jsonRes({ error: 'Prediction not found.' }, 404);
      var updates = {};
      if (body.league !== undefined) updates.league = String(body.league).trim().slice(0, 40);
      if (body.timeLabel !== undefined) updates.timeLabel = String(body.timeLabel).trim().slice(0, 40);
      if (body.title !== undefined) updates.title = String(body.title).trim().slice(0, 120);
      if (body.pick !== undefined) updates.pick = String(body.pick).trim().slice(0, 2000);
      if (body.imageUrl !== undefined) updates.imageUrl = String(body.imageUrl).trim().slice(0, 500);
      if (body.videoUrl !== undefined) updates.videoUrl = String(body.videoUrl).trim().slice(0, 500);
      if (body.confidence !== undefined) updates.confidence = String(body.confidence).trim().slice(0, 40);
      if (TIERS.indexOf(body.tier) !== -1) updates.tier = body.tier;
      await db.collection('predictions').doc(id).update(updates);
      return jsonRes({ prediction: Object.assign({ id: id }, predSnap.data(), updates, { createdAt: tsToISO(predSnap.data().createdAt) }) }, 200);
    } catch (err) {
      console.error('Update prediction error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handlePredictionDelete(id) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var predSnap = await db.collection('predictions').doc(id).get();
      if (!predSnap.exists) return jsonRes({ error: 'Prediction not found.' }, 404);
      await deleteMediaUrlsForDoc(predSnap.data());
      await db.collection('predictions').doc(id).delete();
      return jsonRes({ ok: true }, 200);
    } catch (err) {
      console.error('Delete prediction error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Albums (music) — named folders that tracks can be assigned to
  // ────────────────────────────────────────────────────────────
  async function handleAlbumsList() {
    try {
      await initFirebase();
      var db = getDB();
      var snap = await db.collection('albums').get();
      var list = [];
      snap.forEach(function (d) {
        list.push(Object.assign({ id: d.id }, d.data(), { createdAt: tsToISO(d.data().createdAt) }));
      });
      list.sort(function (a, b) {
        var ta = +new Date(a.createdAt || 0);
        var tb = +new Date(b.createdAt || 0);
        return (isFinite(ta) ? ta : 0) - (isFinite(tb) ? tb : 0);
      });
      return jsonRes({ items: list }, 200);
    } catch (err) {
      console.error('Get albums error:', err);
      return jsonRes({ items: [] }, 200);
    }
  }

  async function handleAlbumCreate(body) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var name = String(body.name || '').trim().slice(0, 120);
      if (!name) return jsonRes({ error: 'Album name is required.' }, 400);
      var item = { name: name, createdAt: new Date().toISOString(), createdBy: dev.data.displayName };
      var ref = await db.collection('albums').add(item);
      return jsonRes({ item: Object.assign({ id: ref.id }, item) }, 201);
    } catch (err) {
      console.error('Create album error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleAlbumUpdate(id, body) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var docSnap = await db.collection('albums').doc(id).get();
      if (!docSnap.exists) return jsonRes({ error: 'Album not found.' }, 404);
      var updates = {};
      if (body.name !== undefined) {
        var name = String(body.name).trim().slice(0, 120);
        if (!name) return jsonRes({ error: 'Album name is required.' }, 400);
        updates.name = name;
      }
      await db.collection('albums').doc(id).update(updates);
      return jsonRes({ item: Object.assign({ id: id }, docSnap.data(), updates, { createdAt: tsToISO(docSnap.data().createdAt) }) }, 200);
    } catch (err) {
      console.error('Update album error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleAlbumDelete(id) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      // Unassign the album from any tracks that belonged to it —
      // deleting an album should never delete the songs in it.
      var tracksSnap = await db.collection('music').where('albumId', '==', id).get();
      var batch = db.batch();
      tracksSnap.forEach(function (d) {
        batch.update(d.ref, { albumId: '', album: '' });
      });
      await batch.commit();
      await db.collection('albums').doc(id).delete();
      return jsonRes({ ok: true }, 200);
    } catch (err) {
      console.error('Delete album error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // Assign a checked set of tracks to an album in one go (or clear
  // the album from a track by passing albumId: '').
  async function handleAlbumAssign(body) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var albumId = String(body.albumId || '').trim();
      var trackIds = Array.isArray(body.trackIds) ? body.trackIds : [];
      if (!trackIds.length) return jsonRes({ error: 'No tracks selected.' }, 400);

      var albumName = '';
      if (albumId) {
        var albumSnap = await db.collection('albums').doc(albumId).get();
        if (!albumSnap.exists) return jsonRes({ error: 'Album not found.' }, 404);
        albumName = albumSnap.data().name || '';
      }

      var batch = db.batch();
      trackIds.forEach(function (tid) {
        batch.update(db.collection('music').doc(String(tid)), { albumId: albumId, album: albumName });
      });
      await batch.commit();
      return jsonRes({ ok: true, albumId: albumId, album: albumName, count: trackIds.length }, 200);
    } catch (err) {
      console.error('Assign album error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Generic content (music / apps / paintings)
  // ────────────────────────────────────────────────────────────
  function contentLimits(kind) {
    return {
      title: 120,
      album: 120,
      albumId: 200,
      tag: 40,
      description: 800,
      url: 500,
      cover: 500
    };
  }

  function validKind(kind) {
    return ['music', 'apps', 'paintings', 'correctpredictions', 'socials', 'pricelist'].indexOf(kind) !== -1;
  }

  // Certains kinds sont publics : lisibles sans être connecté, pour servir
  // de preuve sociale et convertir les visiteurs (ex: vidéos de prédictions
  // réussies). Seul l'admin peut créer/modifier/supprimer, comme le reste.
  function isPublicKind(kind) {
    return ['correctpredictions', 'socials', 'pricelist'].indexOf(kind) !== -1;
  }

  async function handleContentList(kind) {
    if (!validKind(kind)) return jsonRes({ error: 'Unknown content type.' }, 400);
    try {
      await initFirebase();
      var db = getDB();
      // On ne fait plus orderBy() côté Firestore : si un document a un
      // createdAt manquant ou dans un format inattendu, orderBy() fait
      // planter TOUTE la requête (liste vide silencieuse, donc rien à
      // écouter). On récupère tout puis on trie nous-mêmes en JS.
      var snap = await db.collection(kind).get();
      var list = [];
      snap.forEach(function (d) {
        list.push(Object.assign({ id: d.id }, d.data(), { createdAt: tsToISO(d.data().createdAt) }));
      });
      list.sort(function (a, b) {
        var ta = +new Date(a.createdAt || 0);
        var tb = +new Date(b.createdAt || 0);
        return (isFinite(tb) ? tb : 0) - (isFinite(ta) ? ta : 0);
      });
      return jsonRes({ items: list }, 200);
    } catch (err) {
      console.error('Get content error:', err);
      return jsonRes({ items: [] }, 200);
    }
  }

  async function handleContentCreate(kind, body) {
    if (!validKind(kind)) return jsonRes({ error: 'Unknown content type.' }, 400);
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var lim = contentLimits(kind);
      var title = String(body.title || '').trim().slice(0, lim.title);
      var album = String(body.album || '').trim().slice(0, lim.album);
      var albumId = String(body.albumId || '').trim().slice(0, lim.albumId);
      var tag = String(body.tag || '').trim().slice(0, lim.tag);
      var description = String(body.description || '').trim().slice(0, lim.description);
      var url = String(body.url || '').trim().slice(0, lim.url);
      var cover = String(body.cover || '').trim().slice(0, lim.cover);
      if (!title || !url) return jsonRes({ error: 'Title and URL are required.' }, 400);
      var item = {
        title: title, album: album, albumId: albumId, tag: tag, description: description,
        url: url, cover: cover,
        createdAt: new Date().toISOString(), createdBy: dev.data.displayName,
      };
      var ref = await db.collection(kind).add(item);
      return jsonRes({ item: Object.assign({ id: ref.id }, item) }, 201);
    } catch (err) {
      console.error('Create content error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleContentUpdate(kind, id, body) {
    if (!validKind(kind)) return jsonRes({ error: 'Unknown content type.' }, 400);
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var docSnap = await db.collection(kind).doc(id).get();
      if (!docSnap.exists) return jsonRes({ error: 'Item not found.' }, 404);
      var lim = contentLimits(kind);
      var updates = {};
      if (body.title !== undefined) updates.title = String(body.title).trim().slice(0, lim.title);
      if (body.album !== undefined) updates.album = String(body.album).trim().slice(0, lim.album);
      if (body.albumId !== undefined) updates.albumId = String(body.albumId).trim().slice(0, lim.albumId);
      if (body.tag !== undefined) updates.tag = String(body.tag).trim().slice(0, lim.tag);
      if (body.description !== undefined) updates.description = String(body.description).trim().slice(0, lim.description);
      if (body.url !== undefined) updates.url = String(body.url).trim().slice(0, lim.url);
      if (body.cover !== undefined) updates.cover = String(body.cover).trim().slice(0, lim.cover);
      await db.collection(kind).doc(id).update(updates);
      return jsonRes({ item: Object.assign({ id: id }, docSnap.data(), updates, { createdAt: tsToISO(docSnap.data().createdAt) }) }, 200);
    } catch (err) {
      console.error('Update content error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ── Thank you sur une prédiction ─────────────────────────────
  // Un utilisateur connecté peut remercier une prédiction UNE fois.
  // Déduplication via un doc thanks/{predId_uid}; compteur thanksCount
  // maintenu sur la prédiction elle-même (une lecture pour l'afficher).
  async function handleThanks(predId) {
    try {
      await initFirebase();
      var db = getDB();
      var logged = await requireLoggedIn();
      if (logged.error) return logged.error;
      var uid = logged.user.uid;
      var thanksId = predId + '_' + uid;
      var existing = await db.collection('thanks').doc(thanksId).get();
      if (existing.exists) return jsonRes({ ok: true, already: true }, 200);
      var predRef = db.collection('predictions').doc(predId);
      var predSnap = await predRef.get();
      if (!predSnap.exists) return jsonRes({ error: 'Prediction not found.' }, 404);
      await db.collection('thanks').doc(thanksId).set({
        predId: predId, uid: uid, createdAt: new Date().toISOString(),
      });
      var newCount = (predSnap.data().thanksCount || 0) + 1;
      await predRef.update({ thanksCount: newCount });
      return jsonRes({ ok: true, thanksCount: newCount }, 200);
    } catch (err) {
      console.error('Thanks error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleContentDelete(kind, id) {
    if (!validKind(kind)) return jsonRes({ error: 'Unknown content type.' }, 400);
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var docSnap = await db.collection(kind).doc(id).get();
      if (!docSnap.exists) return jsonRes({ error: 'Item not found.' }, 404);
      await deleteMediaUrlsForDoc(docSnap.data());
      await db.collection(kind).doc(id).delete();
      return jsonRes({ ok: true }, 200);
    } catch (err) {
      console.error('Delete content error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // VIP Messages
  // ────────────────────────────────────────────────────────────
  async function handleMessageCreate(body) {
    try {
      await initFirebase();
      var db = getDB();
      var session = await requireLoggedIn();
      if (session.error) return session.error;
      if (session.data.role !== 'vip' && session.data.role !== 'developer') {
        return jsonRes({ error: 'VIP membership required to send private messages.' }, 403);
      }
      var subject = String(body.subject || '').trim().slice(0, 120);
      var content = String(body.body || '').trim().slice(0, 4000);
      if (!content) return jsonRes({ error: 'Message cannot be empty.' }, 400);
      var msg = {
        fromUid: session.user.uid,
        fromName: session.data.displayName || session.user.email,
        fromEmail: session.data.email || session.user.email,
        subject: subject,
        body: content,
        createdAt: new Date().toISOString(),
      };
      var ref = await db.collection('messages').add(msg);
      return jsonRes({ message: Object.assign({ id: ref.id }, msg) }, 201);
    } catch (err) {
      console.error('Create message error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleMessageList() {
    try {
      await initFirebase();
      var db = getDB();
      var session = await requireLoggedIn();
      if (session.error) return session.error;
      // Developer sees all; VIP sees only their own.
      var query;
      if (session.data.role === 'developer') {
        query = db.collection('messages').orderBy('createdAt', 'desc');
      } else if (session.data.role === 'vip') {
        query = db.collection('messages').where('fromUid', '==', session.user.uid);
      } else {
        return jsonRes({ error: 'Access restricted.' }, 403);
      }
      var snap = await query.get();
      var list = [];
      snap.forEach(function (d) {
        list.push(Object.assign({ id: d.id }, d.data(), { createdAt: tsToISO(d.data().createdAt) }));
      });
      // Sort defensively in case the where-query didn't preserve order.
      list.sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
      return jsonRes({ messages: list }, 200);
    } catch (err) {
      console.error('List messages error:', err);
      return jsonRes({ messages: [] }, 200);
    }
  }

  async function handleMessageDelete(id) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var docSnap = await db.collection('messages').doc(id).get();
      if (!docSnap.exists) return jsonRes({ error: 'Message not found.' }, 404);
      await db.collection('messages').doc(id).delete();
      return jsonRes({ ok: true }, 200);
    } catch (err) {
      console.error('Delete message error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // The Wall — public comments / reviews / suggestions.
  // Reading is open to everyone (including signed-out visitors).
  // Posting requires role basic/gold/vip/developer (paid tier).
  // Editing/deleting a post is admin-only (moderation).
  // ────────────────────────────────────────────────────────────
  var WALL_POST_ROLES = ['basic', 'gold', 'vip', 'developer'];
  var WALL_TYPES = ['Comment', 'Review', 'Suggestion'];

  async function handleWallList() {
    try {
      await initFirebase();
      var db = getDB();
      // No orderBy() for the same reason as elsewhere in this file: one
      // doc with a malformed createdAt would fail the whole query. Fetch
      // all, sort newest-first in JS.
      var snap = await db.collection('wallPosts').get();
      var list = [];
      snap.forEach(function (d) {
        var data = d.data();
        list.push({
          id: d.id,
          authorName: data.authorName,
          authorUid: data.authorUid,
          type: WALL_TYPES.indexOf(data.type) !== -1 ? data.type : 'Comment',
          body: data.body,
          createdAt: tsToISO(data.createdAt),
          editedByAdmin: !!data.editedByAdmin,
        });
      });
      list.sort(function (a, b) {
        var ta = +new Date(a.createdAt || 0);
        var tb = +new Date(b.createdAt || 0);
        return (isFinite(tb) ? tb : 0) - (isFinite(ta) ? ta : 0);
      });
      return jsonRes({ posts: list }, 200);
    } catch (err) {
      console.error('List wall posts error:', err);
      return jsonRes({ posts: [] }, 200);
    }
  }

  async function handleWallCreate(body) {
    try {
      await initFirebase();
      var db = getDB();
      var session = await requireLoggedIn();
      if (session.error) return session.error;
      if (WALL_POST_ROLES.indexOf(session.data.role) === -1) {
        return jsonRes({ error: 'Posting on the Wall requires a Basic, Gold or VIP account.' }, 403);
      }
      var type = WALL_TYPES.indexOf(body.type) !== -1 ? body.type : 'Comment';
      var text = String(body.body || '').trim().slice(0, 2000);
      if (!text) return jsonRes({ error: 'Post cannot be empty.' }, 400);
      var post = {
        authorUid: session.user.uid,
        authorName: session.data.displayName || session.user.email,
        type: type,
        body: text,
        createdAt: new Date().toISOString(),
      };
      var ref = await db.collection('wallPosts').add(post);
      return jsonRes({ post: Object.assign({ id: ref.id }, post) }, 201);
    } catch (err) {
      console.error('Create wall post error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleWallUpdate(id, body) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var docSnap = await db.collection('wallPosts').doc(id).get();
      if (!docSnap.exists) return jsonRes({ error: 'Post not found.' }, 404);
      var updates = { editedByAdmin: true };
      if (body.body !== undefined) updates.body = String(body.body).trim().slice(0, 2000);
      if (WALL_TYPES.indexOf(body.type) !== -1) updates.type = body.type;
      await db.collection('wallPosts').doc(id).update(updates);
      return jsonRes({ post: Object.assign({ id: id }, docSnap.data(), updates, { createdAt: tsToISO(docSnap.data().createdAt) }) }, 200);
    } catch (err) {
      console.error('Update wall post error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleWallDelete(id) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var docSnap = await db.collection('wallPosts').doc(id).get();
      if (!docSnap.exists) return jsonRes({ error: 'Post not found.' }, 404);
      await db.collection('wallPosts').doc(id).delete();
      return jsonRes({ ok: true }, 200);
    } catch (err) {
      console.error('Delete wall post error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // VIP Conversations — threaded chat between each VIP and admin
  // Collection: vipConversations, doc id = userId
  // Schema: { userId, userName, userEmail, messages: [{from,body,createdAt}],
  //           lastUpdated, unreadByAdmin, unreadByUser }
  // ────────────────────────────────────────────────────────────

  async function appendMessageToConversation(userId, userMeta, msgEntry, who) {
    var db = getDB();
    var ref = db.collection('vipConversations').doc(userId);
    var snap = await ref.get();
    var now = new Date().toISOString();
    if (snap.exists) {
      var data = snap.data();
      var messages = Array.isArray(data.messages) ? data.messages : [];
      messages.push(msgEntry);
      var updates = {
        messages: messages,
        lastUpdated: now,
      };
      if (who === 'user') updates.unreadByAdmin = (data.unreadByAdmin || 0) + 1;
      if (who === 'admin') updates.unreadByUser = (data.unreadByUser || 0) + 1;
      if (userMeta) {
        updates.userName = userMeta.userName || data.userName;
        updates.userEmail = userMeta.userEmail || data.userEmail;
      }
      await ref.update(updates);
    } else {
      await ref.set({
        userId: userId,
        userName: (userMeta && userMeta.userName) || '',
        userEmail: (userMeta && userMeta.userEmail) || '',
        messages: [msgEntry],
        lastUpdated: now,
        unreadByAdmin: who === 'user' ? 1 : 0,
        unreadByUser: who === 'admin' ? 1 : 0,
      });
    }
  }

  // POST /api/vip/conversation  body = { body: "..." }   (VIP-only)
  async function handleVipConversationPost(body) {
    try {
      await initFirebase();
      var session = await requireLoggedIn();
      if (session.error) return session.error;
      if (session.data.role !== 'vip' && session.data.role !== 'developer') {
        return jsonRes({ error: 'VIP membership required.' }, 403);
      }
      var content = String(body.body || '').trim().slice(0, 4000);
      if (!content) return jsonRes({ error: 'Message cannot be empty.' }, 400);
      var entry = { from: 'user', body: content, createdAt: new Date().toISOString() };
      await appendMessageToConversation(session.user.uid, {
        userName: session.data.displayName || session.user.email,
        userEmail: session.data.email || session.user.email,
      }, entry, 'user');
      return jsonRes({ ok: true, message: entry }, 201);
    } catch (err) {
      console.error('VIP conversation post error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // GET /api/vip/conversation   (VIP gets their own conversation)
  async function handleVipConversationGet() {
    try {
      await initFirebase();
      var db = getDB();
      var session = await requireLoggedIn();
      if (session.error) return session.error;
      if (session.data.role !== 'vip' && session.data.role !== 'developer') {
        return jsonRes({ error: 'VIP membership required.' }, 403);
      }
      var ref = db.collection('vipConversations').doc(session.user.uid);
      var snap = await ref.get();
      if (!snap.exists) return jsonRes({ messages: [], unreadByUser: 0 }, 200);
      var data = snap.data();
      // Mark as read for the user
      if (data.unreadByUser && data.unreadByUser > 0) {
        await ref.update({ unreadByUser: 0 });
      }
      return jsonRes({
        messages: Array.isArray(data.messages) ? data.messages : [],
        lastUpdated: data.lastUpdated || null,
        unreadByUser: 0,
      }, 200);
    } catch (err) {
      console.error('VIP conversation get error:', err);
      return jsonRes({ messages: [] }, 200);
    }
  }

  // GET /api/admin/vip/conversations  (admin sees all conversations summary)
  async function handleAdminConversationsList() {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var snap = await db.collection('vipConversations').orderBy('lastUpdated', 'desc').get();
      var list = [];
      snap.forEach(function (d) {
        var data = d.data();
        var messages = Array.isArray(data.messages) ? data.messages : [];
        var last = messages.length ? messages[messages.length - 1] : null;
        list.push({
          userId: data.userId,
          userName: data.userName || '',
          userEmail: data.userEmail || '',
          lastUpdated: data.lastUpdated || null,
          lastMessage: last ? last.body.slice(0, 80) : '',
          lastFrom: last ? last.from : null,
          unreadByAdmin: data.unreadByAdmin || 0,
          messageCount: messages.length,
        });
      });

      // Attach each sender's current plan so the inbox can be sorted by
      // profile (VIP members first, then Gold, then Basic), most recent
      // conversation first within each tier.
      var ROLE_RANK = { vip: 0, gold: 1, basic: 2, free: 3, developer: 4 };
      await Promise.all(list.map(async function (c) {
        try {
          var uSnap = await db.collection('users').doc(c.userId).get();
          c.userRole = uSnap.exists ? (uSnap.data().role || 'free') : 'free';
        } catch (e) {
          c.userRole = 'free';
        }
      }));
      list.sort(function (a, b) {
        var ra = ROLE_RANK.hasOwnProperty(a.userRole) ? ROLE_RANK[a.userRole] : 99;
        var rb = ROLE_RANK.hasOwnProperty(b.userRole) ? ROLE_RANK[b.userRole] : 99;
        if (ra !== rb) return ra - rb;
        var ta = a.lastUpdated ? +new Date(a.lastUpdated) : 0;
        var tb = b.lastUpdated ? +new Date(b.lastUpdated) : 0;
        return tb - ta;
      });

      return jsonRes({ conversations: list }, 200);
    } catch (err) {
      console.error('Admin conversations list error:', err);
      return jsonRes({ conversations: [] }, 200);
    }
  }

  // GET /api/admin/vip/conversation/:userId  (admin opens one thread)
  async function handleAdminConversationGet(userId) {
    try {
      await initFirebase();
      var db = getDB();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var ref = db.collection('vipConversations').doc(userId);
      var snap = await ref.get();
      if (!snap.exists) return jsonRes({ error: 'Conversation not found.' }, 404);
      var data = snap.data();
      // Mark as read for the admin
      if (data.unreadByAdmin && data.unreadByAdmin > 0) {
        await ref.update({ unreadByAdmin: 0 });
      }
      return jsonRes({
        userId: data.userId,
        userName: data.userName || '',
        userEmail: data.userEmail || '',
        messages: Array.isArray(data.messages) ? data.messages : [],
        lastUpdated: data.lastUpdated || null,
      }, 200);
    } catch (err) {
      console.error('Admin conversation get error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // POST /api/admin/vip/conversation/:userId  body = { body: "..." }   (admin reply)
  async function handleAdminConversationReply(userId, body) {
    try {
      await initFirebase();
      var dev = await requireDeveloper();
      if (dev.error) return dev.error;
      var content = String(body.body || '').trim().slice(0, 4000);
      if (!content) return jsonRes({ error: 'Reply cannot be empty.' }, 400);
      var entry = { from: 'admin', body: content, createdAt: new Date().toISOString() };
      await appendMessageToConversation(userId, null, entry, 'admin');
      return jsonRes({ ok: true, message: entry }, 201);
    } catch (err) {
      console.error('Admin conversation reply error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Checkout Stripe (lié au compte connecté)
  // ────────────────────────────────────────────────────────────
  async function handleCreateCheckout(body) {
    try {
      await initFirebase();
      var auth = getAuth();
      var user = auth.currentUser;
      if (!user) return jsonRes({ error: 'Log in or create an account before subscribing.' }, 401);
      var idToken = await user.getIdToken();
      var resp = await realFetch(CLOUD_FUNCTIONS_BASE + '/createCheckoutSession', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({
          priceId: body.priceId,
          successUrl: window.location.origin + '/pricing.html?checkout=success',
          cancelUrl: window.location.origin + '/pricing.html?checkout=cancelled',
        }),
      });
      var data = await resp.json();
      if (!resp.ok) return jsonRes({ error: data.error || 'Could not start the payment.' }, resp.status);
      return jsonRes({ url: data.url }, 200);
    } catch (err) {
      console.error('Create checkout error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  async function handleBillingPortal(body) {
    try {
      await initFirebase();
      var auth = getAuth();
      var user = auth.currentUser;
      if (!user) return jsonRes({ error: 'Log in to manage your subscription.' }, 401);
      var idToken = await user.getIdToken();
      var resp = await realFetch(CLOUD_FUNCTIONS_BASE + '/createBillingPortalSession', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
        body: JSON.stringify({ returnUrl: window.location.origin + '/pricing.html' }),
      });
      var data = await resp.json();
      if (!resp.ok) return jsonRes({ error: data.error || 'Could not open the billing portal.' }, resp.status);
      return jsonRes({ url: data.url }, 200);
    } catch (err) {
      console.error('Billing portal error:', err);
      return jsonRes({ error: err.message }, 500);
    }
  }

  // ────────────────────────────────────────────────────────────
  // Fetch interceptor
  // ────────────────────────────────────────────────────────────
  var realFetch = window.fetch ? window.fetch.bind(window) : null;

  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    var path = url.replace(/^https?:\/\/[^/]+/, '');
    init = init || {};
    var method = (init.method || 'GET').toUpperCase();
    var body = {};
    if (init.body) { try { body = JSON.parse(init.body); } catch (e) {} }

    // Auth
    if (path === '/api/auth/signup' && method === 'POST') return handleSignup(body);
    if (path === '/api/auth/login' && method === 'POST') return handleLogin(body);
    if (path === '/api/auth/logout' && method === 'POST') return handleLogout();
    if (path === '/api/auth/me' && method === 'GET') return handleMe();
    if (path === '/api/auth/forgot-password' && method === 'POST') return handleForgotPassword(body);

    // Users
    if (path === '/api/users' && method === 'GET') return handleUsersList();
    var userMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && (method === 'PATCH' || method === 'PUT')) return handleUserPatch(userMatch[1], body);
    if (userMatch && method === 'DELETE') return handleUserDelete(userMatch[1]);

    // Predictions
    if (path === '/api/predictions' && method === 'GET') return handlePredictionsGet();
    if (path === '/api/predictions' && method === 'POST') return handlePredictionsCreate(body);
    var predMatch = path.match(/^\/api\/predictions\/([^/]+)$/);
    if (predMatch && method === 'GET') {
      return (async function () {
        try {
          await initFirebase();
          var snap = await getDB().collection('predictions').doc(predMatch[1]).get();
          if (!snap.exists) return jsonRes({ error: 'Prediction not found.' }, 404);
          var d = snap.data();
          return jsonRes(Object.assign({ id: snap.id }, d, { createdAt: tsToISO(d.createdAt) }), 200);
        } catch (err) {
          console.error('Get prediction error:', err);
          return jsonRes({ error: err.message }, 500);
        }
      })();
    }
    if (predMatch && method === 'PUT') return handlePredictionUpdate(predMatch[1], body);
    if (predMatch && method === 'DELETE') return handlePredictionDelete(predMatch[1]);
    var thanksMatch = path.match(/^\/api\/predictions\/([^/]+)\/thanks$/);
    if (thanksMatch && method === 'POST') return handleThanks(thanksMatch[1]);

    // Albums (music folders)
    if (path === '/api/albums' && method === 'GET') return handleAlbumsList();
    if (path === '/api/albums' && method === 'POST') return handleAlbumCreate(body);
    if (path === '/api/albums/assign' && method === 'POST') return handleAlbumAssign(body);
    var albumMatch = path.match(/^\/api\/albums\/([^/]+)$/);
    if (albumMatch && (method === 'PUT' || method === 'PATCH')) return handleAlbumUpdate(albumMatch[1], body);
    if (albumMatch && method === 'DELETE') return handleAlbumDelete(albumMatch[1]);

    // Generic content (music / apps / paintings / correctpredictions)
    var contentListMatch = path.match(/^\/api\/(music|apps|paintings|correctpredictions|socials|pricelist)$/);
    if (contentListMatch) {
      if (method === 'GET') return handleContentList(contentListMatch[1]);
      if (method === 'POST') return handleContentCreate(contentListMatch[1], body);
    }
    var contentItemMatch = path.match(/^\/api\/(music|apps|paintings|correctpredictions|socials|pricelist)\/([^/]+)$/);
    if (contentItemMatch) {
      if (method === 'GET') {
        return (async function () {
          try {
            await initFirebase();
            var snap = await getDB().collection(contentItemMatch[1]).doc(contentItemMatch[2]).get();
            if (!snap.exists) return jsonRes({ error: 'Item not found.' }, 404);
            var d = snap.data();
            return jsonRes(Object.assign({ id: snap.id }, d, { createdAt: tsToISO(d.createdAt) }), 200);
          } catch (err) {
            console.error('Get content error:', err);
            return jsonRes({ error: err.message }, 500);
          }
        })();
      }
      if (method === 'PUT') return handleContentUpdate(contentItemMatch[1], contentItemMatch[2], body);
      if (method === 'DELETE') return handleContentDelete(contentItemMatch[1], contentItemMatch[2]);
    }

    // VIP messages (legacy single-message inbox)
    if (path === '/api/messages' && method === 'GET') return handleMessageList();
    if (path === '/api/messages' && method === 'POST') return handleMessageCreate(body);
    var msgMatch = path.match(/^\/api\/messages\/([^/]+)$/);
    if (msgMatch && method === 'DELETE') return handleMessageDelete(msgMatch[1]);

    // The Wall — public comments / reviews / suggestions
    if (path === '/api/wall' && method === 'GET') return handleWallList();
    if (path === '/api/wall' && method === 'POST') return handleWallCreate(body);
    var wallMatch = path.match(/^\/api\/wall\/([^/]+)$/);
    if (wallMatch && (method === 'PUT' || method === 'PATCH')) return handleWallUpdate(wallMatch[1], body);
    if (wallMatch && method === 'DELETE') return handleWallDelete(wallMatch[1]);

    // VIP conversations — threaded chat
    if (path === '/api/vip/conversation' && method === 'GET') return handleVipConversationGet();
    if (path === '/api/vip/conversation' && method === 'POST') return handleVipConversationPost(body);
    if (path === '/api/admin/vip/conversations' && method === 'GET') return handleAdminConversationsList();
    var convMatch = path.match(/^\/api\/admin\/vip\/conversation\/([^/]+)$/);
    if (convMatch && method === 'GET') return handleAdminConversationGet(convMatch[1]);
    if (convMatch && method === 'POST') return handleAdminConversationReply(convMatch[1], body);

    // Checkout Stripe — démarre un paiement lié au compte connecté
    if (path === '/api/checkout' && method === 'POST') return handleCreateCheckout(body);
    // Portail de facturation — gérer/annuler son abonnement
    if (path === '/api/billing-portal' && method === 'POST') return handleBillingPortal(body);

    return realFetch ? realFetch(input, init) : Promise.reject(new Error('fetch unavailable'));
  };
})();
