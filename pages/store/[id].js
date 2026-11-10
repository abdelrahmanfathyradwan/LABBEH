import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import Notice from '../../components/Notice';
import EmptyState from '../../components/EmptyState';
import ProductCard from '../../components/ProductCard';
import QuantitySelector from '../../components/QuantitySelector';
import { ListSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { currency } from '../../lib/format';
import { ArrowRight, MapPin, Phone, ShoppingBag, Store as StoreIcon, X, Clock, PackageCheck, PackageX } from 'lucide-react';

const CART_KEY = 'labbeh_cart';

export default function StorePage() {
  const router = useRouter();
  const { id } = router.query;
  const [store, setStore] = useState(null);
  const [products, setProducts] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedQty, setSelectedQty] = useState(1);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!id || !supabase) return undefined;
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const s = await supabase
          .from('stores')
          .select('*')
          .eq('id', id)
          .single();
        if (!alive) return;
        if (s.error) {
          setError('المتجر غير موجود أو غير متاح حاليًا.');
          return;
        }
        setStore(s.data);
        const p = await supabase
          .from('products')
          .select('id,name,description,price,old_price,stock,images,category')
          .eq('store_id', id)
          .eq('is_active', true)
          .order('created_at', { ascending: false });
        if (!alive) return;
        if (p.error) setError(p.error.message);
        setProducts(p.data || []);
      } catch (e) {
        if (alive) setError('تعذر تحميل المتجر. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const categories = useMemo(() => Array.from(new Set(products.map((p) => (p.category || '').trim()).filter(Boolean))), [products]);

  const grouped = useMemo(() => {
    const visible = activeCategory ? products.filter((p) => (p.category || '').trim() === activeCategory) : products;
    const groups = new Map();
    visible.forEach((p) => {
      const key = (p.category || '').trim() || 'منتجات أخرى';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    return Array.from(groups.entries());
  }, [products, activeCategory]);

  const readCart = () => {
    try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; }
  };

  const writeCart = (cart) => {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    window.dispatchEvent(new Event('labbeh-cart-updated'));
  };

  const addToCart = (product, quantity = 1) => {
    if (store?.is_open === false) {
      setNotice({ type: 'error', text: 'المتجر مغلق حاليًا. جرّب لاحقًا.' });
      return;
    }
    if (!product.stock || product.stock < 1) {
      setNotice({ type: 'error', text: 'هذا المنتج غير متوفر حاليًا.' });
      return;
    }
    let cart = readCart();
    if (cart.length && cart[0].store_id !== store.id) {
      if (!window.confirm('سلتك تحتوي منتجات من متجر آخر. هل تريد إفراغ السلة وإضافة منتج هذا المتجر؟')) return;
      cart = [];
    }
    const existing = cart.find((item) => item.id === product.id);
    const nextQty = (existing?.qty || 0) + quantity;
    if (nextQty > product.stock) {
      setNotice({ type: 'error', text: `الكمية المتاحة من "${product.name}" هي ${product.stock} فقط.` });
      return;
    }
    if (existing) existing.qty = nextQty;
    else cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      store_id: product.store_id || store.id,
      image: product.images?.[0] || null,
      qty: quantity,
      stock: product.stock
    });
    writeCart(cart);
    setNotice({ type: 'success', text: `تمت إضافة "${product.name}" إلى السلة.` });
    setSelected(null);
  };

  const openProduct = (product) => {
    setSelected(product);
    setSelectedQty(1);
  };

  const catLabel = (label) => label || 'منتجات أخرى';

  return <Layout title={store?.name || 'المتجر'}>
    <div className="page-wrap store-page">
      <div className="container">
        <Link href="/" className="back-link"><ArrowRight size={16}/> العودة للرئيسية</Link>

        {error && <Notice type="error">{error} <button type="button" className="link-btn" onClick={() => router.reload()}>إعادة المحاولة</button></Notice>}
        {notice && <Notice type={notice.type} onClose={() => setNotice(null)}>{notice.text}</Notice>}

        {loading ? (
          <div className="store-skeleton">
            <div className="skeleton skeleton-cover"/>
            <ListSkeleton rows={3}/>
          </div>
        ) : store ? (
          <>
            <div className="store-hero">
              <div className="store-cover">
                {store.cover_url ? <img src={store.cover_url} alt={`صورة ${store.name}`}/> : <span className="cover-fallback"><StoreIcon size={52}/></span>}
              </div>
              <div className="store-head">
                <div className="store-logo">
                  {store.logo_url ? <img src={store.logo_url} alt={store.name}/> : <span>ل</span>}
                </div>
                <div className="store-head-info">
                  <div className="store-title-row">
                    <h1>{store.name}</h1>
                    <span className={store.is_open === false ? 'open-state closed' : 'open-state'}>
                      {store.is_open === false ? 'مغلق الآن' : 'مفتوح الآن'}
                    </span>
                  </div>
                  <p>{store.description || 'تسوق منتجات المتجر بسهولة من لبيه.'}</p>
                  <div className="store-meta">
                    <span><MapPin size={13}/> {store.area || 'عزان'}</span>
                    {store.category && <span><PackageCheck size={13}/> {store.category}</span>}
                    {store.phone && <a href={`tel:${store.phone}`}><Phone size={13}/> {store.phone}</a>}
                  </div>
                </div>
                <Link href="/cart" className="btn-gold store-cart-btn"><ShoppingBag size={16}/> السلة</Link>
              </div>
            </div>

            {store.is_open === false && <Notice type="info">المتجر مغلق حاليًا ولا يمكن استلام الطلبات حتى يفتح.</Notice>}

            {products.length > 0 && categories.length > 0 && (
              <div className="category-strip store-categories">
                <button type="button" className={!activeCategory ? 'category-chip active' : 'category-chip'} onClick={() => setActiveCategory('')}>الكل</button>
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={activeCategory === c ? 'category-chip active' : 'category-chip'}
                    onClick={() => setActiveCategory(activeCategory === c ? '' : c)}
                  >{c}</button>
                ))}
              </div>
            )}

            {!products.length ? (
              <EmptyState title="لا توجد منتجات متاحة حاليًا" icon={ShoppingBag}>
                يعمل المتجر على إضافة منتجاته. تفضل بالعودة لاحقًا.
              </EmptyState>
            ) : (
              grouped.map(([category, items]) => (
                <section className="store-section" key={category}>
                  <h2 className="store-section-title">{catLabel(category)}</h2>
                  <div className="product-grid">
                    {items.map((p) => {
                      const out = !p.stock || p.stock < 1;
                      return (
                        <ProductCard
                          key={p.id}
                          product={p}
                          onOpen={() => openProduct(p)}
                          badge={out ? <span className="stock-badge">غير متوفر</span> : null}
                          actions={(
                            <>
                              <button type="button" className="btn-outline" onClick={() => openProduct(p)}>التفاصيل</button>
                              <button
                                type="button"
                                className="btn-primary"
                                disabled={out || store.is_open === false}
                                onClick={() => addToCart(p, 1)}
                              >{out ? 'غير متوفر' : 'أضف للسلة'}</button>
                            </>
                          )}
                        />
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </>
        ) : (
          <EmptyState title="تعذر عرض المتجر" icon={PackageX}>قد يكون المتجر موقوفًا أو الرابط غير صحيح.</EmptyState>
        )}
      </div>

      {selected && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={selected.name} onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => setSelected(null)} aria-label="إغلاق"><X size={18}/></button>
            <div className="modal-image">
              {selected.images?.[0] ? <img src={selected.images[0]} alt={selected.name}/> : <ShoppingBag size={56}/>}
            </div>
            <h2>{selected.name}</h2>
            <p className="muted">{selected.description || 'لا يوجد وصف إضافي لهذا المنتج.'}</p>
            <div className="modal-price">
              {currency(selected.price)}
              {selected.old_price ? <s>{currency(selected.old_price)}</s> : null}
            </div>
            <p className="small" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={13}/> المتوفر في المخزون: {selected.stock}
            </p>
            <QuantitySelector
              value={selectedQty}
              onChange={setSelectedQty}
              min={1}
              max={Math.max(1, selected.stock)}
              label="كمية المنتج"
            />
            <button
              type="button"
              className="btn-gold w-full"
              disabled={selected.stock < 1 || store?.is_open === false}
              onClick={() => addToCart(selected, selectedQty)}
            >
              <ShoppingBag size={17}/> أضف إلى السلة — {currency(selected.price * selectedQty)}
            </button>
          </div>
        </div>
      )}
    </div>
  </Layout>;
}
