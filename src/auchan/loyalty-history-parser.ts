/**
 * loyalty-history-parser.ts — Parse le HTML de GET /fidelite/ma-carte/historique?id={waoohAccountNumber}
 * Même approche que loyalty-parser.ts : regex sur le HTML brut, pas de cheerio/jsdom.
 *
 * Important : le paramètre "id" (numéro de compte Waaoh, voir getLoyaltyInfo().waoohAccountNumber)
 * est obligatoire — sans lui, le site retourne une page éditoriale générique (subType "EDITORIAL")
 * au lieu de l'historique personnel.
 */

import type { LoyaltyTransaction } from '../types.js';
import { parsePrice, decode } from './html-utils.js';

export type { LoyaltyTransaction };

/**
 * Structure HTML attendue (refonte site ~2026, classes "m-waaohHistory__") :
 * ```html
 * <div class="m-waaohHistory" role="listitem">
 *   <div class="m-waaohHistory__date">17/09/2026</div>
 *   <div class="m-waaohHistory__deliveryType">Drive</div>
 *   <div class="m-waaohHistory__deliveryPlace">Auchan Drive Supermarché Villefranche</div>
 *   <div class="m-waaohHistory__amount -minus">-6.04</div>
 * </div>
 * ```
 */
export function parseLoyaltyHistoryPage(rawHtml: string): LoyaltyTransaction[] {
  const transactions: LoyaltyTransaction[] = [];
  const html = decode(rawHtml);

  const itemStarts: number[] = [];
  const itemStartRe = /<div[^>]+class="[^"]*m-waaohHistory[^_][^"]*"/g;
  let startM: RegExpExecArray | null;
  while ((startM = itemStartRe.exec(html)) !== null) {
    itemStarts.push(startM.index);
  }

  for (let i = 0; i < itemStarts.length; i++) {
    const start = itemStarts[i];
    const end = i + 1 < itemStarts.length ? itemStarts[i + 1] : html.length;
    const block = html.slice(start, end);

    const dateM = block.match(/m-waaohHistory__date"[^>]*>\s*([^<]+?)\s*</);
    const date = dateM ? dateM[1].trim() : '';
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) continue;

    const channelM = block.match(/m-waaohHistory__deliveryType"[^>]*>\s*([^<]+?)\s*</);
    const channel = channelM ? channelM[1].trim() : '';

    const storeNameM = block.match(/m-waaohHistory__deliveryPlace"[^>]*>\s*([^<]+?)\s*</);
    const storeName = storeNameM ? storeNameM[1].trim() : '';

    const amountM = block.match(/m-waaohHistory__amount[^"]*"[^>]*>\s*([+-]?[\d.,]+)\s*</);
    if (!amountM) continue;
    const rawAmount = amountM[1].trim();

    const isNegative = rawAmount.startsWith('-');
    const numPart = rawAmount.replace(/^[+-]/, '');
    if (!/^\d+[,.]\d{2}$/.test(numPart)) continue;

    const absCents = parsePrice(numPart);
    const amountCents = isNegative ? -absCents : absCents;

    const sign = isNegative ? '-' : '+';
    const euros = Math.floor(absCents / 100);
    const cents = String(absCents % 100).padStart(2, '0');
    const amountFormatted = `${sign}${euros},${cents} €`;

    transactions.push({ date, channel, storeName, amountCents, amountFormatted });
  }

  return transactions;
}
