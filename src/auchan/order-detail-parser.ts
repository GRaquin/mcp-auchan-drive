/**
 * order-detail-parser.ts — Parse le HTML de GET /client/mes-commandes/{ref}/{num}
 * Même approche que les autres parsers : regex sur le HTML brut, pas de cheerio/jsdom.
 */

import type { OrderDetail, OrderProduct } from '../types.js';
import { parsePrice, decode } from './html-utils.js';

/**
 * Parse la page HTML de détail d'une commande (refonte site ~2026, classes "p-detail__").
 *
 * Structure HTML attendue :
 * ```html
 * <span class="a-simplifiedState__label">Retirée</span>
 * <div class="p-detail__deliveryDate">Retrait prévu le: Thursday 17 September entre 09h00 et 09h30</div>
 * <div class="p-detail__address"><strong>Magasin</strong>
 *   Auchan Drive Supermarché Villefranche<br>420 Rue Philippe Héron<br>69400 VILLEFRANCHE-SUR-SAÔNE
 *   <a class="p-detail__storeLink" ...>Infos</a></div>
 * <div class="p-detail__totalAmount"><div class="a-amount">6.04 €</div></div>
 *
 * <!-- Par produit : un <script> avec un objet JS/JSON productUpdateDetail, suivi du
 *      prix (a-amount__amount) et de la quantité (p-detail__productQuantity) -->
 * const productUpdateDetail = {"product":{"name":"...","brand":{"name":"..."},
 *   "category":{"level1":"..."},"id":{"ref_fo":"C1184246"}}};
 * ...
 * <div class="a-amount__amount">2.65 €</div>
 * <div class="p-detail__productQuantity">Quantité : 1</div>
 * ```
 */
export function parseOrderDetailPage(
  rawHtml: string,
  orderRef: string,
  orderNumber: string,
): OrderDetail {
  // Décodé en amont : les entités HTML contiennent des chiffres qui perturberaient
  // des regex "[^0-9]*". Sans effet sur les échappements JS ("û") des <script>.
  const html = decode(rawHtml);

  // ── Statut (état simplifié affiché en haut de la page) ────────────────────────
  const statusM = html.match(/a-simplifiedState__label[^>]*>([^<]+)</);
  const status = statusM ? statusM[1].trim() : '';

  // ── Créneau de retrait/livraison ───────────────────────────────────────────────
  const pickupM = html.match(/p-detail__deliveryDate[^>]*>([^<]+)</);
  const pickupSlot = pickupM ? pickupM[1].trim().replace(/\s+/g, ' ') : undefined;

  // ── Magasin : nom + adresse (bloc "Magasin", distinct du bloc "Adresse de facturation") ──
  const storeBlockM = html.match(
    /<strong>Magasin<\/strong>\s*([^<]+)<br\s*\/?>([\s\S]*?)<a class="p-detail__storeLink"/,
  );
  const storeName = storeBlockM ? storeBlockM[1].trim() : '';
  const storeAddress = storeBlockM
    ? storeBlockM[2].replace(/<br\s*\/?>/g, ', ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().replace(/^,\s*/, '')
    : '';

  // ── Total ─────────────────────────────────────────────────────────────────────
  const totalM = html.match(/p-detail__totalAmount[^>]*>[\s\S]{0,60}?a-amount[^>]*>([^<]+)</);
  const totalFormatted = totalM ? totalM[1].trim() : '';
  const total = parsePrice(totalFormatted);

  // ── Produits ──────────────────────────────────────────────────────────────────
  const products = parseProducts(html);

  return {
    orderNumber,
    orderRef,
    storeName,
    storeAddress,
    status,
    pickupSlot,
    total,
    totalFormatted,
    products,
  };
}

/**
 * Chaque produit est décrit par un objet JS embarqué (productUpdateDetail), suivi
 * dans le HTML par son prix et sa quantité commandée.
 */
function parseProducts(html: string): OrderProduct[] {
  const products: OrderProduct[] = [];

  const detailRe = /const productUpdateDetail = (\{[\s\S]*?\});\s*window\.G = window\.G/g;
  const matches = [...html.matchAll(detailRe)];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const windowEnd = i + 1 < matches.length ? matches[i + 1].index! : Math.min(html.length, match.index! + 4000);
    const windowHtml = html.slice(match.index!, windowEnd);

    let parsed: {
      product?: {
        name?: string;
        brand?: { name?: string };
        category?: { level1?: string };
        price?: { displayed_tax?: number };
      };
    };
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      continue;
    }

    const name = parsed.product?.name?.trim();
    if (!name) continue;
    const brand = parsed.product?.brand?.name ?? '';
    const category = parsed.product?.category?.level1 ?? '';

    const priceM = windowHtml.match(/a-amount__amount[^>]*>([^<]+)</);
    const priceFormatted = priceM ? priceM[1].trim() : '';
    const price = priceFormatted ? parsePrice(priceFormatted) : 0;

    const qtyM = windowHtml.match(/p-detail__productQuantity[^>]*>[^:]*:\s*(\d+)/);
    const quantity = qtyM ? parseInt(qtyM[1], 10) : 1;

    products.push({ name, brand, quantity, price, priceFormatted, category });
  }

  return products;
}
