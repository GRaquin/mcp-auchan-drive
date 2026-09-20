/**
 * parser.ts — Parse le HTML de GET /recherche?text=<query>
 * Pas de dépendance externe (pas de cheerio / jsdom) : regex sur le HTML brut.
 */

import { parsePrice, decode } from './html-utils.js';

export interface SearchProduct {
  productId: string;   // data-product-id
  offerId: string;     // data-offer-id
  sellerId: string;    // data-seller-id
  sellerType: string;  // data-seller-type
  name: string;        // p.product-thumbnail__description
  brand?: string;      // article > strong (premier)
  price: number;       // centimes — "2,98 €" → 298
  pricePerKg?: number; // centimes — "11,92 € / kg" → 1192
  format?: string;     // span.product-attribute
  available: boolean;  // true si pas class "disabled" sur le quantity-selector
  catalogCode?: string;// href="/produit/pr-C1264653" → "C1264653"
}

/** Extrait la valeur d'un attribut HTML depuis une balise ouvrante. */
function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`));
  return m?.[1];
}

/**
 * Parse le HTML brut de /recherche et retourne la liste des produits.
 * Stratégie :
 *   1. Trouver chaque <div class="quantity-selector" data-product-id="...">
 *   2. Extraire les data-attributes (productId, offerId, sellerId, sellerType)
 *   3. Analyser le contexte HTML autour de chaque sélecteur pour les autres champs
 */
export function parseSearchResults(html: string): SearchProduct[] {
  const products: SearchProduct[] = [];

  // Borne le contexte de chaque produit par les balises <article> (une carte produit
  // par <article>) plutôt qu'une fenêtre fixe : les cartes volumineuses (images en
  // plusieurs résolutions, widget d'avis, métadonnées JS...) dépassent facilement
  // quelques ko, ce qui faisait parfois déborder sur la carte précédente ou suivante.
  const articleStarts: number[] = [];
  const artRe = /<article/g;
  let artM: RegExpExecArray | null;
  while ((artM = artRe.exec(html)) !== null) articleStarts.push(artM.index);

  // Balise ouvrante du quantity-selector (chaque produit en a une)
  const tagRe = /<div[^>]+data-product-id="[^"]+"[^>]*>/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRe.exec(html)) !== null) {
    const tag = tagMatch[0];

    // Ignorer les balises sans class quantity-selector
    if (!tag.includes('quantity-selector')) continue;

    const productId = attr(tag, 'data-product-id');
    const offerId = attr(tag, 'data-offer-id');
    const sellerId = attr(tag, 'data-seller-id');
    const sellerType = attr(tag, 'data-seller-type');

    if (!productId || !offerId || !sellerId || !sellerType) continue;

    let start = 0;
    let end = html.length;
    if (articleStarts.length > 0) {
      for (const pos of articleStarts) {
        if (pos <= tagMatch.index) start = pos;
      }
      for (const pos of articleStarts) {
        if (pos > tagMatch.index) { end = pos; break; }
      }
    }
    const ctx = html.slice(start, end);

    // Nom du produit — extrait le contenu texte complet du paragraphe (strip balises enfants)
    const descM = ctx.match(/class="[^"]*product-thumbnail__description[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    const name = descM
      ? decode(descM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      : '';

    // Marque — cherche d'abord dans la description (structure actuelle), puis dans ctx (fallback)
    const brandM =
      (descM?.[1] ?? '').match(/<strong[^>]*>\s*([^<]+)\s*<\/strong>/) ??
      ctx.match(/<strong[^>]*>\s*([^<]+)\s*<\/strong>/);
    const brand = brandM ? decode(brandM[1].trim()) : undefined;

    // Prix principal
    const priceM = ctx.match(/class="[^"]*product-price[^"]*"[^>]*>\s*([\d\s,.'€]+)/);
    const price = priceM ? parsePrice(priceM[1]) : 0;

    // Prix au kilo
    const pkgM = ctx.match(/([\d]+[,.][\d]{2})\s*€\s*\/\s*kg/);
    const pricePerKg = pkgM ? parsePrice(pkgM[1]) : undefined;

    // Format / conditionnement
    const fmtM = ctx.match(/class="[^"]*product-attribute[^"]*"[^>]*>\s*([^<]+)/);
    const format = fmtM ? decode(fmtM[1].trim()) : undefined;

    // Code catalogue depuis href
    const hrefM = ctx.match(/href="[^"]*\/pr-(C\d+)/);
    const catalogCode = hrefM ? hrefM[1] : undefined;

    // Disponibilité
    const available = !tag.includes('disabled');

    products.push({
      productId,
      offerId,
      sellerId: sellerId ?? '',
      sellerType: sellerType ?? '',
      name,
      brand,
      price,
      pricePerKg,
      format,
      available,
      catalogCode,
    });
  }

  return products;
}
