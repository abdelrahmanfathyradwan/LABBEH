import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import EmptyState from '../components/EmptyState';
import SearchBar from '../components/SearchBar';
import SectionHeader from '../components/SectionHeader';
import StoreCard from '../components/StoreCard';
import ProductCard from '../components/ProductCard';
import { StoreSkeleton, ListSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/useAuth';
import { haversineKm, safeError } from '../lib/format';
import {
  MapPin, Store, ShoppingBasket, Pill, CakeSlice, Shirt, ArrowLeft, Tags,
  Utensils, Navigation, RefreshCw, NotebookPen, ShoppingBag, Star, Truck, ClipboardList, PackageOpen
} from 'lucide-react';

const categoryIcons = {
  'مطاعم': Utensils,
  'سوبرماركت': ShoppingBasket,
  'حلويات': CakeSlice,
  'صيدلية': Pill,
  'ملابس': Shirt
};

const fallbackCategories = ['مطاعم', 'سوبرماركت', 'حلويات', 'صيدلية', 'ملابس'];

export default function Home() {
  const { profile } = useAuth();
  const [stores, setStores] = useState([]);
  const [products, setProducts] = useState([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [userLoc, setUserLoc] = useState(null);
  const [locError, setLocError] = useState('');

  useEffect(() => {
    if (!supabase) { setLoading(false); setError('إعدادات Supabase غير مكتملة.'); return undefined; }
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const [s, p] = await Promise.all([
          supabase.from('stores')
            .select('*')
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(24),
          supabase.from('products')
            .select('*')
            .eq('is_active', true)
            .gt('stock', 0)
            .order('created_at', { ascending: false })
            .limit(24)
        ]);
        if (!alive) return;
        if (s.error) setError(safeError(s.error));
        else if (p.error) setError(safeError(p.error));
        setStores(s.data || []);
        setProducts(p.data || []);
      } catch (e) {
        if (alive) setError(safeError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reloadKey]);

  const categories = useMemo(() => {
    const set = new Set();
    stores.forEach((s) => s.category && set.add(s.category.trim()));
    products.forEach((p) => p.category && set.add(p.category.trim()));
    const dynamic = Array.from(set);
    return dynamic.length ? dynamic : fallbackCategories;
  }, [stores, products]);

  const storeById = useMemo(() => Object.fromEntries(stores.map((s) => [s.id, s])), [stores]);

  const storesWithDistance = useMemo(() => {
    return stores.map((s) => ({
      ...s,
      distance: userLoc ? haversineKm(userLoc.lat, userLoc.lng, s.lat, s.lng) : null
    }));
  }, [stores, userLoc]);

  const filteredStores = useMemo(() => {
    const q = search.trim();
    const rows = storesWithDistance.filter((s) => {
      const matchesSearch = !q || `${s.name} ${s.category || ''} ${s.description || ''} ${s.area || ''}`.includes(q);
      const matchesCategory = !category || (s.category || '').trim() === category;
      return matchesSearch && matchesCategory;
    });
    return rows.sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });
  }, [storesWithDistance, search, category]);

  const filteredProducts = useMemo(() => {
    const q = search.trim();
    return products.filter((p) => {
      const matchesSearch = !q || `${p.name} ${p.description || ''} ${p.category || ''}`.includes(q);
      const matchesCategory = !category || (p.category || '').trim() === category;
      return matchesSearch && matchesCategory;
    });
  }, [products, search, category]);

  const locate = () => {
    setLocError('');
    if (!navigator.geolocation) return setLocError('المتصفح لا يدعم تحديد الموقع.');
    navigator.geolocation.getCurrentPosition(
      (pos) => setUserLoc({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setLocError('تعذر تحديد موقعك. يمكنك التصفح دون ترتيب المسافات.'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const showFiltered = Boolean(search.trim() || category);
  const firstName = (profile?.full_name || '').trim().split(/\s+/)[0];

  return <Layout title="الرئيسية">
    <div className="home-shell">
      <section className="home-hero">
        <div className="home-hero-inner">
          <div className="home-topline">
            <div className="home-greet">
              <span className="home-hello">مرحبًا{firstName ? `، ${firstName}` : ' بك'}</span>
              <span className="home-sub">ماذا تحتاج أن نوصل إليك اليوم؟</span>
            </div>
            <button type="button" className="home-loc" onClick={locate}>
              <MapPin size={14}/>
              <span>توصيل إلى <b>عزّان، شبوة</b></span>
            </button>
          </div>

          <SearchBar value={search} onChange={setSearch} label="ابحث عن متجر أو منتج"/>

          <div className="home-promo">
            <span className="home-promo-icon"><ShoppingBag size={22}/></span>
            <div className="home-promo-copy">
              <b>كل ما تحتاجه من متاجر عزّان</b>
              <span>بقالة، مطاعم، صيدليات وطلبات خاصة</span>
            </div>
            <a href="#stores" className="home-promo-cta">تصفح المتاجر <ArrowLeft size={13}/></a>
          </div>
        </div>
      </section>

      <div className="home-content">
        <div className="category-grid" aria-label="التصنيفات">
          <button type="button" className={!category ? 'cat-tile active' : 'cat-tile'} onClick={() => setCategory('')}>
            <span className="cat-icon"><Tags size={19}/></span>
            الكل
          </button>
          {categories.slice(0, 5).map((label) => {
            const Icon = categoryIcons[label] || Store;
            return (
              <button
                key={label}
                type="button"
                className={category === label ? 'cat-tile active' : 'cat-tile'}
                onClick={() => setCategory(category === label ? '' : label)}
              >
                <span className="cat-icon"><Icon size={19}/></span>
                {label}
              </button>
            );
          })}
        </div>

        {error && (
          <Notice type="error">
            تعذر تحميل البيانات: {error}
            <button type="button" className="link-btn" onClick={() => setReloadKey((n) => n + 1)}><RefreshCw size={13}/> إعادة المحاولة</button>
          </Notice>
        )}
        {locError && <Notice type="info">{locError}</Notice>}

        <section className="home-block" id="stores">
          <SectionHeader
            title={showFiltered ? 'نتائج البحث' : 'متاجر قريبة منك'}
            subtitle={showFiltered ? undefined : 'اختر متجرك وابدأ التسوق'}
            action={(
              <button type="button" className="section-head-action" onClick={locate}>
                <Navigation size={13}/> {userLoc ? 'تحديث موقعي' : 'ترتيب حسب القرب'}
              </button>
            )}
          />

          {loading ? (
            <div className="skeleton-grid">{Array.from({ length: 4 }).map((_, i) => <StoreSkeleton key={i}/>)}</div>
          ) : filteredStores.length ? (
            <div className="store-grid">
              {filteredStores.map((s, i) => <StoreCard key={s.id} store={s} index={i} distance={s.distance}/>)}
            </div>
          ) : (
            <EmptyState title="لا توجد متاجر مطابقة" icon={Store}>
              جرّب كلمة بحث أخرى أو اختر تصنيفًا مختلفًا.
            </EmptyState>
          )}
        </section>

        <section className="home-block">
          <SectionHeader title="اطلب بطريقتك" subtitle="خدمات إضافية من لبيه" />
          <div className="quick-actions">
            <Link href="/request" className="quick-action">
              <span className="quick-action-icon"><NotebookPen size={20}/></span>
              <div><b>اكتب طلبك الخاص</b><small>احتياجاتك اليومية</small></div>
              <ArrowLeft size={16}/>
            </Link>
            <Link href="/global" className="quick-action">
              <span className="quick-action-icon"><PackageOpen size={20}/></span>
              <div><b>اطلب من شي إن</b><small>رابط أو صورة المنتج</small></div>
              <ArrowLeft size={16}/>
            </Link>
          </div>
        </section>

        <section className="home-block" id="products">
          <SectionHeader
            title={showFiltered ? 'منتجات مطابقة' : 'منتجات مختارة'}
            subtitle={showFiltered ? undefined : 'أحدث ما وصل إلى المتاجر'}
            action={<Link href="/cart" className="section-head-action">السلة <ArrowLeft size={13}/></Link>}
          />
          {loading ? (
            <ListSkeleton rows={3}/>
          ) : filteredProducts.length ? (
            <div className="product-grid">
              {filteredProducts.slice(0, 12).map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  storeName={storeById[p.store_id]?.name || 'متجر لبيه'}
                  actions={(
                    <Link href={`/store/${p.store_id}`} className="btn-primary">
                      عرض المتجر
                    </Link>
                  )}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="لا توجد منتجات مطابقة" icon={ShoppingBasket}>
              جرّب كلمة بحث أخرى أو تصفح المتاجر مباشرة.
            </EmptyState>
          )}
        </section>

        <section className="trust-strip">
          <div><Star size={18}/><b>متاجر محلية</b><span>من قلب عزّان</span></div>
          <div><Truck size={18}/><b>توصيل للمنزل</b><span>رسوم حسب المسافة</span></div>
          <div><ClipboardList size={18}/><b>طلبات خاصة</b><span>اطلب أي شيء</span></div>
        </section>
      </div>
    </div>
  </Layout>;
}
