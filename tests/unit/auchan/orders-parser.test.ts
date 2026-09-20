import { describe, it, expect } from 'vitest';
import { parseOrdersPage } from '../../../src/auchan/orders-parser.js';

// HTML minimal reproduisant la structure réelle de /client/mes-commandes (refonte ~2026,
// classes "p-order__" / "a-simplifiedState__"). Le nom du magasin, le nombre de produits et
// le total ne sont plus présents dans cette liste (chargés en asynchrone côté site) :
// voir get_order_detail pour ces champs.
function orderItem(ref: string, num: string, date: string, status: string): string {
  return `
  <li class="t-orders__item" data-fetch="/customer/async/orders/details/${ref}/${num}/false" data-renderer="customer-renderer">
    <div class="p-order">
      <div class="p-order__header">
        <div class="p-order__pointOfServiceAndReference">
          <div class="a-pointOfService"><span class="a-pointOfService__label">Drive</span></div>
          <div class="p-order__reference">Commande n&#xB0; ${num} du ${date}</div>
        </div>
      </div>
      <div class="a-simplifiedState"><span class="a-simplifiedState__label">${status}</span></div>
      <div class="p-order__footer">
        <div class="p-order__footerRight">
          <a href="/client/mes-commandes/${ref}/${num}" class="btn btn--white">Voir le d&#xE9;tail</a>
        </div>
      </div>
    </div>
  </li>`;
}

const THREE_ORDERS_HTML = `
<html><body><ul>
  ${orderItem('AROM-761999631', '370069704', '14 juin 2026', 'Enregistr&#xE9;e')}
  ${orderItem('AROM-123456789', '370000001', '2 mai 2026', 'Retir&#xE9;e')}
  ${orderItem('AROM-987654321', '369000002', '10 avril 2026', 'Annul&#xE9;e')}
</ul></body></html>
`;

const SINGLE_ORDER_HTML = `
<html><body><ul>
  ${orderItem('AROM-111111111', '400000001', '16 juin 2026', 'En cours de pr&#xE9;paration')}
</ul></body></html>
`;

const EMPTY_HTML = `<html><body><ul></ul></body></html>`;

describe('parseOrdersPage', () => {
  it('retourne 3 commandes depuis le HTML avec 3 entrées', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders).toHaveLength(3);
  });

  it('extrait orderRef correctement', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].orderRef).toBe('AROM-761999631');
    expect(orders[1].orderRef).toBe('AROM-123456789');
    expect(orders[2].orderRef).toBe('AROM-987654321');
  });

  it('extrait orderNumber correctement', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].orderNumber).toBe('370069704');
    expect(orders[1].orderNumber).toBe('370000001');
    expect(orders[2].orderNumber).toBe('369000002');
  });

  it('extrait la date correctement', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].date).toBe('14 juin 2026');
    expect(orders[1].date).toBe('2 mai 2026');
    expect(orders[2].date).toBe('10 avril 2026');
  });

  it('extrait le statut', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].status).toBe('Enregistrée');
    expect(orders[1].status).toBe('Retirée');
    expect(orders[2].status).toBe('Annulée');
  });

  it('extrait l\'URL de détail', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].detailUrl).toBe('/client/mes-commandes/AROM-761999631/370069704');
    expect(orders[1].detailUrl).toBe('/client/mes-commandes/AROM-123456789/370000001');
  });

  // Magasin / nombre de produits / total : non disponibles sur la page liste
  // (placeholders côté site, chargés en asynchrone) — voir get_order_detail.
  it('laisse magasin/nombre de produits/total vides (non disponibles sur la liste)', () => {
    const orders = parseOrdersPage(THREE_ORDERS_HTML);
    expect(orders[0].storeName).toBe('');
    expect(orders[0].productCount).toBe(0);
    expect(orders[0].total).toBe(0);
  });

  it('parse le statut "En cours de préparation"', () => {
    const orders = parseOrdersPage(SINGLE_ORDER_HTML);
    expect(orders).toHaveLength(1);
    expect(orders[0].status).toBe('En cours de préparation');
    expect(orders[0].orderRef).toBe('AROM-111111111');
    expect(orders[0].orderNumber).toBe('400000001');
  });

  it('retourne [] pour une page sans commande', () => {
    const orders = parseOrdersPage(EMPTY_HTML);
    expect(orders).toEqual([]);
  });

  it('retourne [] pour un HTML vide', () => {
    const orders = parseOrdersPage('<html></html>');
    expect(orders).toEqual([]);
  });
});
