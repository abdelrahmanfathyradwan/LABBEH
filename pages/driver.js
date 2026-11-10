import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ListSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuthGuard } from '../lib/useAuth';
import { currency, dateTime, shortId, safeError } from '../lib/format';
import {
  Truck, MapPin, Phone, Store as StoreIcon, Navigation, PackageCheck, History,
  RefreshCw, ExternalLink, ImageIcon, PlayCircle, CheckCircle2, Clock
} from 'lucide-react';

const tables = ['orders', 'custom_orders', 'global_orders'];
const activeStatuses = ['assigned', 'processing', 'on_delivery'];

export default function Driver() {
  const { user, profile, loading: authLoading, allowed } = useAuthGuard(['driver']);
  const [lists, setLists] = useState({ orders: [], custom_orders: [], global_orders: [] });
  const [tab, setTab] = useState('orders');
  const [view, setView] = useState('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busyId, setBusyId] = useState('');
  const [locationState, setLocationState] = useState('لم يبدأ إرسال الموقع');
  const [lastSent, setLastSent] = useState(null);

  const load = async (uid) => {
    try {
      const results = await Promise.all(
        tables.map((table) => supabase
          .from(table)
          .select(table === 'orders' ? '*, stores(name,area,phone)' : '*')
          .eq('driver_id', uid)
          .order('created_at', { ascending: false })
          .limit(100))
      );
      const nextError = results.find((r) => r.error)?.error;
      if (nextError) setError(safeError(nextError));
      setLists({
        orders: results[0].data || [],
        custom_orders: results[1].data || [],
        global_orders: results[2].data || []
      });
    } catch (e) {
      setError(safeError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed && user) load(user.id);
  }, [allowed, user]);

  useEffect(() => {
    if (!allowed || !user) return undefined;
    const timer = setInterval(() => load(user.id), 20000);
    return () => clearInterval(timer);
  }, [allowed, user]);

  useEffect(() => {
    if (!allowed || !navigator.geolocation) {
      if (allowed) setLocationState('المتصفح لا يدعم تحديد الموقع');
      return undefined;
    }
    let mounted = true;
    const send = () => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { error: rpcError } = await supabase.rpc('update_driver_location', {
              p_lat: pos.coords.latitude,
              p_lng: pos.coords.longitude
            });
            if (!mounted) return;
            setLocationState(rpcError ? 'تعذر تحديث الموقع' : 'يتم مشاركة موقعك مع العملاء');
            if (!rpcError) setLastSent(new Date());
          } catch {
            if (mounted) setLocationState('تعذر تحديث الموقع');
          }
        },
        () => { if (mounted) setLocationState('يرجى السماح بالوصول للموقع لمشاركة موقعك'); },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 12000 }
      );
    };
    send();
    const timer = setInterval(send, 10000);
    return () => { mounted = false; clearInterval(timer); };
  }, [allowed]);

  const currentList = lists[tab] || [];
  const active = useMemo(() => currentList.filter((o) => activeStatuses.includes(o.status)), [currentList]);
  const history = useMemo(() => currentList.filter((o) => !activeStatuses.includes(o.status)), [currentList]);
  const visible = view === 'active' ? active : history;

  const advance = async (order, status) => {
    const table = tab;
    if (status === 'delivered' && !window.confirm('تأكيد تسليم الطلب للعميل؟')) return;
    setError('');
    setOk('');
    setBusyId(order.id);
    try {
      const { data: updated, error: updateError } = await supabase
        .from(table)
        .update({ status })
        .eq('id', order.id)
        .select('id');
      if (updateError) throw updateError;
      if (!updated?.length) {
        throw new Error('لم يتم تحديث حالة الطلب. قد تكون الحالة تغيّرت أو لا تملك صلاحية؛ حدّث الصفحة ثم حاول مرة أخرى.');
      }
      setOk(status === 'on_delivery' ? 'تم بدء التوصيل.' : 'تم تسجيل تسليم الطلب.');
      load(user.id);
    } catch (e) {
      setError(safeError(e));
    } finally {
      setBusyId('');
    }
  };

  const mapLink = (order) => {
    if (order.customer_lat == null || order.customer_lng == null) return null;
    return `https://www.openstreetmap.org/?mlat=${order.customer_lat}&mlon=${order.customer_lng}#map=16/${order.customer_lat}/${order.customer_lng}`;
  };

  if (authLoading || !allowed || loading) {
    return <Layout><div className="page-wrap"><div className="container"><ListSkeleton rows={3}/></div></div></Layout>;
  }

  const typeTabs = [
    ['orders', 'طلبات المتاجر', lists.orders.length],
    ['custom_orders', 'طلبات خاصة', lists.custom_orders.length],
    ['global_orders', 'طلبات شي إن', lists.global_orders.length]
  ];

  return <Layout title="لوحة السائق">
    <div className="page-wrap">
      <div className="container">
        <div className="dashboard-head">
          <div>
            <span className="eyebrow">لوحة السائق</span>
            <h1 className="page-title mt-3">{profile?.full_name || 'مرحبًا'}</h1>
            <p className="page-lead mb-0"><Navigation size={14}/> {locationState}{lastSent ? ` · آخر إرسال ${lastSent.toLocaleTimeString('ar')}` : ''}</p>
          </div>
          <button type="button" className="btn-outline" onClick={() => load(user.id)}><RefreshCw size={15}/> تحديث</button>
        </div>

        {error && <Notice type="error" onClose={() => setError('')}>{error}</Notice>}
        {ok && <Notice type="success" onClose={() => setOk('')}>{ok}</Notice>}

        <div className="tabs-row">
          {typeTabs.map(([key, label, count]) => (
            <button key={key} className={tab === key ? 'chip active' : 'chip'} onClick={() => setTab(key)}>{label} ({count})</button>
          ))}
        </div>
        <div className="tabs-row">
          <button className={view === 'active' ? 'chip active' : 'chip'} onClick={() => setView('active')}><Truck size={14}/> الطلبات النشطة ({active.length})</button>
          <button className={view === 'history' ? 'chip active' : 'chip'} onClick={() => setView('history')}><History size={14}/> سجل التوصيل ({history.length})</button>
        </div>

        {!visible.length ? (
          <EmptyState title={view === 'active' ? 'لا توجد طلبات نشطة' : 'لا يوجد سجل توصيل'} icon={Truck}>
            ستظهر الطلبات المسندة إليك من الإدارة هنا.
          </EmptyState>
        ) : (
          <div className="order-list">
            {visible.map((order) => (
              <div className="order-card" key={order.id}>
                <div className="order-card-head">
                  <div>
                    <b>#{shortId(order.id)}</b>
                    <span className="small"> · {dateTime(order.created_at)}</span>
                  </div>
                  <StatusBadge status={order.status}/>
                </div>
                <div className="order-card-body">
                  <div>
                    <p><b>{order.customer_name}</b> · <a href={`tel:${order.customer_phone}`} dir="ltr">{order.customer_phone}</a></p>
                    <p className="small"><MapPin size={13}/> {order.delivery_address}</p>

                    {tab === 'orders' && (
                      <>
                        {order.stores && <p className="small store-line"><StoreIcon size={13}/> {order.stores.name}{order.stores.area ? ` · ${order.stores.area}` : ''}{order.stores.phone ? <a href={`tel:${order.stores.phone}`} dir="ltr"> · {order.stores.phone}</a> : null}</p>}
                        <ul className="order-items-list">
                          {(order.items || []).map((item, index) => (
                            <li key={`${item.product_id || item.name}-${index}`}><span>{item.name} × {item.quantity}</span><b>{currency(Number(item.price) * Number(item.quantity))}</b></li>
                          ))}
                        </ul>
                        <div className="order-totals"><span>المنتجات: {currency(order.subtotal)}</span><span>التوصيل: {currency(order.delivery_fee)}</span><b>التحصيل: {currency(order.total)}</b></div>
                        {order.notes && <p className="small order-note">ملاحظات: {order.notes}</p>}
                      </>
                    )}

                    {tab === 'custom_orders' && (
                      <div className="driver-details">
                        {order.title && <p className="track-title"><Clock size={13}/> {order.title}</p>}
                        <p className="preserve-lines">{order.order_text}</p>
                        {order.image_url && <a className="track-image-link" href={order.image_url} target="_blank" rel="noreferrer"><img src={order.image_url} alt="صورة الطلب"/><span><ImageIcon size={13}/> صورة الطلب</span></a>}
                      </div>
                    )}

                    {tab === 'global_orders' && (
                      <div className="driver-details">
                        {order.product_image && <a className="track-image-link" href={order.product_image} target="_blank" rel="noreferrer"><img src={order.product_image} alt="صورة المنتج"/><span><ImageIcon size={13}/> صورة المنتج</span></a>}
                        <p>{order.description || 'طلب من متجر خارجي'}</p>
                        <div className="track-meta-grid">
                          {order.size && <div><span>المقاس</span><b>{order.size}</b></div>}
                          {order.color && <div><span>اللون</span><b>{order.color}</b></div>}
                          {order.quantity && <div><span>الكمية</span><b>{order.quantity}</b></div>}
                        </div>
                        {order.product_link && <a className="btn-outline mt-2" href={order.product_link} target="_blank" rel="noreferrer"><ExternalLink size={14}/> رابط المنتج</a>}
                      </div>
                    )}
                  </div>

                  <div className="order-actions">
                    {mapLink(order) ? (
                      <a className="btn-outline" href={mapLink(order)} target="_blank" rel="noreferrer"><MapPin size={15}/> فتح الموقع</a>
                    ) : <span className="small">لم يحدد العميل إحداثياته.</span>}

                    {order.status === 'assigned' && (
                      <button type="button" className="btn-primary" disabled={busyId === order.id} onClick={() => advance(order, 'on_delivery')}>
                        <PlayCircle size={16}/> بدء التوصيل
                      </button>
                    )}
                    {order.status === 'on_delivery' && (
                      <button type="button" className="btn-gold" disabled={busyId === order.id} onClick={() => advance(order, 'delivered')}>
                        <CheckCircle2 size={16}/> تأكيد التسليم
                      </button>
                    )}
                    {tab !== 'orders' && order.status === 'processing' && (
                      <button type="button" className="btn-outline" disabled={busyId === order.id} onClick={() => advance(order, 'on_delivery')}>
                        <PlayCircle size={16}/> بدء التوصيل
                      </button>
                    )}
                    {order.status === 'delivered' && <span className="status status-success"><PackageCheck size={13}/> تم التسليم</span>}
                    {order.status === 'cancelled' && <span className="status status-danger">طلب ملغي</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  </Layout>;
}
