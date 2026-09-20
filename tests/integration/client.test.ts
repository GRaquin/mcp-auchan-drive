import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuchanClient } from '../../src/auchan/client.js';
import { Throttler } from '../../src/auchan/throttle.js';
import type { CookieProvider } from '../../src/types.js';
import cartGetFixture from '../fixtures/cart-get-response.json' assert { type: 'json' };
import cartAddFixture from '../fixtures/cart-add-response.json' assert { type: 'json' };
import cartUpdateFixture from '../fixtures/cart-update-response.json' assert { type: 'json' };
import cartRemoveFixture from '../fixtures/cart-remove-response.json' assert { type: 'json' };

// HTML minimal simulant une page de résultats de recherche Auchan Drive
const SEARCH_HTML = `
<html><body>
<article>
<strong>ELLE &amp; VIRE</strong>
<p class="product-thumbnail__description">Beurre tendre doux 82%MG</p>
<div class="product-price">2,98 €</div>
<span>11,92 € / kg</span>
<span class="product-attribute">250g</span>
<a href="/produit/pr-C1264653">voir</a>
<div class="quantity-selector"
  data-product-id="acfdc139-5da2-4e2c-b652-5687fa2932b1"
  data-offer-id="19f46dfd-f09f-5533-9958-a71f53c6adbb"
  data-seller-id="b42fbf5b-51d4-42d0-bad8-abe4e6963846"
  data-seller-type="GROCERY">
</div>
</article>
</body></html>
`;

// Throttler sans délai pour les tests
function fastThrottler() {
  return new Throttler({ minIntervalMs: 0, jitterMs: 0, maxRetries: 3, backoffBaseMs: 0 });
}

// CookieProvider factice
function fakeCookies(cookie = 'lark-session=test; datadome=dd; lark-consentId=consent-uuid'): CookieProvider {
  return {
    getCookie: vi.fn().mockResolvedValue(cookie),
    invalidate: vi.fn(),
  };
}

// Construit un mock fetch retournant une réponse JSON
function mockFetchJson(body: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

// Construit un mock fetch retournant du HTML
function mockFetchHtml(html: string): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.reject(new Error('not json')),
    text: () => Promise.resolve(html),
  } as Response);
}

// Construit un mock fetch qui échoue avec un status HTTP
function mockFetchError(status: number): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(''),
  } as Response);
}

// Mock fetch retournant un HTML différent selon un fragment d'URL (pour les appels
// qui enchaînent plusieurs requêtes, ex. getLoyaltyHistory → getLoyaltyInfo puis l'historique).
function mockFetchByUrl(pages: Record<string, string>): typeof fetch {
  return vi.fn().mockImplementation((url: string) => {
    const match = Object.entries(pages).find(([fragment]) => url.includes(fragment));
    if (!match) throw new Error(`mockFetchByUrl: URL non gérée: ${url}`);
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => {
        try {
          return Promise.resolve(JSON.parse(match[1]));
        } catch {
          return Promise.reject(new Error('not json'));
        }
      },
      text: () => Promise.resolve(match[1]),
    } as Response);
  });
}

// ── search ────────────────────────────────────────────────────────────────────

describe('AuchanClient.search', () => {
  it('retourne les produits parsés depuis le HTML de recherche', async () => {
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', mockFetchHtml(SEARCH_HTML));
    const results = await client.search('beurre');

    expect(results).toHaveLength(1);
    expect(results[0].productId).toBe('acfdc139-5da2-4e2c-b652-5687fa2932b1');
    expect(results[0].offerId).toBe('19f46dfd-f09f-5533-9958-a71f53c6adbb');
    expect(results[0].name).toBe('Beurre tendre doux 82%MG');
    expect(results[0].brand).toBe('ELLE & VIRE');
    expect(results[0].price).toBe(298);
    expect(results[0].pricePerKg).toBe(1192);
    expect(results[0].format).toBe('250g');
    expect(results[0].available).toBe(true);
  });

  it('retourne [] si la page ne contient aucun produit', async () => {
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', mockFetchHtml('<html><body>Aucun résultat</body></html>'));
    const results = await client.search('produitinexistant');
    expect(results).toEqual([]);
  });

  it('lève une erreur sur 403 après épuisement des retries', async () => {
    const fetch403 = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    } as Response);
    const cookies = fakeCookies();
    const client = new AuchanClient(cookies, fastThrottler(), 'https://www.auchan.fr', fetch403);

    await expect(client.search('beurre')).rejects.toThrow('HTTP 403');
    // invalidate() doit avoir été appelé à chaque tentative (4 = 1 + 3 retries)
    expect(cookies.invalidate).toHaveBeenCalledTimes(4);
  });

  it('ne retry pas sur une erreur 500 (non-retryable)', async () => {
    const fetch500 = mockFetchError(500);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetch500);

    await expect(client.search('beurre')).rejects.toThrow('HTTP 500');
    expect(fetch500).toHaveBeenCalledTimes(1);
  });
});

// ── getCart ───────────────────────────────────────────────────────────────────

describe('AuchanClient.getCart', () => {
  it('retourne le panier avec les articles et le total', async () => {
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', mockFetchJson(cartGetFixture));
    const cart = await client.getCart();

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].productId).toBe('d2b82432-fe6b-4d95-a52f-3a6a65150092');
    expect(cart.items[0].quantity).toBe(4);
    expect(cart.total).toBe(4354);
    expect(cart.itemCount).toBe(1);
  });

  it('retourne un panier vide si items est absent', async () => {
    const emptyCart = { cart: { cart: { id: 'x', prices: { totalPrice: { amount: 0 } }, items: [] } } };
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', mockFetchJson(emptyCart));
    const cart = await client.getCart();

    expect(cart.items).toHaveLength(0);
    expect(cart.total).toBe(0);
  });

  // GET /cart ne renvoie que des identifiants et des prix, jamais le nom du produit
  // (voir enrichCartLabels) : on complète via le fragment CREST du mini-panier, qui
  // réutilise les mêmes cartes "product-thumbnail" que /recherche.
  const MINI_CART_HTML = `
<html><body><article>
  <a class="productThumbnailLink" href="/danone-yaourt/pr-C9999999"></a>
  <p class="product-thumbnail__description"><strong>DANONE</strong> Yaourt nature</p>
  <span class="product-attribute">4x125g</span>
  <div class="quantity-selector"
    data-product-id="d2b82432-fe6b-4d95-a52f-3a6a65150092"
    data-offer-id="e5847037-0b45-5aa0-9f76-47b576787256"
    data-seller-id="b42fbf5b-51d4-42d0-bad8-abe4e6963846"
    data-seller-type="GROCERY">
  </div>
</article></body></html>`;

  it('enrichit le label (nom/marque/format) depuis le fragment du mini-panier', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve(MINI_CART_HTML) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.getCart();

    expect(cart.items[0].label).toBe('DANONE Yaourt nature');
    expect(cart.items[0].brand).toBe('DANONE');
    expect(cart.items[0].format).toBe('4x125g');

    const [fragmentUrl] = fetchFn.mock.calls[1] as [string];
    expect(fragmentUrl).toBe('https://www.auchan.fr/fragment/layer/mini-cart/content');
  });

  it("renvoie le panier tel quel (label vide) si l'enrichissement échoue", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error', text: () => Promise.resolve('') } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.getCart();

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].label).toBe('');
  });
});

// ── addToCart ─────────────────────────────────────────────────────────────────

describe('AuchanClient.addToCart', () => {
  it('POST /cart/update avec le bon body et retourne le panier mis à jour', async () => {
    // Premier appel : GET /cart, deuxième appel : POST /cart/update
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartAddFixture) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.addToCart(
      'acfdc139-5da2-4e2c-b652-5687fa2932b1',
      '19f46dfd-f09f-5533-9958-a71f53c6adbb',
      'b42fbf5b-51d4-42d0-bad8-abe4e6963846',
      'GROCERY',
      1,
    );

    expect(cart.items).toHaveLength(2);
    expect(cart.items[1].productId).toBe('acfdc139-5da2-4e2c-b652-5687fa2932b1');

    // Vérifier le body du POST
    const [, postInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.cartId).toBe('438e38d8-958a-4c66-93be-f4de245a9c98');
    expect(body.items[0].productId).toBe('acfdc139-5da2-4e2c-b652-5687fa2932b1');
    expect(body.items[0].desiredQuantity).toBe(1);
    expect(body.consentId).toBe('consent-uuid');
  });
});

// ── updateQuantity ────────────────────────────────────────────────────────────

describe('AuchanClient.updateQuantity', () => {
  it('met à jour la quantité d\'un article existant', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartUpdateFixture) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.updateQuantity('d2b82432-fe6b-4d95-a52f-3a6a65150092', 3);

    expect(cart.items[0].quantity).toBe(3);

    const [, postInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.items[0].desiredQuantity).toBe(3);
    // le champ id doit être présent pour un UPDATE
    expect(body.items[0].id).toBe('5797d20b-68cc-4484-a711-69f3b5e8893c');
  });

  it('appelle removeFromCart si quantity === 0', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartRemoveFixture) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.updateQuantity('d2b82432-fe6b-4d95-a52f-3a6a65150092', 0);

    expect(cart.items).toHaveLength(0);

    const [, postInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.items[0].desiredQuantity).toBe(0);
  });

  it('lève une erreur si le produit n\'est pas dans le panier', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(cartGetFixture),
    } as Response);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);

    await expect(client.updateQuantity('produit-inexistant', 2)).rejects.toThrow('not found in cart');
  });
});

// ── removeFromCart ────────────────────────────────────────────────────────────

describe('AuchanClient.removeFromCart', () => {
  it('supprime l\'article et retourne le panier vide', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartGetFixture) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve(cartRemoveFixture) } as Response);

    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const cart = await client.removeFromCart('d2b82432-fe6b-4d95-a52f-3a6a65150092');

    expect(cart.items).toHaveLength(0);
    expect(cart.total).toBe(0);

    const [, postInit] = fetchFn.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(postInit.body as string);
    expect(body.items[0].desiredQuantity).toBe(0);
    expect(body.items[0].id).toBe('5797d20b-68cc-4484-a711-69f3b5e8893c');
  });

  it('lève une erreur si le produit n\'est pas dans le panier', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(cartGetFixture),
    } as Response);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);

    await expect(client.removeFromCart('produit-absent')).rejects.toThrow('not found in cart');
  });
});

// ── getLoyaltyHistory ─────────────────────────────────────────────────────────

// getLoyaltyHistory() appelle d'abord getLoyaltyInfo() (pour le waoohAccountNumber),
// puis /fidelite/ma-carte/historique?id=... : il faut donc mocker les deux URLs.
function historyItem(date: string, channel: string, storeName: string, amount: string): string {
  const amountClass = amount.startsWith('-') ? 'm-waaohHistory__amount -minus' : 'm-waaohHistory__amount';
  return `
  <div class="m-waaohHistory" role="listitem">
    <div class="m-waaohHistory__date">${date}</div>
    <div class="m-waaohHistory__deliveryType">${channel}</div>
    <div class="m-waaohHistory__deliveryPlace">${storeName}</div>
    <div class="${amountClass}">${amount}</div>
  </div>`;
}

const MINIMAL_LOYALTY_HTML = `
<html><body>
<div class="waaoh-card__menu"><p class="text-body-s">N&#xB0; de compte Waaoh! : 00000000</p></div>
</body></html>
`;

const LOYALTY_HISTORY_HTML = `
<html><body><div role="list">
  ${historyItem('04/06/2026', 'Drive', 'Auchan Drive Saint-Genis (Chapônost)', '+0.53')}
  ${historyItem('01/06/2026', 'Magasin', 'Auchan Supermarché Lyon Garibaldi', '-2.00')}
</div></body></html>
`;

describe('AuchanClient.getLoyaltyHistory', () => {
  it('fetche /fidelite/ma-carte/historique et retourne les transactions parsées', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchByUrl({
        '/fidelite/ma-carte/historique': LOYALTY_HISTORY_HTML,
        '/fidelite/accueil': MINIMAL_LOYALTY_HTML,
      }),
    );
    const history = await client.getLoyaltyHistory();

    expect(history).toHaveLength(2);
    expect(history[0].date).toBe('04/06/2026');
    expect(history[0].channel).toBe('Drive');
    expect(history[0].storeName).toBe('Auchan Drive Saint-Genis (Chapônost)');
    expect(history[0].amountCents).toBe(53);
    expect(history[0].amountFormatted).toBe('+0,53 €');
    expect(history[1].amountCents).toBe(-200);
    expect(history[1].amountFormatted).toBe('-2,00 €');
  });

  it('appelle bien GET /fidelite/ma-carte/historique avec le numéro de compte Waaoh', async () => {
    const fetchFn = mockFetchByUrl({
      '/fidelite/ma-carte/historique': LOYALTY_HISTORY_HTML,
      '/fidelite/accueil': MINIMAL_LOYALTY_HTML,
    });
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getLoyaltyHistory();

    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls as [string][];
    const historyUrl = calls.map(([u]) => u).find((u) => u.includes('historique'));
    expect(historyUrl).toBe('https://www.auchan.fr/fidelite/ma-carte/historique?id=00000000');
  });

  it('retourne un tableau vide si la page ne contient aucune transaction', async () => {
    const emptyHtml = '<html><body><div role="list"></div></body></html>';
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchByUrl({
        '/fidelite/ma-carte/historique': emptyHtml,
        '/fidelite/accueil': MINIMAL_LOYALTY_HTML,
      }),
    );
    const history = await client.getLoyaltyHistory();
    expect(history).toEqual([]);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getLoyaltyHistory()).rejects.toThrow('HTTP 403');
  });
});

// ── searchPromos ──────────────────────────────────────────────────────────────

describe('AuchanClient.searchPromos', () => {
  it('retourne les produits en promo sans argument (GET /boutique/promos)', async () => {
    const fetchFn = mockFetchHtml(SEARCH_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const results = await client.searchPromos();

    expect(results).toHaveLength(1);
    expect(results[0].productId).toBe('acfdc139-5da2-4e2c-b652-5687fa2932b1');
    expect(results[0].name).toBe('Beurre tendre doux 82%MG');
    expect(results[0].price).toBe(298);
    expect(results[0].available).toBe(true);

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/boutique/promos');
  });

  it('passe le paramètre text quand query est fournie', async () => {
    const fetchFn = mockFetchHtml(SEARCH_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.searchPromos('café');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/boutique/promos?text=caf%C3%A9');
  });

  it('passe le paramètre category quand category est fournie', async () => {
    const fetchFn = mockFetchHtml(SEARCH_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.searchPromos(undefined, 'ca-n02');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/boutique/promos?category=ca-n02');
  });

  it('passe query et category ensemble', async () => {
    const fetchFn = mockFetchHtml(SEARCH_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.searchPromos('beurre', 'ca-n01');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/boutique/promos?text=beurre&category=ca-n01');
  });

  it('retourne [] si la page ne contient aucun produit', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body>Aucune promo</body></html>'),
    );
    const results = await client.searchPromos();
    expect(results).toEqual([]);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.searchPromos()).rejects.toThrow('HTTP 403');
  });
});

// ── getLoyaltyInfo ────────────────────────────────────────────────────────────

const LOYALTY_HTML = `
<html><body>
<article class="n-card waaoh-card">
  <div class="waaoh-card__reward">
    <p class="text-headline-m waaoh-card__reward-amount">3.46 &#x20AC;</p>
  </div>
</article>
<div class="waaoh-card__menu">
  <p class="text-body-s">N&#xB0; de compte Waaoh! : 00000000</p>
  <div class="change-card change-card--selected">
    <div class="change-card__info">
      <p class="change-card__name">DOE</p>
      <p class="change-card__name">John</p>
    </div>
  </div>
  <div class="waaoh-card__wallet"><p>Carte N&#xB0; 0000000000000</p></div>
</div>
<article id="discountClubPageContent" class="n-card day-w-card" aria-labelledby="n-card-selected-day-title">
  <header class="n-card__header">
    <h2 id="n-card-selected-day-title" class="text-headline-xs">10 % cagnott&#xE9;s sur tous les produits frais des Halles</h2>
  </header>
  <div class="n-card__content"><p>Mon jour W! : <strong>mercredi</strong></p></div>
</article>
<article class="n-card challenges-card">
  <footer class="n-card__footer challenges-card__footer">
    <div class="challenges-card__date-group">
      <div class="challenges-card__date-label"><p>D&#xE9;fis en cours</p><p>Jusqu&#x2019;au 30 juin 2026</p></div>
    </div>
    <div class="challenges-card__amount-group">
      <div class="challenges-card__amount"><p class="text-headline-m">0.00 &#x20AC;</p></div>
    </div>
  </footer>
</article>
</body></html>
`;

describe('AuchanClient.getLoyaltyInfo', () => {
  it('fetche /fidelite/accueil et retourne les informations de fidélité parsées', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml(LOYALTY_HTML),
    );
    const info = await client.getLoyaltyInfo();

    expect(info.card.number).toBe('0000000000000');
    expect(info.card.holder).toBe('DOE John');
    expect(info.balance.amountCents).toBe(346);
    expect(info.balance.amountFormatted).toBe('3.46 €');
    expect(info.waoohAccountNumber).toBe('00000000');
    expect(info.jourW.active).toBe(true);
    expect(info.jourW.day).toBe('mercredi');
    expect(info.challenges.cagnotteCents).toBe(0);
    expect(info.challenges.deadline).toBe('30 juin 2026');
  });

  it('appelle bien GET /fidelite/accueil', async () => {
    const fetchFn = mockFetchHtml(LOYALTY_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getLoyaltyInfo();

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/fidelite/accueil');
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getLoyaltyInfo()).rejects.toThrow('HTTP 403');
  });
});

// ── getFavorites ──────────────────────────────────────────────────────────────

// getFavorites() enchaîne : liste des rayons → GET /journey (contexte actif) →
// un fragment par rayon (/wishlist/ajax/category/{id}).
function favShelf(id: string, title: string): string {
  return `
  <article class="wishlist-shelves shadow--light">
    <div class="wishlist-shelves__texts">
      <span class="wishlist-shelves__title bolder">${title}</span>
      <a class="wishlist-shelves__link" href="/ca-${id}">Voir le rayon</a>
    </div>
  </article>`;
}

const FAVORITES_LIST_HTML = `
<html><body>
${favShelf('n13', 'Eaux, jus, sodas, thés glacés')}
${favShelf('n06', 'Épicerie salée')}
</body></html>
`;

const JOURNEY_JSON = JSON.stringify({
  activeContexts: [
    { type: 'GROCERY', context: { seller: { id: 'seller-uuid' }, channels: ['PICK_UP'] } },
  ],
});

const FAV_FRAGMENT_N13 = `
<article class="product-thumbnail">
  <a href="/orangina-boisson-gazeuse-a-l-orange/pr-C1820950">Voir le produit</a>
  <p class="product-thumbnail__description"><strong>ORANGINA</strong> Boisson gazeuse à l'orange</p>
  <span class="product-attribute">1,5l</span>
  <div class="product-price">1,93 €</div>
  <div class="product-discount-label">-50% sur le 2ème</div>
  <div class="quantity-selector" data-product-id="uuid-orangina">Dans mon drive</div>
</article>
`;

const FAV_FRAGMENT_N06 = `
<article class="product-thumbnail">
  <a href="/panzani-pates-spaghetti/pr-C9876543">Voir le produit</a>
  <p class="product-thumbnail__description"><strong>PANZANI</strong> Pâtes spaghetti</p>
  <span class="product-attribute">500g</span>
  <div class="product-price">1,20 €</div>
  <div class="quantity-selector disabled" data-product-id="uuid-panzani">Indisponible</div>
</article>
`;

function favoritesMock(): typeof fetch {
  return mockFetchByUrl({
    '/journey': JOURNEY_JSON,
    '/wishlist/ajax/category/n13': FAV_FRAGMENT_N13,
    '/wishlist/ajax/category/n06': FAV_FRAGMENT_N06,
    '/client/mes-produits-preferes': FAVORITES_LIST_HTML,
  });
}

describe('AuchanClient.getFavorites', () => {
  it('fetche la liste des rayons puis un fragment par rayon, et retourne les favoris parsés', async () => {
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', favoritesMock());
    const favorites = await client.getFavorites();

    expect(favorites).toHaveLength(2);
    expect(favorites[0].name).toBe("Boisson gazeuse à l'orange");
    expect(favorites[0].brand).toBe('ORANGINA');
    expect(favorites[0].category).toBe('Eaux, jus, sodas, thés glacés');
    expect(favorites[0].price).toBe(193);
    expect(favorites[0].priceFormatted).toBe('1,93 €');
    expect(favorites[0].promo).toBe('-50% sur le 2ème');
    expect(favorites[0].productCode).toBe('C1820950');
    expect(favorites[0].available).toBe(true);

    expect(favorites[1].name).toBe('Pâtes spaghetti');
    expect(favorites[1].category).toBe('Épicerie salée');
    expect(favorites[1].available).toBe(false);
  });

  it('appelle bien GET /client/mes-produits-preferes puis /wishlist/ajax/category/{id}', async () => {
    const fetchFn = favoritesMock();
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getFavorites();

    const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls.map(([u]) => u as string);
    expect(calls[0]).toBe('https://www.auchan.fr/client/mes-produits-preferes');
    expect(calls.some((u) => u.includes('/wishlist/ajax/category/n13'))).toBe(true);
    expect(calls.some((u) => u.includes('/wishlist/ajax/category/n06'))).toBe(true);
    expect(calls.some((u) => u.includes('activeContexts=GROCERY--seller-uuid__PICK_UP'))).toBe(true);
  });

  it('retourne [] si la page ne contient aucun rayon', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body>Connectez-vous</body></html>'),
    );
    const favorites = await client.getFavorites();
    expect(favorites).toEqual([]);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getFavorites()).rejects.toThrow('HTTP 403');
  });
});

// ── getOrders ─────────────────────────────────────────────────────────────────

function orderItem(ref: string, num: string, date: string, status: string): string {
  return `
  <li class="t-orders__item" data-fetch="/customer/async/orders/details/${ref}/${num}/false">
    <div class="p-order">
      <div class="p-order__header">
        <div class="p-order__pointOfServiceAndReference">
          <div class="p-order__reference">Commande n&#xB0; ${num} du ${date}</div>
        </div>
      </div>
      <div class="a-simplifiedState"><span class="a-simplifiedState__label">${status}</span></div>
      <div class="p-order__footer"><div class="p-order__footerRight">
        <a href="/client/mes-commandes/${ref}/${num}">Voir le d&#xE9;tail</a>
      </div></div>
    </div>
  </li>`;
}

const ORDERS_HTML = `
<html><body><ul>
  ${orderItem('AROM-761999631', '370069704', '14 juin 2026', 'Enregistr&#xE9;e')}
  ${orderItem('AROM-123456789', '370000001', '2 mai 2026', 'Retir&#xE9;e')}
</ul></body></html>
`;

describe('AuchanClient.getOrders', () => {
  it('fetche /client/mes-commandes?days=90 par défaut et retourne les commandes parsées', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const orders = await client.getOrders();

    expect(orders).toHaveLength(2);
    expect(orders[0].orderRef).toBe('AROM-761999631');
    expect(orders[0].orderNumber).toBe('370069704');
    expect(orders[0].date).toBe('14 juin 2026');
    expect(orders[0].status).toBe('Enregistrée');
    expect(orders[0].detailUrl).toBe('/client/mes-commandes/AROM-761999631/370069704');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?days=90');
  });

  it('fetche ?days=10 pour la période "10days"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('10days');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?days=10');
  });

  it('fetche ?days=30 pour la période "30days"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('30days');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?days=30');
  });

  it('fetche ?days=180 pour la période "6months"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('6months');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?days=180');
  });

  it('fetche ?year=2025 pour la période "2025"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('2025');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?year=2025');
  });

  it('fetche ?year=2024 pour la période "2024"', async () => {
    const fetchFn = mockFetchHtml(ORDERS_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    await client.getOrders('2024');

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes?year=2024');
  });

  it('retourne [] si la page ne contient aucune commande', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body><ul></ul></body></html>'),
    );
    const orders = await client.getOrders();
    expect(orders).toEqual([]);
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getOrders()).rejects.toThrow('HTTP 403');
  });
});

// ── getOrderDetail ────────────────────────────────────────────────────────────

const ORDER_DETAIL_HTML = `
<html><body>
<div class="p-detail__simplifiedState">
  <div class="a-simplifiedState"><span class="a-simplifiedState__label">Enregistr&#xE9;e</span></div>
</div>
<div class="p-detail__deliveryDate">Retrait pr&#xE9;vu le: mardi 16 juin entre 17h00 et 17h30</div>
<div class="p-detail__addressesAndDelivery">
  <div class="p-detail__address"><strong>Magasin</strong>
    Auchan Drive Caluire<br>
    10 Chemin Jean Petit<br>
    69300 CALUIRE-ET-CUIRE
    <a class="p-detail__storeLink" href="/magasins/s-1234">Infos</a></div>
</div>
<div class="p-detail__totalAmount"><div class="a-amount">38.62 &#x20AC;</div></div>
<div class="p-detail__categoriesAndProductsWrapper">
  <script>
    const productUpdateDetail = {"product":{"name":"Chipolatas supérieures aux herbes","brand":{"name":"AUCHAN"},"category":{"level1":"Boucherie, volaille, poissonnerie"}}};

    window.G = window.G || {};
  </script>
  <aside class="m-productItem__aside">
    <div class="a-amount"><div class="a-amount__amount">8.34 €</div></div>
    <div class="p-detail__productQuantity">Quantit&#xE9; : 6</div>
  </aside>
</div>
</body></html>
`;

describe('AuchanClient.getOrderDetail', () => {
  it('fetche /client/mes-commandes/{ref}/{num} et retourne le détail parsé', async () => {
    const fetchFn = mockFetchHtml(ORDER_DETAIL_HTML);
    const client = new AuchanClient(fakeCookies(), fastThrottler(), 'https://www.auchan.fr', fetchFn);
    const detail = await client.getOrderDetail('AROM-761999631', '370069704');

    expect(detail.orderRef).toBe('AROM-761999631');
    expect(detail.orderNumber).toBe('370069704');
    expect(detail.storeName).toBe('Auchan Drive Caluire');
    expect(detail.status).toBe('Enregistrée');
    expect(detail.pickupSlot).toBe('Retrait prévu le: mardi 16 juin entre 17h00 et 17h30');
    expect(detail.total).toBe(3862);
    expect(detail.products).toHaveLength(1);
    expect(detail.products[0].name).toBe('Chipolatas supérieures aux herbes');
    expect(detail.products[0].quantity).toBe(6);

    const [url] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('https://www.auchan.fr/client/mes-commandes/AROM-761999631/370069704');
  });

  it('retourne un OrderDetail vide si la page ne contient rien', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchHtml('<html><body></body></html>'),
    );
    const detail = await client.getOrderDetail('REF', '000');
    expect(detail.products).toEqual([]);
    expect(detail.storeName).toBe('');
  });

  it('lève une erreur sur 403', async () => {
    const client = new AuchanClient(
      fakeCookies(),
      fastThrottler(),
      'https://www.auchan.fr',
      mockFetchError(403),
    );
    await expect(client.getOrderDetail('REF', '000')).rejects.toThrow('HTTP 403');
  });
});
