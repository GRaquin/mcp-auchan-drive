import { describe, it, expect } from 'vitest';
import { parseLoyaltyPage } from '../../../src/auchan/loyalty-parser.js';

// HTML minimal reproduisant la structure réelle de /fidelite/accueil (refonte ~2026,
// classes "waaoh-card__" / "change-card__" / "challenges-card__").
// Les valeurs sensibles ont été remplacées par des données fictives.
const FULL_HTML = `
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
      <p>N&#xB0; 0000000000000</p>
      <p class="waaoh-card__amount">3.46 &#x20AC;</p>
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

// Variante : Jour W! inactif, cagnotte non nulle sur les défis, champs absents
const PARTIAL_HTML = `
<html><body>
<article class="n-card waaoh-card">
  <div class="waaoh-card__reward">
    <p class="text-headline-m waaoh-card__reward-amount">12.50 &#x20AC;</p>
  </div>
</article>
<div class="waaoh-card__menu">
  <p class="text-body-s">N&#xB0; de compte Waaoh! : 99887766</p>
  <div class="change-card change-card--selected">
    <div class="change-card__info">
      <p class="change-card__name">DUPONT</p>
      <p class="change-card__name">Jean</p>
    </div>
  </div>
  <div class="waaoh-card__wallet"><p>Carte N&#xB0; 1234567890123</p></div>
</div>
<article class="n-card challenges-card">
  <footer class="n-card__footer challenges-card__footer">
    <div class="challenges-card__amount-group">
      <div class="challenges-card__amount"><p class="text-headline-m">5.00 &#x20AC;</p></div>
    </div>
  </footer>
</article>
</body></html>
`;

describe('parseLoyaltyPage', () => {
  // ── Carte ──────────────────────────────────────────────────────────────────

  it('extrait le numéro de carte', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.card.number).toBe('0000000000000');
  });

  it('extrait le nom du titulaire', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.card.holder).toBe('DOE John');
  });

  // ── Cagnotte principale ────────────────────────────────────────────────────

  it('extrait le montant de la cagnotte en centimes', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.balance.amountCents).toBe(346);
  });

  it('extrait le montant formaté de la cagnotte', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.balance.amountFormatted).toBe('3.46 €');
  });

  it('parse correctement une cagnotte à 12,50 €', () => {
    const info = parseLoyaltyPage(PARTIAL_HTML);
    expect(info.balance.amountCents).toBe(1250);
    expect(info.balance.amountFormatted).toBe('12.50 €');
  });

  // ── Waooh ─────────────────────────────────────────────────────────────────

  it('extrait le numéro de compte Waooh', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.waoohAccountNumber).toBe('00000000');
  });

  // ── Jour W! ────────────────────────────────────────────────────────────────

  it('détecte Jour W! actif', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.jourW.active).toBe(true);
  });

  it('extrait le jour de la semaine du Jour W!', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.jourW.day).toBe('mercredi');
  });

  it('extrait le bénéfice du Jour W!', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.jourW.benefit).toBe('10 % cagnottés sur tous les produits frais des Halles');
  });

  it('retourne Jour W! inactif si la phrase est absente', () => {
    const info = parseLoyaltyPage(PARTIAL_HTML);
    expect(info.jourW.active).toBe(false);
    expect(info.jourW.day).toBeUndefined();
    expect(info.jourW.benefit).toBeUndefined();
  });

  // ── Défis Waaoh ───────────────────────────────────────────────────────────

  it('extrait la deadline des défis', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.challenges.deadline).toBe('30 juin 2026');
  });

  it('extrait la cagnotte des défis en centimes', () => {
    const info = parseLoyaltyPage(FULL_HTML);
    expect(info.challenges.cagnotteCents).toBe(0);
    expect(info.challenges.cagnotteFormatted).toBe('0.00 €');
  });

  it('parse une cagnotte défis non nulle', () => {
    const info = parseLoyaltyPage(PARTIAL_HTML);
    expect(info.challenges.cagnotteCents).toBe(500);
    expect(info.challenges.cagnotteFormatted).toBe('5.00 €');
  });

  it('retourne deadline undefined si absente', () => {
    const info = parseLoyaltyPage(PARTIAL_HTML);
    expect(info.challenges.deadline).toBeUndefined();
  });

  // ── Robustesse ─────────────────────────────────────────────────────────────

  it('retourne des valeurs par défaut sur un HTML vide', () => {
    const info = parseLoyaltyPage('<html></html>');
    expect(info.card.number).toBe('');
    expect(info.card.holder).toBe('');
    expect(info.balance.amountCents).toBe(0);
    expect(info.balance.amountFormatted).toBe('0,00 €');
    expect(info.balance.balanceDate).toBe('');
    expect(info.waoohAccountNumber).toBe('');
    expect(info.jourW.active).toBe(false);
    expect(info.challenges.cagnotteCents).toBe(0);
  });
});
