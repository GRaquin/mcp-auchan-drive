import { describe, it, expect } from 'vitest';
import { parseOrderDetailPage } from '../../../src/auchan/order-detail-parser.js';

// HTML minimal reproduisant la structure réelle de /client/mes-commandes/{ref}/{num}
// (refonte ~2026, classes "p-detail__"). Chaque produit est décrit par un objet JS
// embarqué (productUpdateDetail) suivi de son prix et de sa quantité commandée.
function productBlock(name: string, brand: string, category: string, price: string, quantity: number): string {
  const json = JSON.stringify({ product: { name, brand: { name: brand }, category: { level1: category } } });
  return `
  <script>
    const productUpdateDetail = ${json};

    window.G = window.G || {};
  </script>
  <aside class="m-productItem__aside">
    <div class="a-amount"><div class="a-amount__amount">${price}</div></div>
    <div class="p-detail__productQuantity">Quantit&#xE9; : ${quantity}</div>
  </aside>`;
}

const FULL_HTML = `
<html><body>
<div class="p-detail__simplifiedState">
  <div class="a-simplifiedState"><span class="a-simplifiedState__label">En cours de pr&#xE9;paration</span></div>
</div>
<div class="p-detail__deliveryDate">Retrait pr&#xE9;vu le: mardi 16 juin entre 17h00 et 17h30</div>
<div class="p-detail__addressesAndDelivery">
  <div class="p-detail__address"><strong>Magasin</strong>
    Auchan Drive Caluire<br>
    10 Chemin Jean Petit<br>
    69300 CALUIRE-ET-CUIRE
    <a class="p-detail__storeLink" href="/magasins/s-1234">Infos</a></div>
  <div class="p-detail__address"><strong>Adresse de facturation</strong>DUPONT Jean<br>1 rue Test<br>69000 LYON</div>
</div>
<div class="p-detail__totalAmount"><div class="a-amount">38.62 &#x20AC;</div></div>
<div class="p-detail__categoriesAndProductsWrapper">
  ${productBlock('Chipolatas supérieures aux herbes', 'AUCHAN', 'Boucherie, volaille, poissonnerie', '8.34 €', 6)}
  ${productBlock('Quiche lorraine 900g', 'MARIE', 'Boucherie, volaille, poissonnerie', '5.49 €', 1)}
  ${productBlock('Pâtes spaghetti', 'PANZANI', 'Épicerie salée', '2.40 €', 2)}
</div>
</body></html>
`;

const RETIRED_HTML = `
<html><body>
<div class="p-detail__simplifiedState">
  <div class="a-simplifiedState"><span class="a-simplifiedState__label">Retir&#xE9;e</span></div>
</div>
<div class="p-detail__addressesAndDelivery">
  <div class="p-detail__address"><strong>Magasin</strong>
    Auchan Drive Caluire<br>
    10 Chemin Jean Petit<br>
    69300 CALUIRE-ET-CUIRE
    <a class="p-detail__storeLink" href="/magasins/s-1234">Infos</a></div>
</div>
<div class="p-detail__totalAmount"><div class="a-amount">52.10 &#x20AC;</div></div>
<div class="p-detail__categoriesAndProductsWrapper">
  ${productBlock('Lait demi-écrémé 6×1l', 'AUCHAN', 'Crèmerie, œufs', '4.99 €', 1)}
</div>
</body></html>
`;

describe('parseOrderDetailPage', () => {
  // ── Identifiants ───────────────────────────────────────────────────────────

  it('propage orderRef et orderNumber tels quels', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'AROM-761999631', '370069704');
    expect(d.orderRef).toBe('AROM-761999631');
    expect(d.orderNumber).toBe('370069704');
  });

  // ── Statut ────────────────────────────────────────────────────────────────

  it('extrait le statut courant', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.status).toBe('En cours de préparation');
  });

  it('extrait le statut "Retirée"', () => {
    const d = parseOrderDetailPage(RETIRED_HTML, 'R', '1');
    expect(d.status).toBe('Retirée');
  });

  // ── Créneau de retrait ────────────────────────────────────────────────────

  it('extrait le créneau de retrait', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.pickupSlot).toBe('Retrait prévu le: mardi 16 juin entre 17h00 et 17h30');
  });

  it('pickupSlot est undefined si absent de la page', () => {
    const d = parseOrderDetailPage(RETIRED_HTML, 'R', '1');
    expect(d.pickupSlot).toBeUndefined();
  });

  // ── Magasin ────────────────────────────────────────────────────────────────

  it('extrait le nom du magasin', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.storeName).toBe('Auchan Drive Caluire');
  });

  it('extrait l\'adresse du magasin (sans l\'adresse de facturation)', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.storeAddress).toBe('10 Chemin Jean Petit, 69300 CALUIRE-ET-CUIRE');
  });

  // ── Total ─────────────────────────────────────────────────────────────────

  it('parse le total en centimes', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.total).toBe(3862);
  });

  it('conserve le total formaté', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.totalFormatted).toBe('38.62 €');
  });

  // ── Produits ──────────────────────────────────────────────────────────────

  it('retourne 3 produits au total', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products).toHaveLength(3);
  });

  it('extrait le nom du premier produit', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].name).toBe('Chipolatas supérieures aux herbes');
  });

  it('extrait la marque du premier produit', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].brand).toBe('AUCHAN');
  });

  it('extrait la quantité', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].quantity).toBe(6);
    expect(d.products[1].quantity).toBe(1);
  });

  it('parse le prix en centimes', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].price).toBe(834);
  });

  it('conserve le prix formaté', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].priceFormatted).toBe('8.34 €');
  });

  // ── Catégories ────────────────────────────────────────────────────────────

  it('associe les produits à la bonne catégorie', () => {
    const d = parseOrderDetailPage(FULL_HTML, 'R', '1');
    expect(d.products[0].category).toBe('Boucherie, volaille, poissonnerie');
    expect(d.products[1].category).toBe('Boucherie, volaille, poissonnerie');
    expect(d.products[2].category).toBe('Épicerie salée');
  });

  // ── Page vide ─────────────────────────────────────────────────────────────

  it('retourne un OrderDetail vide sur page sans produit', () => {
    const d = parseOrderDetailPage('<html><body></body></html>', 'REF', '000');
    expect(d.products).toEqual([]);
    expect(d.storeName).toBe('');
    expect(d.total).toBe(0);
  });
});
