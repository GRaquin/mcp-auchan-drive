/**
 * orders-parser.ts — Parse le HTML de GET /client/mes-commandes
 * Même approche que loyalty-parser.ts : regex sur le HTML brut, pas de cheerio/jsdom.
 */

import type { Order } from '../types.js';
import { decode } from './html-utils.js';

export type { Order };

/**
 * Parse la page HTML de l'historique des commandes et retourne la liste des commandes.
 *
 * Structure HTML attendue (refonte site ~2026) :
 * ```html
 * <li class="t-orders__item" data-fetch="/customer/async/orders/details/AROM-766355541/374463269/false">
 *   <div class="p-order">
 *     <div class="p-order__header">
 *       ...
 *       <div class="p-order__reference">Commande n° 374463269 du 17 September 2026</div>
 *     </div>
 *     <div class="a-simplifiedState ..."><span class="a-simplifiedState__label">Retirée</span></div>
 *     ...
 *     <a href="/client/mes-commandes/AROM-766355541/374463269">Voir le détail</a>
 *   </div>
 * </li>
 * ```
 * Le nom du magasin, le nombre de produits et le total ne sont pas présents dans cette
 * liste (valeurs placeholder à 0 côté site, chargées en asynchrone) : utiliser
 * get_order_detail(orderRef, orderNumber) pour ces informations.
 */
export function parseOrdersPage(rawHtml: string): Order[] {
  const orders: Order[] = [];
  // Décodé en amont : les entités HTML (ex. "&#xB0;") contiennent des chiffres
  // qui perturbent les regex "[^0-9]*" utilisées plus bas.
  const html = decode(rawHtml);

  // Découpe le document en blocs <li class="t-orders__item" ...> ... prochain <li ...> / fin
  const itemStarts: number[] = [];
  const itemStartRe = /<li[^>]+class="[^"]*t-orders__item[^"]*"/g;
  let startM: RegExpExecArray | null;
  while ((startM = itemStartRe.exec(html)) !== null) {
    itemStarts.push(startM.index);
  }

  for (let i = 0; i < itemStarts.length; i++) {
    const start = itemStarts[i];
    const end = i + 1 < itemStarts.length ? itemStarts[i + 1] : html.length;
    const block = html.slice(start, end);

    // Référence + numéro de commande depuis l'attribut data-fetch
    const fetchM = block.match(
      /data-fetch="\/customer\/async\/orders\/details\/([^/]+)\/(\d+)\/[^"]*"/,
    );
    if (!fetchM) continue;
    const [, orderRef, orderNumber] = fetchM;

    // Date depuis "Commande n° 374463269 du 17 September 2026"
    const refM = block.match(/p-order__reference[^>]*>Commande\s+n°\s*\d+\s+du\s+([^<]+)</);
    const date = refM ? refM[1].trim() : '';

    // Statut depuis a-simplifiedState__label
    const statusM = block.match(/a-simplifiedState__label[^>]*>([^<]+)</);
    const status = statusM ? statusM[1].trim() : '';

    // Lien de détail (fallback : reconstruit depuis ref/numéro si absent)
    const hrefM = block.match(/href="(\/client\/mes-commandes\/[^"]+)"/);
    const detailUrl = hrefM ? hrefM[1] : `/client/mes-commandes/${orderRef}/${orderNumber}`;

    orders.push({
      orderRef,
      orderNumber,
      date,
      storeName: '',
      status,
      productCount: 0,
      total: 0,
      totalFormatted: '',
      detailUrl,
    });
  }

  return orders;
}
