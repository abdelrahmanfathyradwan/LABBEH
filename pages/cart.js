import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import EmptyState from '../components/EmptyState';
import QuantitySelector from '../components/QuantitySelector';
import PriceSummary from '../components/PriceSummary';
import TrackingMap from '../components/TrackingMap';
import { ListSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/useAuth';
import { currency, haversineKm, deliveryFee, safeError } from '../lib/format';
import { MapPin, Navigation, Trash2, ShoppingBag, ArrowRight, Banknote, ShieldCheck, Store as StoreIcon } from 'lucide-react';

const CART_KEY = 'labbeh_cart';

const readCart = () => {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; }
};

export default function Cart() {
  const { user, profile, loading: authLoading } = useAuth();
  const [cart, setCart] = useState(null);
  const [store, setStore] = useState(null);
  const [stockItems, setStockItems] = useState({});
  const [stockLoaded, setStockLoaded] = useState(false);
  const [baseFee, setBaseFee] = useState(1000);
  const [perKm, setPerKm] = useState(300);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [placed, setPlaced] = useState(null);
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    setCart(readCart());
    if (!supabase) return;
    supabase.from('settings').select('delivery_base_fee,delivery_per_km').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setBaseFee(data.delivery_base_fee);
          setPerKm(data.delivery_per_km);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!profile || prefilled) return;
    setName((current) => current || profile.full_name || '');
    setPhone((current) => current || profile.phone || '');
    setPrefilled(true);
  }, [profile, prefilled]);

  const storeId = cart?.[0]?.store_id || null;
  const idsKey = useMemo(() => (cart || []).map((i) => i.id).sort().join(','), [cart]);

  useEffect(() => {
    if (!storeId || !supabase) return;
    supabase.from('stores').select('id,name,area,lat,lng,is_open,status').eq('id', storeId).maybeSingle()
      .then(({ data, error: storeError }) => {
        if (storeError) setError('تعذر تحميل بيانات المتجر. حاول تحديث الصفحة.');
        setStore(data);
      })
      .catch(() => setError('تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت.'));
  }, [storeId]);

  useEffect(() => {
    if (!cart?.length || !supabase) { setStockLoaded(false); return; }
    setStockLoaded(false);
    const ids = cart.map((i) => i.id);
    supabase.from('products').select('id,name,price,stock,is_active,images,store_id').in('id', ids)
      .then(({ data, error: stockError }) => {
        const map = {};
        (data || []).forEach((p) => { map[p.id] = p; });
        setStockItems(map);
        if (stockError) setError('تعذر التحقق من توفر المنتجات. حاول تحديث الصفحة قبل إتمام الطلب.');
        setStockLoaded(true);
      })
      .catch(() => {
        setError('تعذر التحقق من توفر المنتجات. تحقق من اتصالك بالإنترنت.');
        setStockLoaded(true);
      });
  }, [idsKey]);

  const issues = useMemo(() => {
    if (!cart || !stockLoaded) return [];
    return cart.flatMap((item) => {
      const product = stockItems[item.id];
      if (!product) return [{ id: item.id, text: `المنتج "${item.name}" لم يعد موجودًا.` }];
      if (!product.is_active) return [{ id: item.id, text: `المنتج "${item.name}" غير متاح حاليًا.` }];
      if (product.stock < item.qty) return [{ id: item.id, text: `المتوفر من "${item.name}" هو ${product.stock} فقط.` }];
      return [];
    });
  }, [cart, stockItems]);

  const subtotal = (cart || []).reduce((sum, item) => {
    const price = stockItems[item.id]?.price ?? item.price;
    return sum + Number(price) * Number(item.qty);
  }, 0);

  const km = useMemo(
    () => (store?.lat != null && coords?.lat != null ? haversineKm(store.lat, store.lng, coords.lat, coords.lng) : null),
    [store, coords]
  );
  const estimateFee = km === null ? baseFee : deliveryFee(km, baseFee, perKm);
  const storeClosed = store && (store.is_open === false || store.status !== 'active');

  const persist = (next) => {
    setCart(next);
    localStorage.setItem(CART_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('labbeh-cart-updated'));
  };

  const changeQty = (id, value) => {
    const next = (cart || []).map((item) => {
      if (item.id !== id) return item;
      const limit = stockItems[id]?.stock ?? 99;
      return { ...item, qty: Math.max(1, Math.min(Number(value) || 1, Math.max(1, limit))) };
    });
    persist(next);
  };

  const removeItem = (id) => persist((cart || []).filter((item) => item.id !== id));

  const locate = () => {
    setError('');
    if (!navigator.geolocation) return setError('المتصفح لا يدعم تحديد الموقع.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setAddress((current) => current || 'تم تحديد الموقع عبر GPS — عزّان');
      },
      () => setError('تعذر تحديد موقعك. يمكنك كتابة عنوان واضح وإكمال الطلب.'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const placeOrder = async () => {
    setError('');
    setSuccess('');
    if (!supabase) return setError('إعدادات Supabase غير مكتملة.');
    if (!cart?.length) return setError('السلة فارغة.');
    if (!user) return setError('سجّل الدخول لإتمام الطلب.');
    if (storeClosed) return setError('المتجر غير متاح لاستلام الطلبات حاليًا.');
    if (!name.trim() || !phone.trim() || !address.trim()) return setError('أكمل الاسم ورقم الجوال والعنوان.');
    if (issues.length) return setError('راجع المنتجات غير المتاحة أو الكميات قبل تأكيد الطلب.');

    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('place_market_order', {
        p_store_id: storeId,
        p_customer_name: name.trim(),
        p_customer_phone: phone.trim(),
        p_delivery_address: address.trim(),
        p_customer_lat: coords?.lat ?? null,
        p_customer_lng: coords?.lng ?? null,
        p_items: cart.map((item) => ({ product_id: item.id, quantity: item.qty })),
        p_notes: notes.trim() || null
      });
      if (rpcError) return setError(safeError(rpcError));

      persist([]);
      setPlaced({ id: data });
      setSuccess('تم استلام طلبك بنجاح.');

      const { data: order } = await supabase
        .from('orders')
        .select('id,subtotal,delivery_fee,total,distance_km')
        .eq('id', data)
        .maybeSingle()
        .catch(() => ({ data: null }));
      if (order) setPlaced(order);
    } catch (e) {
      setError(safeError(e));
    } finally {
      setBusy(false);
    }
  };

  const mapSrc = coords ? `https://www.openstreetmap.org/export/embed.html?bbox=${coords.lng - 0.004},${coords.lat - 0.004},${coords.lng + 0.004},${coords.lat + 0.004}&layer=mapnik&marker=${coords.lat},${coords.lng}` : null;
  const itemCount = (cart || []).reduce((sum, item) => sum + Number(item.qty), 0);

  return <Layout title="سلة التسوق">
    <div className="cart-page">
      <div className="container">
        <Link href="/" className="back-link"><ArrowRight size={16}/> متابعة التسوق</Link>
        <h1 className="page-title">سلة التسوق</h1>
        <p className="page-lead">راجع طلبك، حدد موقع التوصيل، ثم أكّد الطلب.</p>

        {error && <Notice type="error">{error}</Notice>}
        {success && (
          <Notice type="success">
            {success} {placed?.id && <Link className="underline font-bold" href={`/track/${placed.id}?type=orders`}>تتبع الطلب</Link>}
          </Notice>
        )}

        {!authLoading && !user && cart?.length > 0 && !placed && (
          <Notice type="info">
            تحتاج إلى تسجيل الدخول لإتمام الطلب. <Link className="underline font-bold" href="/login?next=%2Fcart">تسجيل الدخول</Link>
          </Notice>
        )}

        {placed && (
          <div className="cart-card placed-summary" style={{ marginBottom: 18 }}>
            <h2>تم تأكيد الطلب</h2>
            <p>رقم الطلب: <b dir="ltr">{placed.id}</b></p>
            <PriceSummary
              rows={[
                { label: 'قيمة المنتجات', value: currency(placed.subtotal) },
                { label: 'رسوم التوصيل', value: currency(placed.delivery_fee) },
                ...(placed.distance_km != null ? [{ label: 'المسافة', value: `${Number(placed.distance_km).toFixed(1)} كم` }] : [])
              ]}
              total={currency(placed.total)}
              totalLabel="الإجمالي"
            />
            <div className="form-actions mt-4">
              <Link className="btn-gold" href={`/track/${placed.id}?type=orders`}>تتبع الطلب</Link>
              <Link className="btn-outline" href="/">متابعة التسوق</Link>
            </div>
          </div>
        )}

        {cart === null ? (
          <div className="cart-card"><ListSkeleton rows={3}/></div>
        ) : !cart.length && !placed ? (
          <div className="cart-card">
            <EmptyState title="سلتك فارغة" icon={ShoppingBag}>
              تصفح المتاجر وأضف المنتجات التي تريدها. <Link href="/">تصفح المتاجر</Link>
            </EmptyState>
          </div>
        ) : !placed && (
          <div className="cart-layout">
            <div className="cart-card">
              <div className="cart-store-line">
                <h2 className="cart-card-title"><StoreIcon size={18}/> {store?.name || 'جارٍ تحميل المتجر...'}</h2>
                <span className="small">{itemCount} قطعة</span>
                {storeClosed && <span className="open-state closed">المتجر مغلق</span>}
              </div>
              {issues.length > 0 && (
                <Notice type="error">
                  <b>بعض المنتجات تحتاج مراجعة:</b>
                  <ul className="issues-list">{issues.map((issue) => <li key={issue.id}>{issue.text}</li>)}</ul>
                </Notice>
              )}
              {cart.map((item) => {
                const product = stockItems[item.id];
                const price = product?.price ?? item.price;
                return (
                  <div className="cart-item" key={item.id}>
                    <div className="cart-item-image">
                      {(product?.images?.[0] || item.image) ? <img src={product?.images?.[0] || item.image} alt={item.name}/> : <ShoppingBag size={22}/>}
                    </div>
                    <div className="cart-item-info">
                      <strong>{item.name}</strong>
                      <span className="small">{currency(price)} للقطعة · المتوفر {product?.stock ?? '—'}</span>
                    </div>
                    <div className="cart-item-actions">
                      <QuantitySelector
                        value={item.qty}
                        min={1}
                        max={Math.max(1, product?.stock ?? 99)}
                        label={`كمية ${item.name}`}
                        onChange={(value) => changeQty(item.id, value)}
                      />
                      <span className="cart-line-total">{currency(price * item.qty)}</span>
                      <button type="button" className="icon-btn danger" onClick={() => removeItem(item.id)} aria-label={`حذف ${item.name}`}>
                        <Trash2 size={16}/>
                      </button>
                    </div>
                  </div>
                );
              })}
              <div className="d-flex justify-between" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" className="link-btn" onClick={() => persist([])}>إفراغ السلة</button>
                <Link href="/" className="link-btn"><ArrowRight size={14}/> إضافة منتجات أخرى</Link>
              </div>
            </div>

            <div className="cart-card">
              <h2 className="section-title"><MapPin size={18}/> بيانات التوصيل</h2>
              <div className="field">
                <label>الاسم</label>
                <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80}/>
              </div>
              <div className="field">
                <label>رقم الجوال</label>
                <input dir="ltr" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+9677xxxxxxxx" maxLength={20}/>
              </div>
              <div className="field">
                <label>العنوان / وصف الموقع</label>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="الحي، الشارع، أقرب معلم..."/>
              </div>
              <div className="field">
                <label>ملاحظات على الطلب (اختياري)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="مثال: اتصل قبل الوصول، بدون بصل..." maxLength={300}/>
              </div>
              <button type="button" className="btn-gold w-full" onClick={locate}><Navigation size={16}/> تحديد موقعي الحالي</button>
              {coords && <Notice type="success">تم تحديد موقع التوصيل. يمكنك رؤيته على الخريطة أدناه.</Notice>}
              {mapSrc && <TrackingMap src={mapSrc} title="موقع التوصيل" label="موقع التوصيل" />}

              <div className="payment-box">
                <Banknote size={18}/>
                <div><b>الدفع عند الاستلام</b><span>طريقة الدفع المتاحة حاليًا لهذه النسخة.</span></div>
              </div>

              <PriceSummary
                rows={[
                  { label: 'قيمة المنتجات', value: currency(subtotal) },
                  { label: 'رسوم التوصيل التقديرية', value: currency(estimateFee) }
                ]}
                total={currency(subtotal + estimateFee)}
                totalLabel="الإجمالي التقديري"
                note={km !== null ? (
                  <p className="small" style={{ margin: 0 }}>
                    المسافة التقريبية: {km.toFixed(1)} كم. الرسوم: {baseFee} ر.ي لأول 2 كم، ثم {perKm} ر.ي لكل كم إضافي (تُقرّب المسافة الإضافية للأعلى).
                  </p>
                ) : (
                  <p className="small" style={{ margin: 0 }}>
                    حدد موقعك لحساب رسوم التوصيل بدقة. بدون الموقع تُطبق أقل رسوم ({currency(baseFee)}).
                  </p>
                )}
              />
              <button type="button" className="btn-gold cart-confirm" disabled={busy || !stockLoaded || issues.length > 0 || Boolean(storeClosed)} onClick={placeOrder}>
                {busy ? 'جارٍ إرسال الطلب...' : `تأكيد الطلب · ${currency(subtotal + estimateFee)}`}
              </button>
              <p className="cart-fee-note">
                <ShieldCheck size={13}/> يتم احتساب رسوم التوصيل النهائية على الخادم، وقد تختلف عن التقدير أعلاه.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  </Layout>;
}
