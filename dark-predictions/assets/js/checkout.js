/* ============================================================
   checkout.js — Démarre un paiement Stripe lié au compte connecté.

   Remplace les anciens liens directs "buy.stripe.com/..." (qui ne
   reliaient jamais le paiement à un compte). Maintenant :
   1. Si le visiteur n'est pas connecté → on l'envoie créer un compte
      ou se connecter D'ABORD (jamais de paiement sans compte).
   2. S'il est connecté → on démarre une session Stripe Checkout
      avec son UID attaché, pour que le webhook puisse ensuite
      activer le bon rôle automatiquement.

   ⚠️ À REMPLIR : les 3 Price ID Stripe ci-dessous (voir
   GUIDE-DEPLOIEMENT.md pour savoir où les trouver).
   ============================================================ */
(function () {
  var PRICE_IDS = {
    basic:    'price_1Tmpx6H6ga4lgOQ4t8RWBKwn',
    gold:     'price_1TmpxOH6ga4lgOQ4AonBnbG8',
    vip:      'price_1TmpxdH6ga4lgOQ4m9SD2jte',
    // VIP Lifetime — paiement UNIQUE (pas d'abonnement). Le webhook
    // Cloud Function doit détecter mode='payment' au lieu de 'subscription'
    // pour ce priceId, et attribuer le rôle 'vip' à vie sans expiration.
    lifetime: 'price_1U2rlXH6ga4lgOQ4H6Z1ZJjE',
  };

  function setLoading(btn, loading) {
    if (!btn) return;
    btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
    btn.textContent = loading ? 'Redirecting…' : btn.dataset.originalText;
    btn.style.pointerEvents = loading ? 'none' : '';
    btn.style.opacity = loading ? '0.7' : '';
  }

  async function startCheckout(plan, btn) {
    var priceId = PRICE_IDS[plan];
    if (!priceId || priceId.indexOf('REPLACE_WITH') !== -1) {
      alert('Incomplete Stripe configuration: missing Price ID for plan "' + plan + '".');
      return;
    }

    var user = window.DP ? await window.DP.getMe() : null;
    if (!user) {
      // Pas connecté → on l'envoie créer un compte / se connecter d'abord,
      // avec une redirection automatique vers le paiement une fois connecté.
      window.location.href = '/signup.html?next=checkout&plan=' + encodeURIComponent(plan);
      return;
    }

    setLoading(btn, true);
    try {
      var res = await fetch('/api/checkout', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: priceId }),
      });
      var data = await res.json();
      if (!res.ok || !data.url) {
        alert(data.error || "Could not start the payment right now.");
        setLoading(btn, false);
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      console.error(err);
      alert('Network error, please try again in a moment.');
      setLoading(btn, false);
    }
  }

  function wireCheckoutButtons() {
    document.querySelectorAll('[data-checkout-plan]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        startCheckout(btn.getAttribute('data-checkout-plan'), btn);
      });
    });
  }

  // Si on revient d'un signup/login avec l'intention de payer ensuite
  // (voir auth.js : redirection post-connexion), on relance le checkout
  // automatiquement.
  function resumeCheckoutIfNeeded() {
    var params = new URLSearchParams(window.location.search);
    if (params.get('next') === 'checkout' && params.get('plan')) {
      startCheckout(params.get('plan'), null);
    }
  }

  // Show a message when returning from Stripe (success / cancelled), and a
  // "Manage my subscription" button if the user already has an active plan.
  async function setupPricingPageExtras() {
    var notice = document.getElementById('checkoutNotice');
    var portalArea = document.getElementById('billingPortalArea');
    if (!notice && !portalArea) return; // pas sur pricing.html

    var params = new URLSearchParams(window.location.search);
    var status = params.get('checkout');
    if (notice && status === 'success') {
      notice.style.display = 'block';
      notice.style.background = 'rgba(122,210,122,.12)';
      notice.style.color = '#7ad27a';
      notice.textContent = '✅ Payment confirmed! Your access activates automatically, usually within a few seconds.';
    } else if (notice && status === 'cancelled') {
      notice.style.display = 'block';
      notice.style.background = 'rgba(255,111,111,.1)';
      notice.style.color = '#ff6f6f';
      notice.textContent = 'Payment cancelled. You can try again anytime.';
    }

    if (portalArea) {
      var user = window.DP ? await window.DP.getMe() : null;
      if (user && (user.role === 'basic' || user.role === 'gold' || user.role === 'vip')) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost btn-sm';
        btn.textContent = 'Manage my subscription';
        btn.addEventListener('click', async function () {
          setLoading(btn, true);
          try {
            var res = await fetch('/api/billing-portal', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
            });
            var data = await res.json();
            if (!res.ok || !data.url) {
              alert(data.error || "Could not open the billing portal.");
              setLoading(btn, false);
              return;
            }
            window.location.href = data.url;
          } catch (err) {
            alert('Network error, please try again in a moment.');
            setLoading(btn, false);
          }
        });
        portalArea.appendChild(btn);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireCheckoutButtons();
    resumeCheckoutIfNeeded();
    setupPricingPageExtras();
  });
})();
