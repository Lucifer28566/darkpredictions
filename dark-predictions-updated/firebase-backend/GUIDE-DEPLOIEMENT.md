# GUIDE DE DÉPLOIEMENT — Dark Predictions

Ce guide t'accompagne pas à pas pour mettre en ligne toutes les
modifications : sécurité Firestore/Storage, Cloud Functions (Stripe),
et le site lui-même. Suis les étapes **dans l'ordre**.

---

## 0. Avant de commencer — outils nécessaires

Tu as besoin de **Node.js** installé sur ton ordinateur (version 20
recommandée) et de la **Firebase CLI**. Si tu ne les as pas :

```bash
# Vérifie si Node est installé
node --version

# Installe la Firebase CLI (une fois, globalement)
npm install -g firebase-tools

# Connecte-toi à ton compte Google/Firebase
firebase login
```

---

## 1. Trouver tes Price ID Stripe

1. Va sur **dashboard.stripe.com**
2. Menu de gauche → **Catalogue de produits** ("Product catalog")
3. Tu devrais voir 3 produits (Basic, Gold, VIP). Clique sur chacun.
4. Note l'identifiant qui commence par `price_...` pour chacun.

Tu devrais obtenir 3 valeurs, par exemple :
```
Basic → price_1AbCdEfGhIjKlMnOp
Gold  → price_1QrStUvWxYzAbCdEf
VIP   → price_1HiJkLmNoPqRsTuVw
```

---

## 2. Trouver ta clé secrète Stripe et ton secret de webhook

1. Toujours sur Stripe → **Développeurs** → **Clés API**
2. Copie la **clé secrète** (commence par `sk_live_...` ou `sk_test_...`
   si tu es encore en mode test). ⚠️ Ne la partage jamais publiquement.
3. Reste sur la page Développeurs → **Webhooks** → **Ajouter un point
   de terminaison** ("Add endpoint")
   - URL à indiquer : voir étape 5 (on doit d'abord déployer pour
     connaître l'URL exacte — tu pourras revenir ici après)
   - Événements à cocher : `checkout.session.completed`,
     `customer.subscription.updated`, `customer.subscription.deleted`
4. Une fois le webhook créé, Stripe te montre un **secret de signature**
   qui commence par `whsec_...` — note-le aussi.

---

## 3. Remplir les fichiers du projet

### 3.a — `firebase-backend/functions/index.js`

Cherche cette section tout en haut du fichier et remplace les 3 valeurs
par tes vrais Price ID (étape 1) :

```js
const PRICE_TO_ROLE = {
  'price_REPLACE_WITH_BASIC_PRICE_ID': 'basic',
  'price_REPLACE_WITH_GOLD_PRICE_ID': 'gold',
  'price_REPLACE_WITH_VIP_PRICE_ID': 'vip',
};
```

Cherche aussi les deux occurrences de `REPLACE_WITH_YOUR_DOMAIN` et
remplace par ton vrai nom de domaine (ex: `darkpredictions.com`, ou
l'URL Firebase Hosting si tu n'as pas de domaine personnalisé, ex:
`darkpredictions-ec67b.web.app`).

### 3.b — `assets/js/checkout.js`

Même chose, remplace les 3 Price ID :

```js
var PRICE_IDS = {
  basic: 'price_REPLACE_WITH_BASIC_PRICE_ID',
  gold:  'price_REPLACE_WITH_GOLD_PRICE_ID',
  vip:   'price_REPLACE_WITH_VIP_PRICE_ID',
};
```

### 3.c — `assets/js/local-api.js`

Cherche cette ligne (tout en haut du fichier) :

```js
var CLOUD_FUNCTIONS_BASE = "https://REPLACE_WITH_YOUR_CLOUD_FUNCTIONS_URL";
```

Tu ne peux remplir l'URL exacte qu'**après** le premier déploiement
des fonctions (étape 5) — reviens ici une fois que tu as l'URL.
Le format est généralement :
```
https://us-central1-darkpredictions-ec67b.cloudfunctions.net
```

---

## 4. Installer les dépendances des Cloud Functions

```bash
cd firebase-backend/functions
npm install
cd ..
```

---

## 5. Configurer les secrets et déployer

Toujours dans le dossier `firebase-backend/` :

```bash
# Renseigne ta clé secrète Stripe (demandée de façon interactive,
# elle n'est jamais écrite dans un fichier du projet)
firebase functions:secrets:set STRIPE_SECRET_KEY

# Renseigne le secret de webhook (voir étape 2, point 4)
firebase functions:secrets:set STRIPE_WEBHOOK_SECRET

# Déploie tout : règles de sécurité + fonctions + site
firebase deploy
```

Si c'est la première fois que tu déploies des Cloud Functions sur ce
projet, Firebase peut te demander de passer au plan **Blaze** (payant
à l'usage, mais avec un palier gratuit large — une carte bancaire est
juste enregistrée en garantie, ce n'est pas un abonnement).

À la fin du déploiement, le terminal affiche les URLs de tes fonctions,
quelque chose comme :
```
✔  functions[stripeWebhook(us-central1)] : https://us-central1-darkpredictions-ec67b.cloudfunctions.net/stripeWebhook
✔  functions[createCheckoutSession(us-central1)] : https://us-central1-darkpredictions-ec67b.cloudfunctions.net/createCheckoutSession
...
```

**Copie la partie commune** (avant `/stripeWebhook`) et colle-la dans
`assets/js/local-api.js` à l'endroit `CLOUD_FUNCTIONS_BASE` (étape 3.c).
Puis redéploie juste le site :

```bash
firebase deploy --only hosting
```

---

## 6. Finaliser le webhook Stripe

Reviens sur **Stripe → Développeurs → Webhooks**, et renseigne l'URL
exacte de ta fonction `stripeWebhook` (copiée à l'étape 5) comme URL
du point de terminaison, si tu ne l'avais pas encore fait à l'étape 2.

---

## 7. Tester le flux complet

1. Va sur ton site, clique sur "Get Basic" (ou Gold/VIP) sans être
   connecté → tu dois être redirigé vers la création de compte.
2. Crée un compte → tu dois être renvoyé automatiquement vers Stripe
   pour payer.
3. Utilise une carte de test Stripe si tu es en mode test :
   numéro `4242 4242 4242 4242`, date future, CVC quelconque.
4. Une fois le paiement validé, tu es renvoyé sur `pricing.html` avec
   un message de confirmation.
5. Va dans **admin.html → onglet Users** : le rôle du compte doit être
   passé de "free" à "basic" (ou gold/vip) automatiquement, en
   quelques secondes.

Si le rôle ne se met pas à jour : va dans **Stripe → Développeurs →
Webhooks → ton endpoint** et regarde l'historique des tentatives —
ça te dira précisément ce qui a échoué (souvent : mauvais secret de
webhook, ou Price ID mal recopié).

---

## 8. Premier compte = administrateur automatiquement

Le tout premier compte jamais créé sur le site reçoit automatiquement
le rôle `developer` (accès admin). Crée ce compte **toi-même en
premier**, avant d'annoncer le site publiquement, pour être sûr que
c'est bien toi qui as les droits admin.

---

## Récapitulatif des fichiers à remplir

| Fichier | Quoi remplir |
|---|---|
| `firebase-backend/functions/index.js` | 3 Price ID Stripe + nom de domaine (x2) |
| `assets/js/checkout.js` | 3 Price ID Stripe |
| `assets/js/local-api.js` | URL des Cloud Functions (après 1er déploiement) |
| Firebase CLI (terminal) | Clé secrète Stripe + secret webhook (jamais dans un fichier) |

## Sécurité — pour rappel

- Les règles `firestore.rules` et `storage.rules` sont déjà prêtes à
  l'emploi, déployées automatiquement avec `firebase deploy`.
- Ne mets **jamais** ta clé secrète Stripe (`sk_live_...`) dans un
  fichier du projet — uniquement via `firebase functions:secrets:set`.
- Le rôle "developer" ne peut être obtenu que par le tout premier
  compte créé, ou attribué manuellement par toi depuis l'admin.
