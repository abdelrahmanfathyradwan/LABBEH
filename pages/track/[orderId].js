import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout';
import Notice from '../../components/Notice';
import EmptyState from '../../components/EmptyState';
import StatusBadge from '../../components/StatusBadge';
import DriverCard from '../../components/DriverCard';
import TrackingMap from '../../components/TrackingMap';
import PriceSummary from '../../components/PriceSummary';
import { ListSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/useAuth';
import { currency, dateTime, orderSteps, stepIndex, shortId } from '../../lib/format';
import { MapPin, Truck, ExternalLink, Package, Clock, CheckCircle2, ImageIcon, LifeBuoy, LayoutGrid } from 'lucide-react';

const allowed = { orders: 'orders', custom_orders: 'custom_orders', global_orders: 'global_orders' };

export default function Track() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { orderId } = router.query;
  const type = allowed[router.query.type] || 'orders';
  const [order, setOrder] = useState(null);
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!orderId || !supabase) return undefined;
    let alive = true;

    const load = async () => {
      try {
        const { data, error: loadError } = await supabase.from(type).select('*').eq('id', orderId).maybeSingle();
        if (!alive) return;
        if (loadError || !data) {
          setError('لم نتمكن من العثور على الطلب أو ليس لديك صلاحية عرضه.');
          return;
        }
        setError('');
        setOrder(data);
        if (data.driver_id) {
          const { data: d } = await supabase
            .from('profiles')
            .select('full_name,phone,lat,lng,location_updated_at')
            .eq('id', data.driver_id)
            .maybeSingle();
          if (alive) setDriver(d || null);
        } else if (alive) {
          setDriver(null);
        }
      } catch {
        if (alive) setError('تعذر تحميل الطلب. تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.');
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    const channel = supabase
      .channel(`track-${type}-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: type, filter: `id=eq.${orderId}` }, load)
      .subscribe();
    const timer = setInterval(load, 15000);

    return () => {
      alive = false;
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [orderId, type]);

  const marker = driver?.lat != null && driver?.lng != null
    ? { lat: driver.lat, lng: driver.lng, label: 'موقع السائق' }
    : order?.customer_lat != null && order?.customer_lng != null
      ? { lat: order.customer_lat, lng: order.customer_lng, label: 'موقع التوصيل' }
      : null;
  const mapSrc = marker
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${marker.lng - 0.012},${marker.lat - 0.012},${marker.lng + 0.012},${marker.lat + 0.012}&layer=mapnik&marker=${marker.lat},${marker.lng}`
    : null;

  const steps = orderSteps(type);
  const currentStep = order ? stepIndex(type, order.status) : -1;
  const items = Array.isArray(order?.items) ? order.items : [];

  return <Layout title="تتبع الطلب">
    <div className="page-wrap">
      <div className="container">
        <Link href="/account" className="back-link"><LayoutGrid size={15}/> كل طلباتي</Link>

        {!authLoading && !user && (
          <Notice type="info">سجّل الدخول لعرض تفاصيل طلبك. <Link className="underline font-bold" href={`/login?next=${encodeURIComponent(`/track/${orderId}?type=${type}`)}`}>تسجيل الدخول</Link></Notice>
        )}

        {error && <Notice type="error">{error}</Notice>}

        {loading ? <ListSkeleton rows={3}/> : !order ? (
          !error && <EmptyState title="لا يوجد طلب" icon={Package}>تحقق من رقم الطلب أو ارجع إلى قائمة طلباتك.</EmptyState>
        ) : (
          <>
            <section className="track-hero">
              <div>
                <span className="eyebrow">تتبع الطلب</span>
                <h1 className="track-order-no">#{shortId(order.id)}</h1>
                <span className="track-order-date"><Clock size={13}/> {dateTime(order.created_at)}</span>
              </div>
              <StatusBadge status={order.status}/>
            </section>

            <div className="track-grid">
              <div className="panel track-main">
                {order.status !== 'cancelled' && currentStep >= 0 && (
                  <ol className="timeline">
                    {steps.map(([status, label], index) => {
                      const state = index < currentStep ? 'done' : index === currentStep ? 'current' : '';
                      return (
                        <li key={status} className={state}>
                          <span className="timeline-dot">{index < currentStep ? <CheckCircle2 size={14}/> : index + 1}</span>
                          <span>{label}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}

                {type === 'orders' && items.length > 0 && (
                  <div className="track-section">
                    <h3><Package size={16}/> المنتجات</h3>
                    <div className="track-items">
                      {items.map((item, index) => (
                        <div className="track-item" key={`${item.product_id || item.name}-${index}`}>
                          <span>{item.name} × {item.quantity}</span>
                          <b>{currency(Number(item.price) * Number(item.quantity))}</b>
                        </div>
                      ))}
                    </div>
                    <PriceSummary
                      rows={[
                        { label: 'قيمة المنتجات', value: currency(order.subtotal) },
                        { label: 'رسوم التوصيل', value: currency(order.delivery_fee) },
                        ...(order.distance_km != null ? [{ label: 'المسافة', value: `${Number(order.distance_km).toFixed(1)} كم` }] : [])
                      ]}
                      total={currency(order.total)}
                    />
                  </div>
                )}

                {type === 'custom_orders' && (
                  <div className="track-section">
                    <h3>تفاصيل الطلب الخاص</h3>
                    {order.title && <p className="track-title">{order.title}</p>}
                    <p className="preserve-lines">{order.order_text}</p>
                    {order.image_url && (
                      <a href={order.image_url} target="_blank" rel="noreferrer" className="track-image-link">
                        <img src={order.image_url} alt="صورة الطلب"/><span><ImageIcon size={14}/> عرض الصورة</span>
                      </a>
                    )}
                    {order.admin_response && (
                      <div className="admin-reply"><b>رد الإدارة:</b> {order.admin_response}</div>
                    )}
                  </div>
                )}

                {type === 'global_orders' && (
                  <div className="track-section">
                    <h3>تفاصيل طلب شي إن</h3>
                    {order.product_image && <a href={order.product_image} target="_blank" rel="noreferrer" className="track-image-link"><img src={order.product_image} alt="صورة المنتج"/><span><ImageIcon size={14}/> عرض الصورة</span></a>}
                    <p>{order.description || 'طلب من متجر خارجي'}</p>
                    <div className="track-meta-grid">
                      {order.size && <div><span>المقاس</span><b>{order.size}</b></div>}
                      {order.color && <div><span>اللون</span><b>{order.color}</b></div>}
                      {order.quantity && <div><span>الكمية</span><b>{order.quantity}</b></div>}
                    </div>
                    {order.estimated_price != null && order.estimated_price !== '' && (
                      <PriceSummary rows={[]} total={currency(order.estimated_price)} totalLabel="السعر التقديري"/>
                    )}
                    {order.product_link && <a className="btn-outline mt-3" href={order.product_link} target="_blank" rel="noreferrer"><ExternalLink size={15}/> رابط المنتج</a>}
                    {order.admin_response && <div className="admin-reply"><b>رد الإدارة:</b> {order.admin_response}</div>}
                  </div>
                )}

                <div className="track-section">
                  <h3><MapPin size={16}/> عنوان التوصيل</h3>
                  <p>{order.delivery_address || '—'}</p>
                  <div className="track-meta-grid">
                    <div><span>الاسم</span><b>{order.customer_name}</b></div>
                    <div><span>الجوال</span><b dir="ltr">{order.customer_phone}</b></div>
                  </div>
                  {type === 'orders' && order.notes && <div className="admin-reply"><b>ملاحظاتك:</b> {order.notes}</div>}
                </div>
              </div>

              <div className="track-side">
                <div className="panel">
                  <h3><Truck size={18}/> السائق</h3>
                  {driver ? (
                    <DriverCard driver={driver} lastUpdate={driver.location_updated_at}/>
                  ) : (
                    <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                      طلبك قيد المراجعة أو لم يتم إسناده إلى سائق بعد. سيظهر اسم السائق وموقعه هنا بمجرد الإسناد.
                    </p>
                  )}
                  {mapSrc && (
                    <div className="mt-3">
                      <TrackingMap src={mapSrc} title={marker.label} label={marker.label}/>
                    </div>
                  )}
                </div>

                <div className="panel support-card">
                  <h3><LifeBuoy size={18}/> هل تحتاج مساعدة؟</h3>
                  <p className="small">تواصل مع إدارة لبيه مع ذكر رقم الطلب <b dir="ltr">#{shortId(order.id)}</b>.</p>
                  <Link className="btn-outline w-full" href="/">العودة للرئيسية</Link>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  </Layout>;
}
