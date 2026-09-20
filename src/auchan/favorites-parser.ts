/**
 * favorites-parser.ts — Parse les pages liées aux produits favoris (refonte site ~2026)
 *
 * Le site a remplacé l'ancienne page tout-en-un /client/mes-produits-preferes
 * (sections par catégorie avec produits inline) par une architecture en deux temps :
 *   1. GET /client/mes-produits-preferes renvoie seulement la liste des rayons
 *      ("wishlist-shelves"), chaque rayon ayant un id (ex. "n02") et un titre.
 *   2. Pour chaque rayon, les produits sont chargés en JS via
 *      GET /wishlist/ajax/category/{id}?activeContexts=...&newFav=true
 *      (fragment CREST, même structure de carte produit que /recherche).
 *
 * Voir client.ts#getFavorites() pour l'orchestration des deux étapes et le calcul
 * du paramètre activeContexts (contexte de drive actif, obligatoire).
 */

import type { FavoriteProduct } from '../types.js';
import { parsePrice, decode } from './html-utils.js';

export interface FavoriteCategory {
  id: string;
  title: string;
}

/** Extrait la liste des rayons ("Voir le rayon" → id + titre) de la page principale. */
export function parseFavoriteCategories(rawHtml: string): FavoriteCategory[] {
  const html = decode(rawHtml);
  const categories: FavoriteCategory[] = [];

  const blockStarts: number[] = [];
  const blockRe = /<article[^>]+class="[^"]*wishlist-shelves[^"]*"/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(html)) !== null) blockStarts.push(m.index);

  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i];
    const end = i + 1 < blockStarts.length ? blockStarts[i + 1] : html.length;
    const block = html.slice(start, end);

    const idM = block.match(/href="\/ca-([a-zA-Z0-9]+)"/);
    const titleM = block.match(/wishlist-shelves__title[^>]*>\s*([^<]+?)\s*</);
    if (!idM || !titleM) continue;

    categories.push({ id: idM[1], title: titleM[1].trim() });
  }

  return categories;
}

/**
 * Parse un fragment produit renvoyé par /wishlist/ajax/category/{id} : même carte
 * "product-thumbnail" que sur /recherche (voir parser.ts), avec en plus le lien produit
 * complet et une éventuelle promotion — champs propres à FavoriteProduct.
 */
export function parseFavoritesFragment(rawHtml: string, category: string): FavoriteProduct[] {
  const html = decode(rawHtml);
  const products: FavoriteProduct[] = [];

  // Borne le contexte de chaque produit par les balises <article> (une carte produit
  // par <article>) plutôt qu'une fenêtre fixe, pour éviter toute contamination entre
  // deux cartes proches l'une de l'autre.
  const articleStarts: number[] = [];
  const artRe = /<article/g;
  let artM: RegExpExecArray | null;
  while ((artM = artRe.exec(html)) !== null) articleStarts.push(artM.index);

  const tagRe = /<div[^>]+data-product-id="[^"]+"[^>]*>/g;
  let tagMatch: RegExpExecArray | null;

  while ((tagMatch = tagRe.exec(html)) !== null) {
    const tag = tagMatch[0];
    if (!tag.includes('quantity-selector')) continue;

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

    const descM = ctx.match(/product-thumbnail__description[^>]*>([\s\S]*?)<\/p>/);
    const descHtml = descM?.[1] ?? '';
    const brandM = descHtml.match(/<strong[^>]*>\s*([^<]+)\s*<\/strong>/);
    const brand = brandM ? brandM[1].trim() : undefined;
    const name = descHtml.replace(/<strong[^>]*>[\s\S]*?<\/strong>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) continue;

    const fmtM = ctx.match(/product-attribute[^>]*>\s*([^<]+?)\s*</);
    const format = fmtM ? fmtM[1].trim() : undefined;

    const priceM = ctx.match(/class="product-price[^"]*"[^>]*>\s*([\d\s,.'€]+)/);
    const priceFormatted = priceM ? priceM[1].trim() : '';
    const price = priceFormatted ? parsePrice(priceFormatted) : 0;

    const ppuM = ctx.match(/([\d]+[,.][\d]{2})\s*€\s*\/\s*(kg|l)/i);
    const pricePerUnit = ppuM ? `${ppuM[1]} € / ${ppuM[2]}` : undefined;

    const promoM = ctx.match(/product-discount-label[^>]*>\s*([^<]+?)\s*</);
    const promo = promoM ? promoM[1].trim() : undefined;

    const urlM = ctx.match(/href="(\/[^"]*\/pr-(C\d+))"/);
    const productUrl = urlM ? urlM[1] : '';
    const productCode = urlM ? urlM[2] : undefined;

    const qsM = ctx.match(/<div[^>]+class="[^"]*quantity-selector[^"]*"[^>]*>/);
    const available = qsM != null && !qsM[0].includes('disabled');

    products.push({
      name,
      brand,
      format,
      category,
      price,
      priceFormatted,
      pricePerUnit,
      promo,
      productUrl,
      productCode,
      available,
    });
  }

  return products;
}
