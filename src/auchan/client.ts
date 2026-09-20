/**
 * client.ts — Client HTTP Auchan Drive
 *
 * Orchestre :
 *   - Throttler  : sérialisation des requêtes + retry anti-DataDome
 *   - CookieProvider : auth cookie (relecture Chrome si 403)
 *   - parser.ts  : HTML search → SearchProduct[]
 *   - cart-mapper.ts : JSON GET /cart → Cart
 */

import type { CookieProvider, Cart, FavoriteProduct, OrderPeriod, OrderDetail } from '../types.js';
import { Throttler } from './throttle.js';
import { parseSearchResults, type SearchProduct } from './parser.js';
import { mapCart, extractCartId } from './cart-mapper.js';
import { parseLoyaltyPage, type LoyaltyInfo } from './loyalty-parser.js';
import { parseFavoriteCategories, parseFavoritesFragment } from './favorites-parser.js';
import { parseOrdersPage, type Order } from './orders-parser.js';
import { parseLoyaltyHistoryPage, type LoyaltyTransaction } from './loyalty-history-parser.js';
import { parseOrderDetailPage } from './order-detail-parser.js';

// ─── Types internes ───────────────────────────────────────────────────────────

interface HttpError extends Error { status: number; }

interface RawCartLine {
  id: string;
  productId: string;
  offerId: string;
  desiredQuantity: number;
  desiredType: string;
  offering?: {
    context?: {
      seller?: { id: string; type: string };
    };
  };
}

interface RawCartInner {
  id: string;
  items?: RawCartLine[];
}

interface RawCartResponse {
  cart?: { cart?: RawCartInner };
}

// ─── AuchanClient ─────────────────────────────────────────────────────────────

export class AuchanClient {
  constructor(
    private readonly cookieProvider: CookieProvider,
    private readonly throttler: Throttler,
    private readonly baseUrl = 'https://www.auchan.fr',
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  // ── Requête HTTP de base (via throttler) ────────────────────────────────────

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    return this.throttler.run(async () => {
      const cookie = await this.cookieProvider.getCookie();
      const headers: Record<string, string> = {
        Cookie: cookie,
        'X-Requested-With': 'XMLHttpRequest',
        ...(init.headers as Record<string, string> | undefined),
      };

      const response = await this.fetchFn(url, { ...init, headers });

      if (!response.ok) {
        // 403 DataDome → invalider le cache de cookies pour le prochain retry
        if (response.status === 403) {
          this.cookieProvider.invalidate();
        }
        // Capture the response body to help diagnose unexpected errors (e.g. 404 on /boutique/promos)
        let body = '';
        try {
          const text = await response.clone().text();
          // Strip HTML tags and collapse whitespace for readability; cap at 300 chars
          body = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
        } catch { /* ignore body read errors */ }
        const detail = body ? ` — ${body}` : '';
        const err = new Error(`HTTP ${response.status}: ${response.statusText}${detail} [url: ${url}]`) as HttpError;
        err.status = response.status;
        throw err;
      }

      return response;
    });
  }

  // ── Extraction du consentId depuis le cookie header ─────────────────────────

  private extractConsentId(cookieHeader: string): string {
    const m = cookieHeader.match(/lark-consentId=([^;]+)/);
    return m?.[1] ?? '';
  }

  // ── GET /cart (raw JSON) — réutilisé par les mutations ─────────────────────

  private async getCartRaw(): Promise<RawCartResponse> {
    const response = await this.request(`${this.baseUrl}/cart`, {
      headers: { Accept: 'application/json' },
    });
    return response.json() as Promise<RawCartResponse>;
  }

  // ── API publique ────────────────────────────────────────────────────────────

  /** Recherche de produits dans le catalogue Drive. */
  async search(query: string): Promise<SearchProduct[]> {
    const response = await this.request(
      `${this.baseUrl}/recherche?text=${encodeURIComponent(query)}`,
      { headers: { Accept: 'text/html' } },
    );
    return parseSearchResults(await response.text());
  }

  /** Recherche de produits en promotion sur le drive actif. */
  async searchPromos(query?: string, category?: string): Promise<SearchProduct[]> {
    const params = new URLSearchParams();
    if (query) params.set('text', query);
    if (category) params.set('category', category);
    const qs = params.toString();
    const url = `${this.baseUrl}/boutique/promos${qs ? `?${qs}` : ''}`;
    const response = await this.request(url, { headers: { Accept: 'text/html' } });
    return parseSearchResults(await response.text());
  }

  /** Lecture du panier courant. */
  async getCart(): Promise<Cart> {
    return mapCart(await this.getCartRaw());
  }

  /** Informations du programme de fidélité (cagnotte, carte, Jour W!, défis). */
  async getLoyaltyInfo(): Promise<LoyaltyInfo> {
    const response = await this.request(`${this.baseUrl}/fidelite/accueil`, {
      headers: { Accept: 'text/html' },
    });
    return parseLoyaltyPage(await response.text());
  }

  /** Liste des produits favoris (achetés régulièrement) groupés par catégorie. */
  /**
   * Liste des produits favoris, groupés par rayon.
   *
   * Le site charge désormais les produits de chaque rayon en JS après coup (fragment
   * CREST par rayon), plutôt que de tout inclure dans la page /client/mes-produits-preferes.
   * On reproduit cette séquence : liste des rayons, puis un fragment par rayon, avec le
   * paramètre "activeContexts" (contexte du drive actif) obtenu depuis GET /journey.
   */
  async getFavorites(): Promise<FavoriteProduct[]> {
    const listResponse = await this.request(`${this.baseUrl}/client/mes-produits-preferes`, {
      headers: { Accept: 'text/html' },
    });
    const categories = parseFavoriteCategories(await listResponse.text());
    if (categories.length === 0) return [];

    const activeContexts = await this.fetchActiveContextsString();

    const products: FavoriteProduct[] = [];
    for (const category of categories) {
      const params = new URLSearchParams({ newFav: 'true' });
      if (activeContexts) params.set('activeContexts', activeContexts);
      const response = await this.request(
        `${this.baseUrl}/wishlist/ajax/category/${category.id}?${params}`,
        {
          headers: {
            Accept: 'application/crest',
            'X-Crest-Renderer': 'wishlist-renderer',
            Referer: `${this.baseUrl}/client/mes-produits-preferes`,
          },
        },
      );
      products.push(...parseFavoritesFragment(await response.text(), category.title));
    }
    return products;
  }

  /**
   * Reconstitue la chaîne "activeContexts" attendue par certains endpoints CREST
   * (ex. /wishlist/ajax/category/*), à partir du contexte de drive actif (GET /journey).
   * Reproduit JourneyService.getActiveContextsString() côté client JS du site.
   */
  private async fetchActiveContextsString(): Promise<string> {
    interface JourneyContext {
      type: string;
      context?: { seller?: { id?: string }; channels?: string[] };
    }
    interface JourneyResponse { activeContexts?: JourneyContext[] }

    try {
      const response = await this.request(`${this.baseUrl}/journey`, {
        headers: { Accept: 'application/json' },
      });
      const journey = (await response.json()) as JourneyResponse;
      const contexts = journey.activeContexts ?? [];
      return contexts
        .map((c) => {
          const sellerId = c.context?.seller?.id;
          const channels = c.context?.channels;
          const suffix = sellerId && channels?.length ? `--${sellerId}__${[...channels].sort().join('__')}` : '';
          return `${c.type}${suffix}`;
        })
        .sort()
        .join(',');
    } catch {
      return '';
    }
  }

  /** Historique des commandes drive. */
  async getOrders(period: OrderPeriod = '3months'): Promise<Order[]> {
    const queryString = this.buildOrdersPeriodQuery(period);
    const response = await this.request(
      `${this.baseUrl}/client/mes-commandes?${queryString}`,
      { headers: { Accept: 'text/html' } },
    );
    return parseOrdersPage(await response.text());
  }

  /** Détail complet d'une commande (produits, créneau de retrait, statut). */
  async getOrderDetail(orderRef: string, orderNumber: string): Promise<OrderDetail> {
    const response = await this.request(
      `${this.baseUrl}/client/mes-commandes/${orderRef}/${orderNumber}`,
      { headers: { Accept: 'text/html' } },
    );
    return parseOrderDetailPage(await response.text(), orderRef, orderNumber);
  }

  /** Convertit une période en query string pour l'API des commandes. */
  private buildOrdersPeriodQuery(period: OrderPeriod): string {
    switch (period) {
      case '10days':        return 'days=10';
      case '30days':        return 'days=30';
      case '3months':       return 'days=90';
      case '6months':       return 'days=180';
      case 'current_year':  return `year=${new Date().getFullYear()}`;
      case '2025':          return 'year=2025';
      case '2024':          return 'year=2024';
    }
  }


  /**
   * Historique des transactions de cagnotte (3 derniers mois).
   * Le paramètre "id" (numéro de compte Waaoh) est obligatoire côté site : sans lui,
   * la page retombe sur un contenu éditorial générique au lieu de l'historique personnel.
   */
  async getLoyaltyHistory(): Promise<LoyaltyTransaction[]> {
    const { waoohAccountNumber } = await this.getLoyaltyInfo();
    const response = await this.request(
      `${this.baseUrl}/fidelite/ma-carte/historique?id=${encodeURIComponent(waoohAccountNumber)}`,
      { headers: { Accept: 'text/html' } },
    );
    return parseLoyaltyHistoryPage(await response.text());
  }

  /** Ajout d'un produit au panier (sans id — article nouveau). */
  async addToCart(
    productId: string,
    offerId: string,
    sellerId: string,
    sellerType: string,
    quantity = 1,
  ): Promise<Cart> {
    const [raw, cookie] = await Promise.all([
      this.getCartRaw(),
      this.cookieProvider.getCookie(),
    ]);

    const body = JSON.stringify({
      cartId: extractCartId(raw),
      items: [{
        productId,
        offerId,
        sellerId,
        sellerType,
        desiredQuantity: quantity,
        desiredType: 'DEFAULT',
      }],
      consentId: this.extractConsentId(cookie),
      reservationId: null,
      mbaAvailabilityNeeded: true,
    });

    const response = await this.request(`${this.baseUrl}/cart/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    return mapCart(await response.json());
  }

  /** Mise à jour de la quantité d'un article déjà dans le panier. */
  async updateQuantity(productId: string, quantity: number): Promise<Cart> {
    if (quantity === 0) return this.removeFromCart(productId);

    const [raw, cookie] = await Promise.all([
      this.getCartRaw(),
      this.cookieProvider.getCookie(),
    ]);

    const line = this.findLine(raw, productId);
    const body = JSON.stringify({
      cartId: extractCartId(raw),
      items: [{
        id: line.id,
        productId,
        offerId: line.offerId,
        sellerId: line.offering?.context?.seller?.id ?? '',
        sellerType: line.offering?.context?.seller?.type ?? 'GROCERY',
        desiredQuantity: quantity,
        desiredType: 'DEFAULT',
      }],
      consentId: this.extractConsentId(cookie),
      reservationId: null,
      mbaAvailabilityNeeded: true,
    });

    const response = await this.request(`${this.baseUrl}/cart/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    return mapCart(await response.json());
  }

  /** Suppression d'un article du panier (desiredQuantity: 0). */
  async removeFromCart(productId: string): Promise<Cart> {
    const [raw, cookie] = await Promise.all([
      this.getCartRaw(),
      this.cookieProvider.getCookie(),
    ]);

    const line = this.findLine(raw, productId);
    const body = JSON.stringify({
      cartId: extractCartId(raw),
      items: [{
        id: line.id,
        productId,
        offerId: line.offerId,
        sellerId: line.offering?.context?.seller?.id ?? '',
        sellerType: line.offering?.context?.seller?.type ?? 'GROCERY',
        desiredQuantity: 0,
        desiredType: 'DEFAULT',
      }],
      consentId: this.extractConsentId(cookie),
      reservationId: null,
      mbaAvailabilityNeeded: true,
    });

    const response = await this.request(`${this.baseUrl}/cart/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    });
    return mapCart(await response.json());
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private findLine(raw: RawCartResponse, productId: string): RawCartLine {
    const lines = raw?.cart?.cart?.items ?? [];
    const line = lines.find((l) => l.productId === productId);
    if (!line) throw new Error(`Product ${productId} not found in cart`);
    return line;
  }
}
