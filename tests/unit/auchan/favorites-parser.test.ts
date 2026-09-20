import { describe, it, expect } from 'vitest';
import { parseFavoriteCategories, parseFavoritesFragment } from '../../../src/auchan/favorites-parser.js';

// ─── parseFavoriteCategories ────────────────────────────────────────────────────
// HTML minimal reproduisant /client/mes-produits-preferes (refonte ~2026) : la page
// ne liste plus que les rayons ("wishlist-shelves"), les produits étant chargés à part.

function shelf(id: string, title: string): string {
  return `
  <article class="wishlist-shelves shadow--light" role="article">
    <div class="wishlist-shelves__texts">
      <span class="wishlist-shelves__title bolder">${title}</span>
      <a class="wishlist-shelves__link" href="/ca-${id}">Voir le rayon</a>
    </div>
  </article>`;
}

const CATEGORIES_HTML = `
<html><body>
${shelf('n02', 'Boucherie, volaille, poissonnerie')}
${shelf('n06', 'Épicerie salée')}
</body></html>
`;

describe('parseFavoriteCategories', () => {
  it('retourne un tableau vide sur une page sans rayon', () => {
    expect(parseFavoriteCategories('<html><body></body></html>')).toEqual([]);
  });

  it('extrait les rayons avec leur id et leur titre', () => {
    const categories = parseFavoriteCategories(CATEGORIES_HTML);
    expect(categories).toEqual([
      { id: 'n02', title: 'Boucherie, volaille, poissonnerie' },
      { id: 'n06', title: 'Épicerie salée' },
    ]);
  });
});

// ─── parseFavoritesFragment ─────────────────────────────────────────────────────
// HTML minimal reproduisant un fragment /wishlist/ajax/category/{id} : même carte
// "product-thumbnail" que sur /recherche.

const FULL_HTML = `
<html><body>
<article class="product-thumbnail">
  <a class="productThumbnailLink" href="/orangina-boisson-gazeuse-a-l-orange/pr-C1820950">Voir le produit</a>
  <p class="product-thumbnail__description"><strong>ORANGINA</strong> Boisson gazeuse à l'orange</p>
  <span class="product-attribute">1,5l</span>
  <div class="product-price">1,93 €</div>
  <span>0,86 € / l</span>
  <div class="product-discount-label">-50% sur le 2ème</div>
  <div class="quantity-selector" data-product-id="uuid-orangina" data-offer-id="offer-1" data-seller-id="seller-1" data-seller-type="GROCERY">Dans mon drive</div>
</article>

<article class="product-thumbnail">
  <a class="productThumbnailLink" href="/evian-eau-minerale-naturelle/pr-C1234567">Voir le produit</a>
  <p class="product-thumbnail__description"><strong>EVIAN</strong> Eau minérale naturelle</p>
  <span class="product-attribute">6x1,5l</span>
  <div class="product-price">3,50 €</div>
  <div class="quantity-selector" data-product-id="uuid-evian" data-offer-id="offer-2" data-seller-id="seller-1" data-seller-type="GROCERY">Dans mon drive</div>
</article>

<article class="product-thumbnail">
  <a class="productThumbnailLink" href="/panzani-pates-spaghetti/pr-C9876543">Voir le produit</a>
  <p class="product-thumbnail__description"><strong>PANZANI</strong> Pâtes spaghetti</p>
  <span class="product-attribute">500g</span>
  <div class="product-price">1,20 €</div>
  <div class="quantity-selector disabled" data-product-id="uuid-panzani" data-offer-id="offer-3" data-seller-id="seller-1" data-seller-type="GROCERY">Indisponible</div>
</article>
</body></html>
`;

describe('parseFavoritesFragment', () => {
  it('retourne un tableau vide sur un fragment sans produit', () => {
    expect(parseFavoritesFragment('<html><body></body></html>', 'Épicerie')).toEqual([]);
  });

  it('retourne 3 produits depuis le fragment complet', () => {
    const products = parseFavoritesFragment(FULL_HTML, 'Eaux, jus, sodas, thés glacés');
    expect(products).toHaveLength(3);
  });

  it('associe tous les produits à la catégorie passée en argument', () => {
    const products = parseFavoritesFragment(FULL_HTML, 'Eaux, jus, sodas, thés glacés');
    expect(products[0].category).toBe('Eaux, jus, sodas, thés glacés');
    expect(products[2].category).toBe('Eaux, jus, sodas, thés glacés');
  });

  it('extrait le nom sans la marque', () => {
    const [p] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p.name).toBe("Boisson gazeuse à l'orange");
  });

  it('extrait la marque séparément', () => {
    const [p] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p.brand).toBe('ORANGINA');
  });

  it('extrait le format du produit', () => {
    const [p] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p.format).toBe('1,5l');
  });

  it('parse le prix en centimes et conserve le prix formaté', () => {
    const [p] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p.price).toBe(193);
    expect(p.priceFormatted).toBe('1,93 €');
  });

  it('extrait le prix par unité', () => {
    const [p] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p.pricePerUnit).toBe('0,86 € / l');
  });

  it('retourne pricePerUnit undefined si absent', () => {
    const [, p2] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p2.pricePerUnit).toBeUndefined();
  });

  it('extrait la promotion du premier produit', () => {
    const [p] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p.promo).toBe('-50% sur le 2ème');
  });

  it('retourne promo undefined si absente', () => {
    const [, p2] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p2.promo).toBeUndefined();
  });

  it('extrait l\'URL et le code produit', () => {
    const [p] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p.productUrl).toBe('/orangina-boisson-gazeuse-a-l-orange/pr-C1820950');
    expect(p.productCode).toBe('C1820950');
  });

  it('available = true si quantity-selector sans disabled', () => {
    const [p] = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(p.available).toBe(true);
  });

  it('available = false si quantity-selector avec disabled', () => {
    const products = parseFavoritesFragment(FULL_HTML, 'cat');
    expect(products[2].name).toBe('Pâtes spaghetti');
    expect(products[2].available).toBe(false);
  });

  it('décode les entités HTML dans la marque', () => {
    const html = `
<html><body>
<article class="product-thumbnail">
  <a href="/elle-vire-beurre/pr-C1264653">Voir</a>
  <p class="product-thumbnail__description"><strong>ELLE &amp; VIRE</strong> Beurre doux</p>
  <div class="product-price">2,98 €</div>
  <div class="quantity-selector" data-product-id="uuid-1">Dans mon drive</div>
</article>
</body></html>`;
    const [p] = parseFavoritesFragment(html, 'Épicerie');
    expect(p.brand).toBe('ELLE & VIRE');
  });
});
