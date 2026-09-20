/**
 * loyalty-parser.ts — Parse le HTML de GET /fidelite/accueil
 * Même approche que parser.ts : regex sur le HTML brut, pas de cheerio/jsdom.
 */

import type { LoyaltyInfo } from '../types.js';
import { parsePrice, decode } from './html-utils.js';

export type { LoyaltyInfo };

export function parseLoyaltyPage(rawHtml: string): LoyaltyInfo {
  // Décodé en amont : les entités HTML (ex. "&#xE9;") contiennent des chiffres
  // qui perturberaient des regex "[^0-9]*", et ça évite de décoder chaque capture.
  const html = decode(rawHtml);

  // ── Carte (refonte site ~2026 : classes "waaoh-card__" / "change-card__") ───
  const cardNumberM = html.match(/Carte N°\s*(\d+)/);
  const cardNumber = cardNumberM?.[1] ?? '';

  // Prénom + nom depuis les deux <p class="change-card__name"> de la carte sélectionnée
  const nameMatches = [...html.matchAll(/change-card__name[^>]*>([^<]+)</g)];
  const cardHolder = nameMatches.map((m) => m[1].trim()).filter(Boolean).join(' ');

  // ── Cagnotte principale ───────────────────────────────────────────────────
  const balanceM = html.match(/waaoh-card__reward-amount[^>]*>([^<]+)</);
  const balanceFormatted = balanceM ? balanceM[1].trim() : '0,00 €';
  const balanceCents = parsePrice(balanceFormatted);

  // Pas de date "au JJ/MM/AAAA" dans la nouvelle UI, seulement une date d'expiration
  // (ex. "Jusqu'au 31/01/2027") : on la laisse vide plutôt que de mal l'étiqueter.
  const balanceDate = '';

  // ── Numéro de compte Waooh ───────────────────────────────────────────────
  const waoohM = html.match(/de compte Waaoh!?\s*:\s*(\d+)/i);
  const waoohAccountNumber = waoohM?.[1] ?? '';

  // ── Jour W! ───────────────────────────────────────────────────────────────
  const dayM = html.match(/Mon jour W!\s*:\s*<strong>([^<]+)<\/strong>/);
  const jourWDay = dayM?.[1]?.trim();
  const jourWActive = Boolean(jourWDay);

  const benefitM = html.match(/id="n-card-selected-day-title"[^>]*>([^<]+)</);
  const jourWBenefit = benefitM?.[1]?.trim();

  // ── Défis Waaoh ──────────────────────────────────────────────────────────
  // Deadline : "Jusqu'au 31/10/2026" dans challenges-card__date-label
  const challengeDeadlineM = html.match(/challenges-card__date-label[^>]*>[\s\S]{0,80}?Jusqu.au ([^<]+)</);
  const challengeDeadline = challengeDeadlineM?.[1]?.trim();

  // Montant dans challenges-card__amount
  const challengeCagnotteM = html.match(/challenges-card__amount[^>]*>[\s\S]{0,120}?>([\d,. ]+€)</);
  const challengeCagnotteFormatted = challengeCagnotteM?.[1]?.trim() ?? '0,00 €';
  const challengeCagnotteCents = parsePrice(challengeCagnotteFormatted);

  return {
    card: { number: cardNumber, holder: cardHolder },
    balance: {
      amountCents: balanceCents,
      amountFormatted: balanceFormatted,
      balanceDate,
    },
    waoohAccountNumber,
    jourW: {
      active: jourWActive,
      day: jourWDay,
      benefit: jourWBenefit,
    },
    challenges: {
      cagnotteCents: challengeCagnotteCents,
      cagnotteFormatted: challengeCagnotteFormatted,
      deadline: challengeDeadline,
    },
  };
}
