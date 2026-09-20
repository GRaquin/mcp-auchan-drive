import { describe, it, expect } from 'vitest';
import { parseLoyaltyHistoryPage } from '../../../src/auchan/loyalty-history-parser.js';

// HTML minimal reproduisant la structure réelle de /fidelite/ma-carte/historique?id=...
// (refonte ~2026, classes "m-waaohHistory__"). Contient 5 transactions mixtes (gains + débits).
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

const FULL_HTML = `
<html><body><div role="list">
  ${historyItem('04/06/2026', 'Drive', 'Auchan Drive Saint-Genis (Chapônost)', '+0.53')}
  ${historyItem('01/06/2026', 'Magasin', 'Auchan Supermarché Lyon Garibaldi', '+1.20')}
  ${historyItem('28/05/2026', 'Drive', 'Auchan Drive Saint-Genis (Chapônost)', '-2.00')}
  ${historyItem('15/05/2026', 'Magasin', 'Auchan Hypermarché Metz', '+5.48')}
  ${historyItem('10/05/2026', 'Drive', 'Auchan Drive Lille Nord', '-10.00')}
</div></body></html>
`;

const EMPTY_HTML = `<html><body><div role="list"></div></body></html>`;

describe('parseLoyaltyHistoryPage', () => {
  // ── Nombre de transactions ──────────────────────────────────────────────────

  it('retourne 5 transactions', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions).toHaveLength(5);
  });

  it('retourne un tableau vide si le HTML ne contient pas de lignes valides', () => {
    const transactions = parseLoyaltyHistoryPage(EMPTY_HTML);
    expect(transactions).toHaveLength(0);
  });

  it('retourne un tableau vide sur un HTML vide', () => {
    const transactions = parseLoyaltyHistoryPage('<html></html>');
    expect(transactions).toHaveLength(0);
  });

  // ── Première transaction (gain Drive) ─────────────────────────────────────

  it('extrait la date de la première transaction', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[0].date).toBe('04/06/2026');
  });

  it('extrait le canal de la première transaction', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[0].channel).toBe('Drive');
  });

  it('extrait le nom du magasin de la première transaction', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[0].storeName).toBe('Auchan Drive Saint-Genis (Chapônost)');
  });

  it('parse le montant positif en centimes', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[0].amountCents).toBe(53);
  });

  it('formate le montant positif avec signe +', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[0].amountFormatted).toBe('+0,53 €');
  });

  // ── Montants négatifs ──────────────────────────────────────────────────────

  it('parse le montant négatif en centimes signés', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[2].amountCents).toBe(-200);
  });

  it('formate le montant négatif avec signe -', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[2].amountFormatted).toBe('-2,00 €');
  });

  it('parse un débit de 10,00 € en centimes signés', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[4].amountCents).toBe(-1000);
    expect(transactions[4].amountFormatted).toBe('-10,00 €');
  });

  it('formate les montants sans signe explicite comme positifs (+)', () => {
    const html = `<html><body><div role="list">${historyItem('04/06/2026', 'Drive', 'Auchan Drive Test', '0.53')}</div></body></html>`;
    const transactions = parseLoyaltyHistoryPage(html);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].amountCents).toBe(53);
    expect(transactions[0].amountFormatted).toBe('+0,53 €');
  });

  // ── Deuxième transaction (gain Magasin) ───────────────────────────────────

  it('extrait le canal Magasin correctement', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[1].channel).toBe('Magasin');
  });

  it('parse un gain de 1,20 € en centimes', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[1].amountCents).toBe(120);
    expect(transactions[1].amountFormatted).toBe('+1,20 €');
  });

  // ── Quatrième transaction (gain 5,48 €) ───────────────────────────────────

  it('parse un gain de 5,48 € en centimes', () => {
    const transactions = parseLoyaltyHistoryPage(FULL_HTML);
    expect(transactions[3].amountCents).toBe(548);
    expect(transactions[3].amountFormatted).toBe('+5,48 €');
  });
});
