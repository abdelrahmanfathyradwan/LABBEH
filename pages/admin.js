import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ListSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuthGuard } from '../lib/useAuth';
import { adminStatusOptions, currency, dateTime, shortId, statusLabel, safeError } from '../lib/format';
import { roleLabel } from '../lib/auth';
import {
  LayoutDashboard, ClipboardList, Store as StoreIcon, Users, Settings, RefreshCw, Plus,
  Save, MapPin, Truck, CheckCircle2, XCircle, ExternalLink, ImageIcon, Send, Search,
  TrendingUp, Wallet, PackageCheck, ReceiptText, NotebookPen, ShoppingBag, UserRound
} from 'lucide-react';

const FINAL_STATUSES = ['delivered', 'cancelled'];
const QUOTABLE_STATUSES = ['pending_review', 'quoted'];

const emptyStore = { name: '', description: '', owner_id: '', area: 'عزان', category: '', lat: '', lng: '' };
const emptySettings = {
  commission_percent: 15, delivery_base_fee: 1000, delivery_per_km: 300,
  contact_phone: '', whatsapp_number: '', instagram_url: '', facebook_url: ''
};

export default function Admin() {
  const { user, profile, loading: authLoading, allowed } = useAuthGuard(['admin']);
  const [tab, setTab] = useState('overview');
  const [orders, setOrders] = useState([]);
  const [customs, setCustoms] = useState([]);
  const [globals, setGlobals] = useState([]);
  const [stores, setStores] = useState([]);
  const [users, setUsers] = useState([]);
  const [settings, setSettings] = useState(emptySettings);
  const [storeForm, setStoreForm] = useState(emptyStore);
  const [userSearch, setUserSearch] = useState('');
  const [responses, setResponses] = useState({});
  const [quotes, setQuotes] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busyId, setBusyId] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);
  const [creatingStore, setCreatingStore] = useState(false);

  const load = async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [o, c, g, s, st] = await Promise.all([
        supabase.from('orders').select('*, stores(name)').order('created_at', { ascending: false }).limit(500),
        supabase.from('custom_orders').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('global_orders').select('*').order('created_at', { ascending: false }).limit(500),
        supabase.from('stores').select('*').order('created_at', { ascending: false }),
        supabase.from('settings').select('*').eq('id', 1).maybeSingle()
      ]);

      const firstError = o.error || c.error || g.error || s.error || st.error;
      if (firstError) setError(safeError(firstError));

      setOrders(o.data || []);
      setCustoms(c.data || []);
      setGlobals(g.data || []);
      setStores(s.data || []);
      if (st.data) {
        setSettings({
          commission_percent: st.data.commission_percent ?? 15,
          delivery_base_fee: st.data.delivery_base_fee ?? 1000,
          delivery_per_km: st.data.delivery_per_km ?? 300,
          contact_phone: st.data.contact_phone || '',
          whatsapp_number: st.data.whatsapp_number || '',
          instagram_url: st.data.instagram_url || '',
          facebook_url: st.data.facebook_url || ''
        });
      }

      const directory = await supabase.rpc('admin_list_users');
      if (!directory.error && directory.data) {
        setUsers(directory.data);
      } else {
        const fallback = await supabase.from('profiles').select('id,full_name,phone,role,created_at').order('created_at', { ascending: false });
        setUsers(fallback.data || []);
      }
    } catch (e) {
      setError(safeError(e));
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    if (allowed) load();
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return undefined;
    const timer = setInterval(() => load({ silent: true }), 30000);
    return () => clearInterval(timer);
  }, [allowed]);

  const drivers = useMemo(() => users.filter((u) => u.role === 'driver'), [users]);
  const merchants = useMemo(() => users.filter((u) => u.role === 'merchant'), [users]);
  const userById = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u])), [users]);

  const stats = useMemo(() => {
    const customers = users.filter((u) => u.role === 'customer').length;
    const delivered = orders.filter((o) => o.status === 'delivered');
    return {
      customers,
      drivers: drivers.length,
      merchants: merchants.length,
      stores: stores.length,
      activeStores: stores.filter((s) => s.status === 'active').length,
      pendingStores: stores.filter((s) => s.status === 'pending').length,
      orders: orders.length + customs.length + globals.length,
      pendingOrders: orders.filter((o) => o.status === 'pending').length
        + customs.filter((o) => o.status === 'pending').length
        + globals.filter((o) => o.status === 'pending_review').length,
      delivered: delivered.length,
      revenue: delivered.reduce((sum, o) => sum + Number(o.total || 0), 0)
    };
  }, [users, drivers, merchants, stores, orders, customs, globals]);

  const flash = (message, type = 'success') => {
    if (type === 'error') { setError(message); setOk(''); }
    else { setOk(message); setError(''); }
  };

  const saveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    const { data: updated, error: saveError } = await supabase.from('settings').update({
      commission_percent: Number(settings.commission_percent),
      delivery_base_fee: Number(settings.delivery_base_fee),
      delivery_per_km: Number(settings.delivery_per_km),
      contact_phone: settings.contact_phone.trim() || null,
      whatsapp_number: settings.whatsapp_number.trim() || null,
      instagram_url: settings.instagram_url.trim() || null,
      facebook_url: settings.facebook_url.trim() || null
    }).eq('id', 1).select('id');
    setSavingSettings(false);
    if (saveError) return flash(saveError.message, 'error');
    if (!updated?.length) return flash('لم يتم حفظ الإعدادات. تأكد من وجود صف الإعدادات وصلاحية المدير ثم حاول مرة أخرى.', 'error');
    flash('تم حفظ إعدادات المنصة.');
  };

  const createStore = async (e) => {
    e.preventDefault();
    if (!storeForm.name.trim()) return flash('اسم المتجر مطلوب.', 'error');
    setCreatingStore(true);
    const { data: created, error: createError } = await supabase.from('stores').insert({
      name: storeForm.name.trim(),
      description: storeForm.description.trim(),
      owner_id: storeForm.owner_id || null,
      area: storeForm.area.trim() || 'عزان',
      category: storeForm.category.trim() || null,
      lat: storeForm.lat === '' ? null : Number(storeForm.lat),
      lng: storeForm.lng === '' ? null : Number(storeForm.lng),
      status: 'pending',
      is_open: true
    }).select('id');
    setCreatingStore(false);
    if (createError) return flash(createError.message, 'error');
    if (!created?.length) return flash('لم يتم إنشاء المتجر. تحقق من صلاحيتك ثم حاول مرة أخرى.', 'error');
    setStoreForm(emptyStore);
    flash('تم إنشاء المتجر. فعّله لاحقًا من الجدول.');
    load({ silent: true });
  };

  const setStoreStatus = async (store, status) => {
    setBusyId(store.id);
    const { data: updated, error: updateError } = await supabase.from('stores').update({ status }).eq('id', store.id).select('id');
    setBusyId('');
    if (updateError) return flash(updateError.message, 'error');
    if (!updated?.length) return flash('لم يتم تحديث حالة المتجر. تحقق من صلاحيتك ثم حاول مرة أخرى.', 'error');
    flash(status === 'active' ? 'تم تفعيل المتجر.' : status === 'suspended' ? 'تم إيقاف المتجر.' : 'تم تحويل المتجر لقيد المراجعة.');
    load({ silent: true });
  };

  const toggleStoreOpen = async (store) => {
    setBusyId(store.id);
    const { data: updated, error: updateError } = await supabase.from('stores').update({ is_open: !store.is_open }).eq('id', store.id).select('id');
    setBusyId('');
    if (updateError) return flash(updateError.message, 'error');
    if (!updated?.length) return flash('لم يتم تغيير حالة استقبال الطلبات. تحقق من صلاحيتك ثم حاول مرة أخرى.', 'error');
    load({ silent: true });
  };

  const assignDriver = async (table, order, driverId) => {
    if (!driverId) return;
    if (FINAL_STATUSES.includes(order.status)) return flash('لا يمكن إسناد طلب منتهٍ.', 'error');
    if (users.find((u) => u.id === driverId)?.role !== 'driver') {
      return flash('الحساب المحدد ليس سائقًا. حدّث قائمة المستخدمين ثم حاول مرة أخرى.', 'error');
    }
    setBusyId(order.id);
    const { data: updated, error: updateError } = await supabase.from(table).update({ driver_id: driverId, status: 'assigned' }).eq('id', order.id).select('id');
    setBusyId('');
    if (updateError) return flash(updateError.message, 'error');
    if (!updated?.length) return flash('لم يتم إسناد الطلب. قد تكون حالته تغيّرت؛ حدّث الصفحة ثم حاول مرة أخرى.', 'error');
    flash('تم إسناد الطلب للسائق.');
    load({ silent: true });
  };

  const setOrderStatus = async (table, order, status) => {
    if (status === 'cancelled' && !window.confirm('هل تريد إلغاء الطلب؟')) return;
    setBusyId(order.id);
    const { data: updated, error: updateError } = await supabase.from(table).update({ status }).eq('id', order.id).select('id');
    setBusyId('');
    if (updateError) return flash(updateError.message, 'error');
    if (!updated?.length) return flash('لم يتم تحديث حالة الطلب. قد تكون حالته تغيّرت؛ حدّث الصفحة ثم حاول مرة أخرى.', 'error');
    flash('تم تحديث حالة الطلب.');
    load({ silent: true });
  };

  const saveResponse = async (order) => {
    if (FINAL_STATUSES.includes(order.status)) {
      return flash('لا يمكن تعديل رد الإدارة لطلب منتهٍ أو ملغى.', 'error');
    }
    const text = (responses[order.id] ?? order.admin_response ?? '').trim();
    setBusyId(order.id);
    const { data: updated, error: updateError } = await supabase.from('custom_orders').update({
      admin_response: text || null,
      admin_response_at: text ? new Date().toISOString() : null
    }).eq('id', order.id).select('id');
    setBusyId('');
    if (updateError) return flash(updateError.message, 'error');
    if (!updated?.length) return flash('لم يتم حفظ رد الإدارة. تحقق من صلاحيتك ثم حاول مرة أخرى.', 'error');
    flash('تم حفظ رد الإدارة.');
    load({ silent: true });
  };

  const quoteGlobal = async (order) => {
    if (!QUOTABLE_STATUSES.includes(order.status)) {
      return flash('لا يمكن إرسال عرض سعر في هذه الحالة.', 'error');
    }
    const price = quotes[order.id] ?? order.estimated_price ?? '';
    if (price === '' || Number(price) < 0) return flash('أدخل سعرًا تقديريًا صحيحًا.', 'error');
    setBusyId(order.id);
    const { data: updated, error: updateError } = await supabase.from('global_orders')
      .update({ estimated_price: Number(price), status: 'quoted' })
      .eq('id', order.id)
      .select('id');
    setBusyId('');
    if (updateError) return flash(updateError.message, 'error');
    if (!updated?.length) return flash('لم يتم إرسال عرض السعر. قد تكون حالة الطلب تغيّرت؛ حدّث الصفحة ثم حاول مرة أخرى.', 'error');
    flash('تم إرسال عرض السعر وتحديث حالة الطلب.');
    load({ silent: true });
  };

  const changeRole = async (target, role) => {
    if (target.id === user?.id) return flash('لا يمكنك تغيير صلاحية حسابك الحالي.', 'error');
    if (target.role === 'admin' && role !== 'admin' && users.filter((u) => u.role === 'admin').length <= 1) {
      return flash('يجب أن يبقى مدير واحد على الأقل. عيّن مديرًا آخر قبل خفض هذا الحساب.', 'error');
    }
    if (!window.confirm(`تغيير صلاحية ${target.full_name || target.email || target.id} إلى ${roleLabel(role)}؟`)) return;
    setBusyId(target.id);
    const { data: updated, error: updateError } = await supabase.from('profiles').update({ role }).eq('id', target.id).select('id');
    setBusyId('');
    if (updateError) return flash(updateError.message, 'error');
    if (!updated?.length) return flash('لم يتم تغيير صلاحية المستخدم. تحقق من صلاحيتك على الحساب ثم حاول مرة أخرى.', 'error');
    flash('تم تحديث صلاحية المستخدم.');
    load({ silent: true });
  };

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => `${u.full_name || ''} ${u.phone || ''} ${u.email || ''}`.toLowerCase().includes(q));
  }, [users, userSearch]);

  if (authLoading || !allowed || loading) {
    return <Layout><div className="page-wrap"><div className="container"><ListSkeleton rows={4}/></div></div></Layout>;
  }

  const tabs = [
    ['overview', 'نظرة عامة', LayoutDashboard],
    ['orders', 'طلبات المتاجر', ClipboardList],
    ['custom', 'الطلبات الخاصة', PackageCheck],
    ['global', 'طلبات شي إن', ExternalLink],
    ['stores', 'المتاجر', StoreIcon],
    ['users', 'المستخدمون', Users],
    ['settings', 'الإعدادات', Settings]
  ];

  const orderControls = (table, order) => {
    const finished = FINAL_STATUSES.includes(order.status);
    const statuses = adminStatusOptions(table, order);
    return (
      <div className="order-actions admin-controls">
        <div className="field compact-field">
          <label>إسناد إلى سائق</label>
          <select className="input" value={order.driver_id || ''} disabled={busyId === order.id || finished} onChange={(e) => assignDriver(table, order, e.target.value)}>
            <option value="">اختر السائق</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.full_name || d.phone || d.email}</option>)}
          </select>
        </div>
        <div className="field compact-field">
          <label>حالة الطلب</label>
          <select className="input" value={order.status} disabled={busyId === order.id || finished} onChange={(e) => setOrderStatus(table, order, e.target.value)}>
            {statuses.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
          </select>
        </div>
        {!finished && (
          <button type="button" className="btn-outline danger-outline" disabled={busyId === order.id} onClick={() => setOrderStatus(table, order, 'cancelled')}>
            <XCircle size={15}/> إلغاء
          </button>
        )}
        {!order.driver_id && !finished && (
          <span className="small">اختر سائقًا أولًا لتفعيل حالات الإسناد والتوصيل.</span>
        )}
      </div>
    );
  };

  return <Layout title="لوحة الإدارة">
    <div className="page-wrap">
      <div className="container">
        <div className="dashboard-head">
          <div>
            <span className="eyebrow">لوحة إدارة لبيه</span>
            <h1 className="page-title mt-3">مرحبًا {profile?.full_name || 'بالمدير'}</h1>
            <p className="page-lead mb-0">إدارة الطلبات والمتاجر والمستخدمين وإعدادات التوصيل.</p>
          </div>
          <button type="button" className="btn-outline" onClick={() => load()}><RefreshCw size={15}/> تحديث</button>
        </div>

        {error && <Notice type="error" onClose={() => setError('')}>{error}</Notice>}
        {ok && <Notice type="success" onClose={() => setOk('')}>{ok}</Notice>}

        <div className="tabs-row dashboard-tabs">
          {tabs.map(([key, label, Icon]) => (
            <button key={key} type="button" className={tab === key ? 'chip active' : 'chip'} onClick={() => setTab(key)}>
              <Icon size={15}/> {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <>
            <div className="stat-grid dashboard-stats admin-stats">
              <div className="stat"><span>العملاء</span><strong>{stats.customers}</strong><small>حسابات مسجلة</small></div>
              <div className="stat"><span>المتاجر</span><strong>{stats.stores}</strong><small>{stats.activeStores} نشط · {stats.pendingStores} بانتظار التفعيل</small></div>
              <div className="stat"><span>السائقون</span><strong>{stats.drivers}</strong><small>{stats.merchants} تاجر</small></div>
              <div className="stat"><span>إجمالي الطلبات</span><strong>{stats.orders}</strong><small>{stats.pendingOrders} بانتظار إجراء</small></div>
              <div className="stat"><span>طلبات مسلّمة</span><strong>{stats.delivered}</strong><small>من طلبات المتاجر</small></div>
              <div className="stat"><span>مبيعات مسلّمة</span><strong>{currency(stats.revenue)}</strong><small>إجمالي الطلبات المسلّمة</small></div>
            </div>
            <div className="panel">
              <div className="panel-head"><h2>أحدث طلبات المتاجر</h2><button type="button" className="link-btn" onClick={() => setTab('orders')}>عرض الكل</button></div>
              {orders.slice(0, 6).map((order) => (
                <div className="mini-row" key={order.id}>
                  <div><b>#{shortId(order.id)}</b><span>{order.customer_name} · {order.stores?.name || 'متجر'} · {dateTime(order.created_at)}</span></div>
                  <div><b>{currency(order.total)}</b><StatusBadge status={order.status}/></div>
                </div>
              ))}
              {!orders.length && <EmptyState title="لا توجد طلبات بعد" icon={ReceiptText}>ستظهر طلبات العملاء هنا فور وصولها.</EmptyState>}
            </div>
            <div className="quick-order-grid">
              <button type="button" className="quick-panel" onClick={() => setTab('stores')}><TrendingUp size={20}/><b>مراجعة المتاجر</b><small>{stats.pendingStores} متجر بانتظار التفعيل</small></button>
              <button type="button" className="quick-panel" onClick={() => setTab('users')}><Users size={20}/><b>إدارة الصلاحيات</b><small>تعيين التجار والسائقين</small></button>
            </div>
          </>
        )}

        {tab === 'orders' && (
          <div className="order-list">
            {orders.map((order) => (
              <div className="order-card" key={order.id}>
                <div className="order-card-head">
                  <div><b>طلب #{shortId(order.id)}</b><span className="small"> · {order.stores?.name || 'متجر'} · {dateTime(order.created_at)}</span></div>
                  <StatusBadge status={order.status}/>
                </div>
                <div className="order-card-body">
                  <div>
                    <p><b>{order.customer_name}</b> · <a href={`tel:${order.customer_phone}`} dir="ltr">{order.customer_phone}</a></p>
                    <p className="small"><MapPin size={13}/> {order.delivery_address}</p>
                    <ul className="order-items-list">
                      {(order.items || []).map((item, index) => (
                        <li key={`${item.product_id || item.name}-${index}`}><span>{item.name} × {item.quantity}</span><b>{currency(Number(item.price) * Number(item.quantity))}</b></li>
                      ))}
                    </ul>
                    <div className="order-totals"><span>المنتجات: {currency(order.subtotal)}</span><span>التوصيل: {currency(order.delivery_fee)}</span><b>الإجمالي: {currency(order.total)}</b></div>
                    {order.notes && <p className="small order-note">ملاحظات: {order.notes}</p>}
                  </div>
                  {orderControls('orders', order)}
                </div>
              </div>
            ))}
            {!orders.length && <EmptyState title="لا توجد طلبات متاجر" icon={ReceiptText}/>}
          </div>
        )}

        {tab === 'custom' && (
          <div className="order-list">
            {customs.map((order) => (
              <div className="order-card" key={order.id}>
                <div className="order-card-head">
                  <div><b>طلب #{shortId(order.id)}</b><span className="small"> · {dateTime(order.created_at)}</span></div>
                  <StatusBadge status={order.status}/>
                </div>
                <div className="order-card-body">
                  <div>
                    <p><b>{order.customer_name}</b> · <a href={`tel:${order.customer_phone}`} dir="ltr">{order.customer_phone}</a></p>
                    <p className="small"><MapPin size={13}/> {order.delivery_address}</p>
                    {order.title && <p className="track-title">{order.title}</p>}
                    <p className="preserve-lines">{order.order_text}</p>
                    {order.image_url && <a className="track-image-link" href={order.image_url} target="_blank" rel="noreferrer"><img src={order.image_url} alt="صورة الطلب"/><span><ImageIcon size={13}/> صورة الطلب</span></a>}
                    <div className="field mt-3">
                      <label>رد الإدارة (يظهر للعميل)</label>
                      <textarea
                        value={responses[order.id] ?? order.admin_response ?? ''}
                        onChange={(e) => setResponses((s) => ({ ...s, [order.id]: e.target.value }))}
                        placeholder="اكتب ردًا أو توضيحًا للعميل..."
                        maxLength={1000}
                        disabled={FINAL_STATUSES.includes(order.status)}
                      />
                      <button
                        type="button"
                        className="btn-outline align-start"
                        disabled={busyId === order.id || FINAL_STATUSES.includes(order.status)}
                        onClick={() => saveResponse(order)}
                      >
                        <Send size={15}/> حفظ الرد
                      </button>
                      {FINAL_STATUSES.includes(order.status) && <span className="small">الطلب نهائي؛ الرد للعرض فقط.</span>}
                    </div>
                  </div>
                  {orderControls('custom_orders', order)}
                </div>
              </div>
            ))}
            {!customs.length && <EmptyState title="لا توجد طلبات خاصة" icon={NotebookPen}/>}
          </div>
        )}

        {tab === 'global' && (
          <div className="order-list">
            {globals.map((order) => (
              <div className="order-card" key={order.id}>
                <div className="order-card-head">
                  <div><b>طلب #{shortId(order.id)}</b><span className="small"> · {dateTime(order.created_at)}</span></div>
                  <StatusBadge status={order.status}/>
                </div>
                <div className="order-card-body">
                  <div>
                    <p><b>{order.customer_name}</b> · <a href={`tel:${order.customer_phone}`} dir="ltr">{order.customer_phone}</a></p>
                    <p className="small"><MapPin size={13}/> {order.delivery_address}</p>
                    {order.product_image && <a className="track-image-link" href={order.product_image} target="_blank" rel="noreferrer"><img src={order.product_image} alt="صورة المنتج"/><span><ImageIcon size={13}/> صورة المنتج</span></a>}
                    <p>{order.description || 'طلب من متجر خارجي'}</p>
                    <div className="track-meta-grid">
                      {order.size && <div><span>المقاس</span><b>{order.size}</b></div>}
                      {order.color && <div><span>اللون</span><b>{order.color}</b></div>}
                      <div><span>الكمية</span><b>{order.quantity}</b></div>
                    </div>
                    {order.product_link && <a className="btn-outline mt-2" href={order.product_link} target="_blank" rel="noreferrer"><ExternalLink size={14}/> رابط المنتج</a>}
                    <div className="field mt-3 compact-field">
                      <label><Wallet size={13}/> السعر التقديري (ر.ي)</label>
                      <div className="inline-field">
                        <input
                          type="number"
                          min="0"
                          value={quotes[order.id] ?? order.estimated_price ?? ''}
                          onChange={(e) => setQuotes((s) => ({ ...s, [order.id]: e.target.value }))}
                          disabled={!QUOTABLE_STATUSES.includes(order.status)}
                        />
                        <button
                          type="button"
                          className="btn-outline"
                          disabled={busyId === order.id || !QUOTABLE_STATUSES.includes(order.status)}
                          onClick={() => quoteGlobal(order)}
                        >
                          <Send size={14}/> إرسال العرض
                        </button>
                      </div>
                      {!QUOTABLE_STATUSES.includes(order.status) && <span className="small">التسعير متاح في حالتي «بانتظار المراجعة» و«تم التسعير» فقط.</span>}
                    </div>
                  </div>
                  {orderControls('global_orders', order)}
                </div>
              </div>
            ))}
            {!globals.length && <EmptyState title="لا توجد طلبات شي إن" icon={ShoppingBag}/>}
          </div>
        )}

        {tab === 'stores' && (
          <>
            <form className="form-card mx-0 mb-5" onSubmit={createStore}>
              <h2 className="section-title"><Plus size={18}/> إضافة متجر</h2>
              <div className="split">
                <div className="field"><label>اسم المتجر</label><input required value={storeForm.name} onChange={(e) => setStoreForm((s) => ({ ...s, name: e.target.value }))} maxLength={80}/></div>
                <div className="field">
                  <label>ربط حساب التاجر</label>
                  <select value={storeForm.owner_id} onChange={(e) => setStoreForm((s) => ({ ...s, owner_id: e.target.value }))}>
                    <option value="">بدون مالك حاليًا</option>
                    {merchants.map((m) => <option key={m.id} value={m.id}>{m.full_name || m.email || m.phone}</option>)}
                  </select>
                  <span className="small">غيّر صلاحية المستخدم إلى «تاجر» من تبويب المستخدمين أولًا ليظهر هنا.</span>
                </div>
                <div className="field"><label>المنطقة</label><input value={storeForm.area} onChange={(e) => setStoreForm((s) => ({ ...s, area: e.target.value }))}/></div>
                <div className="field"><label>التصنيف</label><input value={storeForm.category} onChange={(e) => setStoreForm((s) => ({ ...s, category: e.target.value }))} placeholder="مطاعم، سوبرماركت..."/></div>
                <div className="field"><label>وصف المتجر</label><input value={storeForm.description} onChange={(e) => setStoreForm((s) => ({ ...s, description: e.target.value }))} maxLength={500}/></div>
                <div className="field"><label>Latitude</label><input dir="ltr" value={storeForm.lat} onChange={(e) => setStoreForm((s) => ({ ...s, lat: e.target.value }))}/></div>
                <div className="field"><label>Longitude</label><input dir="ltr" value={storeForm.lng} onChange={(e) => setStoreForm((s) => ({ ...s, lng: e.target.value }))}/></div>
              </div>
              <button className="btn-primary" disabled={creatingStore}><Plus size={16}/> {creatingStore ? 'جارٍ الإنشاء...' : 'إنشاء المتجر'}</button>
              <p className="small mt-2">ينشأ المتجر بحالة «قيد المراجعة». فعّله من الجدول ليظهر للعملاء.</p>
            </form>

            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>المتجر</th><th>المالك</th><th>المنطقة</th><th>الحالة</th><th>الاستقبال</th><th>الإجراءات</th></tr></thead>
                <tbody>
                  {stores.map((store) => {
                    const owner = userById[store.owner_id];
                    return (
                      <tr key={store.id}>
                        <td><b>{store.name}</b>{store.category ? <div className="small">{store.category}</div> : null}</td>
                        <td>{owner ? (owner.full_name || owner.email || owner.phone) : '—'}</td>
                        <td>{store.area || '—'}</td>
                        <td><span className={store.status === 'active' ? 'status status-success' : store.status === 'suspended' ? 'status status-danger' : 'status status-warn'}>{store.status === 'active' ? 'نشط' : store.status === 'suspended' ? 'موقوف' : 'قيد المراجعة'}</span></td>
                        <td><button type="button" className={store.is_open ? 'status status-success' : 'status'} disabled={busyId === store.id} onClick={() => toggleStoreOpen(store)}>{store.is_open ? 'مفتوح' : 'مغلق'}</button></td>
                        <td>
                          <div className="table-actions">
                            {store.status !== 'active' && <button type="button" className="btn-outline" disabled={busyId === store.id} onClick={() => setStoreStatus(store, 'active')}><CheckCircle2 size={14}/> تفعيل</button>}
                            {store.status === 'active' && <button type="button" className="btn-outline danger-outline" disabled={busyId === store.id} onClick={() => setStoreStatus(store, 'suspended')}><XCircle size={14}/> إيقاف</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!stores.length && <EmptyState title="لا توجد متاجر" icon={StoreIcon}>أنشئ أول متجر من النموذج أعلاه.</EmptyState>}
            </div>
          </>
        )}

        {tab === 'users' && (
          <>
            <div className="tabs-row">
              <span className="status">العملاء: {stats.customers}</span>
              <span className="status">التجار: {stats.merchants}</span>
              <span className="status">السائقون: {stats.drivers}</span>
            </div>
            <label className="home-search list-search">
              <Search size={18}/>
              <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="ابحث بالاسم أو الجوال أو البريد"/>
            </label>
            <div className="table-wrap">
              <table className="data-table">
                <thead><tr><th>الاسم</th><th>البريد الإلكتروني</th><th>الجوال</th><th>الصلاحية</th><th>تاريخ التسجيل</th></tr></thead>
                <tbody>
                  {filteredUsers.map((u) => (
                    <tr key={u.id}>
                      <td><b>{u.full_name || 'بدون اسم'}</b>{u.id === user?.id ? <div className="small">حسابك الحالي</div> : null}</td>
                      <td dir="ltr">{u.email || '—'}</td>
                      <td dir="ltr">{u.phone || '—'}</td>
                      <td>
                        <select className="input" value={u.role} disabled={busyId === u.id || u.id === user?.id} onChange={(e) => changeRole(u, e.target.value)}>
                          <option value="customer">عميل</option>
                          <option value="merchant">تاجر</option>
                          <option value="driver">سائق</option>
                          <option value="admin">مدير منصة</option>
                        </select>
                      </td>
                      <td className="small">{dateTime(u.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filteredUsers.length && <EmptyState title="لا يوجد مستخدمون مطابقون" icon={UserRound}/>}
            </div>
            <Notice type="info">تغيير الصلاحية يتم على الخادم عبر RLS؛ يمنع النظام أي مستخدم غير مدير من تعديل الأدوار.</Notice>
          </>
        )}

        {tab === 'settings' && (
          <form className="form-card mx-0" onSubmit={saveSettings}>
            <h2 className="section-title"><Settings size={18}/> إعدادات المنصة</h2>
            <div className="split">
              <div className="field"><label>عمولة المنصة (%)</label><input type="number" min="0" max="100" value={settings.commission_percent} onChange={(e) => setSettings((s) => ({ ...s, commission_percent: e.target.value }))}/></div>
              <div className="field"><label>رسوم أول 2 كم (ر.ي)</label><input type="number" min="0" value={settings.delivery_base_fee} onChange={(e) => setSettings((s) => ({ ...s, delivery_base_fee: e.target.value }))}/></div>
              <div className="field"><label>رسوم كل كم إضافي (ر.ي)</label><input type="number" min="0" value={settings.delivery_per_km} onChange={(e) => setSettings((s) => ({ ...s, delivery_per_km: e.target.value }))}/></div>
              <div className="field"><label>رقم التواصل</label><input dir="ltr" value={settings.contact_phone} onChange={(e) => setSettings((s) => ({ ...s, contact_phone: e.target.value }))}/></div>
              <div className="field"><label>رقم واتساب الدولي</label><input dir="ltr" value={settings.whatsapp_number} onChange={(e) => setSettings((s) => ({ ...s, whatsapp_number: e.target.value }))} placeholder="9677xxxxxxxx"/></div>
              <div className="field"><label>رابط Instagram</label><input dir="ltr" value={settings.instagram_url} onChange={(e) => setSettings((s) => ({ ...s, instagram_url: e.target.value }))}/></div>
              <div className="field"><label>رابط Facebook</label><input dir="ltr" value={settings.facebook_url} onChange={(e) => setSettings((s) => ({ ...s, facebook_url: e.target.value }))}/></div>
            </div>
            <button className="btn-primary" disabled={savingSettings}><Save size={16}/> {savingSettings ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'}</button>
            <p className="small mt-3"><Truck size={13}/> تُستخدم هذه القيم في احتساب رسوم التوصيل على الخادم: {settings.delivery_base_fee} ر.ي لأول 2 كم ثم {settings.delivery_per_km} ر.ي لكل كم إضافي.</p>
          </form>
        )}
      </div>
    </div>
  </Layout>;
}
