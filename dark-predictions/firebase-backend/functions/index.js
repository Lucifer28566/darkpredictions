/* ================================================================
   DARK PREDICTIONS — Cloud Functions
   ================================================================
   Ce fichier contient TOUT le code serveur nécessaire pour relier
   Stripe (les paiements) aux comptes Firebase (les rôles d'accès).

   Avant de déployer, voir GUIDE-DEPLOIEMENT.md à la racine de
   firebase-backend/ pour :
   - installer les dépendances (npm install)
   - configurer les clés secrètes (Stripe)
   - associer chaque Price ID Stripe au bon rôle (BASIC/GOLD/VIP)
   - déployer (firebase deploy --only functions)
   ================================================================ */

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// ----------------------------------------------------------------
// Secrets (configurés une fois via la Firebase CLI, jamais en dur
// dans ce fichier — voir GUIDE-DEPLOIEMENT.md)
// ----------------------------------------------------------------
const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY');
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET');

// ----------------------------------------------------------------
// E-mail de confirmation — Nodemailer + SMTP (ex : Gmail, Brevo…)
// Configurer ces secrets une fois via Firebase CLI :
//   firebase functions:secrets:set SMTP_HOST
//   firebase functions:secrets:set SMTP_USER
//   firebase functions:secrets:set SMTP_PASS
//   firebase functions:secrets:set EMAIL_FROM
// Laisser vide (ou retirer du tableau secrets:) si tu préfères
// utiliser uniquement les reçus natifs de Stripe.
// ----------------------------------------------------------------
const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

// ----------------------------------------------------------------
// ⚠️ À REMPLIR : Price ID Stripe → rôle d'accès
// ----------------------------------------------------------------
// Trouve ces identifiants dans Stripe Dashboard → Catalogue de
// produits → (clique sur un produit) → l'ID commence par "price_".
// ----------------------------------------------------------------
const PRICE_TO_ROLE = {
  'price_1Tmpx6H6ga4lgOQ4t8RWBKwn': 'basic',
  'price_1TmpxOH6ga4lgOQ4AonBnbG8': 'gold',
  'price_1TmpxdH6ga4lgOQ4m9SD2jte': 'vip',
  // VIP Lifetime — paiement UNIQUE (mode:'payment' côté Stripe), attribue
  // le rôle 'vip' définitivement (marqué isLifetime:true dans Firestore
  // pour ne jamais rétrograder ce compte quel que soit ce qui arrive).
  'price_1U2rlXH6ga4lgOQ4H6Z1ZJjE': 'vip',
};

// Prix qui correspondent à un paiement UNIQUE (pas un abonnement récurrent).
// Utilisé pour choisir mode:'payment' vs 'subscription' à la création de
// session, et pour marquer le compte comme "à vie" côté webhook.
const ONE_TIME_PRICE_IDS = new Set([
  'price_1U2rlXH6ga4lgOQ4H6Z1ZJjE', // VIP Lifetime £3690
]);

// Ordre de "force" des rôles, du plus faible au plus fort.
const ROLE_RANK = { free: 0, basic: 1, gold: 2, vip: 3, developer: 99 };

// ----------------------------------------------------------------
// Noms lisibles des plans (pour l'e-mail de confirmation)
// ----------------------------------------------------------------
const PLAN_LABELS = {
  basic: 'Basic',
  gold:  'Gold',
  vip:   'VIP',
};

/* ----------------------------------------------------------------
   Envoie un e-mail de confirmation d'adhésion via SMTP.
   Nécessite le package nodemailer : ajouter dans package.json
     "nodemailer": "^6.9.0"
   et relancer npm install dans firebase-backend/functions/.
   ---------------------------------------------------------------- */
async function sendConfirmationEmail({ toEmail, displayName, role, amount, currency }) {
  let smtpHost, smtpUser, smtpPass, emailFrom;
  try {
    smtpHost  = SMTP_HOST.value();
    smtpUser  = SMTP_USER.value();
    smtpPass  = SMTP_PASS.value();
    emailFrom = EMAIL_FROM.value();
  } catch (err) {
    // Secrets SMTP non configurés → on skip silencieusement.
    logger.info('Secrets SMTP absents, e-mail de confirmation ignoré.');
    return;
  }
  if (!smtpHost || !smtpUser || !smtpPass || !emailFrom) {
    logger.info('Secrets SMTP incomplets, e-mail de confirmation ignoré.');
    return;
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: 587,
    secure: false,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const planLabel  = PLAN_LABELS[role] || role;
  const amountFmt  = amount ? `${(amount / 100).toFixed(2)} ${(currency || 'eur').toUpperCase()}` : '';
  const firstName  = displayName ? displayName.split(' ')[0] : 'there';

  const html = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,sans-serif;color:#e0e0e0;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1a1a1a;border-radius:12px;padding:40px;border:1px solid #2a2a2a;max-width:560px;">
        <tr><td align="center" style="padding-bottom:28px;">
          <h1 style="margin:0;font-size:22px;color:#ffffff;letter-spacing:1px;">DARK PREDICTIONS</h1>
          <p style="margin:6px 0 0;font-size:12px;color:#888;letter-spacing:2px;text-transform:uppercase;">Membership Confirmed</p>
        </td></tr>
        <tr><td style="padding-bottom:24px;">
          <p style="margin:0;font-size:16px;color:#e0e0e0;">Hi <strong>${firstName}</strong>,</p>
          <p style="margin:12px 0 0;font-size:15px;color:#c0c0c0;line-height:1.6;">
            Your <strong style="color:#ffffff;">${planLabel}</strong> membership is now active.
            ${amountFmt ? `Your payment of <strong style="color:#ffffff;">${amountFmt}</strong> was received successfully.` : ''}
          </p>
        </td></tr>
        <tr><td style="background:#222;border-radius:8px;padding:20px;margin-bottom:24px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="color:#888;font-size:13px;">Plan</td>
              <td align="right" style="color:#fff;font-size:13px;font-weight:bold;">${planLabel}</td>
            </tr>
            ${amountFmt ? `<tr><td style="color:#888;font-size:13px;padding-top:8px;">Amount paid</td><td align="right" style="color:#fff;font-size:13px;padding-top:8px;">${amountFmt}</td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td align="center" style="padding-top:24px;">
          <a href="https://darkpredictions.com/predictions.html"
             style="display:inline-block;background:#7b2ff7;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:bold;">
            Access my predictions →
          </a>
        </td></tr>
        <tr><td align="center" style="padding-top:28px;">
          <p style="margin:0;font-size:12px;color:#555;">
            To manage or cancel your subscription, visit
            <a href="https://darkpredictions.com/pricing.html" style="color:#7b2ff7;">your account</a>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: `"Dark Predictions" <${emailFrom}>`,
    to: toEmail,
    subject: `✅ Your ${planLabel} membership is active — Dark Predictions`,
    html,
    text: `Hi ${firstName},\n\nYour ${planLabel} membership is now active.${amountFmt ? ` Payment of ${amountFmt} received.` : ''}\n\nAccess your predictions: https://darkpredictions.com/predictions.html\n\nTo manage your subscription: https://darkpredictions.com/pricing.html`,
  });

  logger.info(`E-mail de confirmation envoyé à ${toEmail} (plan: ${role})`);
}

function roleFromPriceId(priceId) {
  return PRICE_TO_ROLE[priceId] || null;
}

/* ================================================================
   OUTIL PARTAGÉ — applique un rôle à un utilisateur :
   - met à jour Firestore (users/{uid}.role)
   - met à jour le "custom claim" du token Firebase Auth (utilisé
     par les règles de sécurité Storage, et utile pour le front)
   ================================================================ */
async function setUserRole(uid, role, extra) {
  var ref = db.collection('users').doc(uid);
  var snap = await ref.get();

  var updates = Object.assign({ role: role, roleUpdatedAt: new Date().toISOString() }, extra || {});

  // Si le document n'existe pas encore, ou s'il lui manque des champs de
  // base (cas observé : un paiement Stripe arrivé avant que le trigger
  // onUserCreate ait fini de créer le document), on va chercher les
  // informations manquantes directement depuis Firebase Auth pour éviter
  // un "compte fantôme" sans email/displayName/createdAt.
  var existing = snap.exists ? snap.data() : null;
  if (!existing || !existing.email || !existing.createdAt) {
    try {
      var authUser = await auth.getUser(uid);
      if (!existing || !existing.email) updates.email = authUser.email || (existing && existing.email) || null;
      if (!existing || !existing.displayName) {
        updates.displayName = (authUser.displayName) ||
          (existing && existing.displayName) ||
          (authUser.email ? authUser.email.split('@')[0] : 'User');
      }
      if (!existing || !existing.createdAt) {
        updates.createdAt = (existing && existing.createdAt) ||
          (authUser.metadata && authUser.metadata.creationTime
            ? new Date(authUser.metadata.creationTime).toISOString()
            : new Date().toISOString());
      }
    } catch (err) {
      logger.warn(`setUserRole: impossible de récupérer l'utilisateur Auth ${uid} pour compléter son profil:`, err.message);
    }
  }

  await ref.set(updates, { merge: true });
  await auth.setCustomUserClaims(uid, { role: role });
  logger.info(`Rôle mis à jour: uid=${uid} role=${role}`);
}

/* ================================================================
   1) STRIPE WEBHOOK
   ================================================================
   C'est l'URL que Stripe appelle automatiquement après un paiement.
   Une fois déployée, elle ressemblera à :
   https://us-central1-darkpredictions-ec67b.cloudfunctions.net/stripeWebhook

   À copier dans Stripe Dashboard → Développeurs → Webhooks → URL.
   Événements à écouter : checkout.session.completed,
   customer.subscription.updated, customer.subscription.deleted
   ================================================================ */
exports.stripeWebhook = onRequest(
  { secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET], cors: false },
  async (req, res) => {
    const stripe = require('stripe')(STRIPE_SECRET_KEY.value());
    const sig = req.headers['stripe-signature'];

    let event;
    try {
      // req.rawBody est nécessaire pour vérifier la signature Stripe.
      // Firebase Functions le fournit automatiquement.
      event = stripe.webhooks.constructEvent(req.rawBody, sig, STRIPE_WEBHOOK_SECRET.value());
    } catch (err) {
      logger.error('Signature webhook invalide:', err.message);
      res.status(400).send(`Webhook signature verification failed.`);
      return;
    }

    // Anti doublon : Stripe peut renvoyer le même événement plusieurs
    // fois. On vérifie qu'on ne l'a jamais traité.
    const eventRef = db.collection('stripeEvents').doc(event.id);
    const alreadyProcessed = (await eventRef.get()).exists;
    if (alreadyProcessed) {
      res.status(200).send('Already processed.');
      return;
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          await handleCheckoutCompleted(stripe, session);
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          await handleSubscriptionChange(subscription, event.type);
          break;
        }
        default:
          // Autres événements : on les ignore proprement.
          break;
      }
      await eventRef.set({ type: event.type, processedAt: new Date().toISOString() });
      res.status(200).send('ok');
    } catch (err) {
      logger.error('Erreur traitement webhook:', err);
      // On répond 500 pour que Stripe retente plus tard.
      res.status(500).send('Internal error.');
    }
  }
);

/* ----------------------------------------------------------------
   Quand un paiement vient d'être confirmé (checkout terminé) :
   - on retrouve l'utilisateur (via l'UID transmis dans le metadata
     de la session de checkout, voir createCheckoutSession plus bas)
   - on retrouve le rôle correspondant au prix payé
   - on met à jour son compte
   ---------------------------------------------------------------- */
async function handleCheckoutCompleted(stripe, session) {
  const uid = session.metadata && session.metadata.uid;
  if (!uid) {
    logger.warn('checkout.session.completed sans uid dans metadata — abandon.', session.id);
    return;
  }

  // On récupère le Price ID exact selon le mode de la session.
  // - Abonnement (subscription) : on relit la subscription pour retrouver le prix.
  // - Paiement unique (payment) : pas de subscription — on récupère le
  //   priceId depuis les metadata (posé à la création par nous), ou en
  //   dernier recours depuis les line_items de la session.
  let priceId = null;
  let isLifetime = false;
  if (session.subscription) {
    const sub = await stripe.subscriptions.retrieve(session.subscription);
    priceId = sub.items.data[0] && sub.items.data[0].price && sub.items.data[0].price.id;

    // On stocke l'ID d'abonnement Stripe sur l'utilisateur, pour pouvoir
    // le retrouver plus tard si l'abonnement change ou est annulé.
    await db.collection('users').doc(uid).set(
      {
        stripeCustomerId: session.customer || null,
        stripeSubscriptionId: session.subscription,
      },
      { merge: true }
    );
  } else {
    // Paiement unique : pas de subscription, on lit metadata.priceId
    // (posé côté createCheckoutSession). Fallback : line_items via API.
    priceId = session.metadata && session.metadata.priceId;
    if (!priceId) {
      try {
        const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 1 });
        priceId = items.data[0] && items.data[0].price && items.data[0].price.id;
      } catch (e) { logger.error('Impossible de lire line_items:', e.message); }
    }
    if (priceId && ONE_TIME_PRICE_IDS.has(priceId)) {
      isLifetime = true;
      // Stocke le customer Stripe (pour référence) mais PAS de subscriptionId
      // (il n'y en a pas). Le portail Stripe ne pourra pas gérer ce paiement,
      // c'est normal : rien à annuler pour un achat définitif.
      await db.collection('users').doc(uid).set(
        { stripeCustomerId: session.customer || null, isLifetime: true },
        { merge: true }
      );
    }
  }

  const role = priceId ? roleFromPriceId(priceId) : null;
  if (!role) {
    logger.error('Price ID inconnu, impossible de déterminer le rôle:', priceId);
    return;
  }

  await setUserRole(uid, role, {
    lastPayment: {
      amount: session.amount_total,
      currency: session.currency,
      at: new Date().toISOString(),
    },
  });

  // Envoie l'e-mail de confirmation à l'utilisateur.
  try {
    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : {};
    await sendConfirmationEmail({
      toEmail:     userData.email     || session.customer_details?.email,
      displayName: userData.displayName || '',
      role:        role,
      amount:      session.amount_total,
      currency:    session.currency,
    });
  } catch (err) {
    // L'e-mail est non-critique : on ne bloque pas le webhook.
    logger.error('Erreur envoi e-mail confirmation:', err.message);
  }

  // Historique des paiements (pour le suivi demandé : qui a payé, combien).
  await db.collection('users').doc(uid).collection('payments').add({
    amount: session.amount_total,
    currency: session.currency,
    priceId: priceId,
    role: role,
    stripeSessionId: session.id,
    createdAt: new Date().toISOString(),
  });
}

/* ----------------------------------------------------------------
   Quand un abonnement est modifié ou annulé (ex: le client annule,
   ou ne paie plus) : on adapte le rôle en conséquence.
   ---------------------------------------------------------------- */
async function handleSubscriptionChange(subscription, eventType) {
  const usersSnap = await db
    .collection('users')
    .where('stripeSubscriptionId', '==', subscription.id)
    .limit(1)
    .get();

  if (usersSnap.empty) {
    logger.warn('Aucun utilisateur trouvé pour cet abonnement Stripe:', subscription.id);
    return;
  }
  const userDoc = usersSnap.docs[0];

  if (eventType === 'customer.subscription.deleted' || subscription.status === 'canceled' || subscription.status === 'unpaid') {
    // Filet de sécurité : un compte marqué isLifetime a payé une fois pour
    // toutes (VIP Lifetime) — il ne doit JAMAIS être rétrogradé, même si
    // un événement Stripe orphelin arrive.
    if (userDoc.data() && userDoc.data().isLifetime) {
      logger.info('Ignoré : compte lifetime, pas de rétrogradation.', userDoc.id);
      return;
    }
    // Abonnement annulé ou impayé → retour au rôle gratuit.
    await setUserRole(userDoc.id, 'free', { stripeSubscriptionId: null });
    return;
  }

  // Abonnement encore actif mais peut-être changé de plan (upgrade/downgrade).
  const priceId = subscription.items.data[0] && subscription.items.data[0].price && subscription.items.data[0].price.id;
  const role = roleFromPriceId(priceId);
  if (role) {
    await setUserRole(userDoc.id, role);
  }
}

/* ================================================================
   2) CRÉATION D'UNE SESSION DE CHECKOUT STRIPE
   ================================================================
   Le front-end appelle cette fonction (au lieu d'utiliser un simple
   lien buy.stripe.com) pour démarrer un paiement. Ça permet d'attacher
   l'UID de l'utilisateur connecté à la session, indispensable pour
   que le webhook sache QUI vient de payer.

   ⚠️ Important : ceci OBLIGE l'utilisateur à être connecté avant de
   payer (exactement ce que tu demandais : connexion obligatoire
   avant l'achat, jamais après).
   ================================================================ */
exports.createCheckoutSession = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: true },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    if (!idToken) {
      res.status(401).json({ error: 'Connecte-toi avant de payer.' });
      return;
    }

    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      res.status(401).json({ error: 'Session invalide, reconnecte-toi.' });
      return;
    }

    const { priceId, successUrl, cancelUrl } = req.body || {};
    if (!priceId || !PRICE_TO_ROLE[priceId]) {
      res.status(400).json({ error: 'Unknown plan.' });
      return;
    }

    const stripe = require('stripe')(STRIPE_SECRET_KEY.value());

    // Si l'utilisateur a déjà un customer Stripe, on le réutilise
    // (évite les doublons de clients dans Stripe).
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const existingCustomerId = userSnap.exists ? userSnap.data().stripeCustomerId : null;

    try {
      const isOneTime = ONE_TIME_PRICE_IDS.has(priceId);
      const session = await stripe.checkout.sessions.create({
        // Paiement récurrent (subscription) pour Basic/Gold/VIP mensuels,
        // paiement unique (payment) pour VIP Lifetime. Stripe refuse une
        // session 'subscription' avec un prix one-time et inversement.
        mode: isOneTime ? 'payment' : 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        customer: existingCustomerId || undefined,
        customer_email: existingCustomerId ? undefined : decoded.email,
        client_reference_id: decoded.uid,
        metadata: { uid: decoded.uid, priceId: priceId }, // priceId dans metadata pour retrouver le rôle même en mode payment
        success_url: successUrl || 'https://darkpredictions.com/pricing.html?checkout=success',
        cancel_url: cancelUrl || 'https://darkpredictions.com/pricing.html?checkout=cancelled',
      });
      res.status(200).json({ url: session.url });
    } catch (err) {
      logger.error('Erreur création session checkout:', err);
      res.status(500).json({ error: 'Could not start the payment.' });
    }
  }
);

/* ================================================================
   3) PORTAIL DE FACTURATION STRIPE
   ================================================================
   Permet à un membre connecté de gérer/annuler son abonnement
   lui-même, sans passer par l'admin.
   ================================================================ */
exports.createBillingPortalSession = onRequest(
  { secrets: [STRIPE_SECRET_KEY], cors: true },
  async (req, res) => {
    const idToken = (req.headers.authorization || '').replace('Bearer ', '');
    if (!idToken) {
      res.status(401).json({ error: 'Connecte-toi.' });
      return;
    }
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken);
    } catch (err) {
      res.status(401).json({ error: 'Session invalide.' });
      return;
    }

    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const customerId = userSnap.exists ? userSnap.data().stripeCustomerId : null;
    if (!customerId) {
      res.status(400).json({ error: 'No subscription found for this account.' });
      return;
    }

    const stripe = require('stripe')(STRIPE_SECRET_KEY.value());
    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: (req.body && req.body.returnUrl) || 'https://darkpredictions.com/pricing.html',
      });
      res.status(200).json({ url: portalSession.url });
    } catch (err) {
      logger.error('Erreur portail facturation:', err);
      res.status(500).json({ error: 'Impossible d’ouvrir le portail de facturation.' });
    }
  }
);

/* ================================================================
   4) CRÉATION AUTOMATIQUE DU PROFIL UTILISATEUR
   ================================================================
   Dès qu'un compte Firebase Auth est créé (signup), cette fonction
   se déclenche automatiquement et crée le document users/{uid}
   correspondant — avec les vrais droits admin (donc elle peut
   donner le rôle 'developer' au premier compte, ce que les règles
   de sécurité interdisent normalement à un client).
   ================================================================ */
const { beforeUserCreated } = require('firebase-functions/v2/identity');

exports.onUserCreate = beforeUserCreated(async (event) => {
  const user = event.data;
  const usersSnap = await db.collection('users').limit(1).get();
  const isFirstAccount = usersSnap.empty;
  const role = isFirstAccount ? 'developer' : 'free';

  await db.collection('users').doc(user.uid).set({
    email: user.email,
    displayName: (user.displayName || (user.email ? user.email.split('@')[0] : 'User')),
    role: role,
    createdAt: new Date().toISOString(),
  });

  return {
    customClaims: { role: role },
  };
});

/* ================================================================
   5) MISE À JOUR DU RÔLE PAR L'ADMIN (depuis admin.html)
   ================================================================
   Remplace l'écriture directe Firestore par une fonction qui pose
   AUSSI le custom claim, pour rester cohérent avec les Storage
   Rules. Le front (admin.js) doit appeler cette fonction au lieu
   d'un PUT/PATCH direct sur Firestore.
   ================================================================ */
exports.adminSetUserRole = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }
  const idToken = (req.headers.authorization || '').replace('Bearer ', '');
  if (!idToken) {
    res.status(401).json({ error: 'Connecte-toi.' });
    return;
  }
  let decoded;
  try {
    decoded = await auth.verifyIdToken(idToken);
  } catch (err) {
    res.status(401).json({ error: 'Session invalide.' });
    return;
  }

  const callerSnap = await db.collection('users').doc(decoded.uid).get();
  if (!callerSnap.exists || callerSnap.data().role !== 'developer') {
    res.status(403).json({ error: 'Developer account only.' });
    return;
  }

  const { targetUid, role } = req.body || {};
  const validRoles = ['free', 'trial', 'basic', 'gold', 'vip', 'developer'];
  if (!targetUid || validRoles.indexOf(role) === -1) {
    res.status(400).json({ error: 'Invalid parameters.' });
    return;
  }

  await setUserRole(targetUid, role);
  res.status(200).json({ ok: true });
});
