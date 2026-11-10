import { ShoppingBasket, Store } from 'lucide-react';
import { currency } from '../lib/format';

export default function ProductCard({ product, storeName, onOpen, badge, actions }) {
  const image = product.images?.[0];
  const media = image
    ? <img src={image} alt={product.name} loading="lazy"/>
    : <ShoppingBasket size={30} aria-hidden="true"/>;

  return (
    <article className="product-card">
      {onOpen ? (
        <button type="button" className="product-image clickable" onClick={onOpen} aria-label={`تفاصيل ${product.name}`}>
          {media}
          {badge || null}
        </button>
      ) : (
        <div className="product-image">
          {media}
          {badge || null}
        </div>
      )}
      <div className="product-info">
        {storeName && <p className="product-store-name"><Store size={11}/> {storeName}</p>}
        <h3>{product.name}</h3>
        {product.description ? <p>{product.description}</p> : null}
        <div className="product-price">
          {currency(product.price)}
          {product.old_price ? <s>{currency(product.old_price)}</s> : null}
        </div>
        {actions ? <div className="product-actions">{actions}</div> : null}
      </div>
    </article>
  );
}
