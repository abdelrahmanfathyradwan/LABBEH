import { useEffect, useMemo, useState } from 'react';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ListSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuthGuard } from '../lib/useAuth';
import { uploadImage } from '../lib/storage';
import { currency, dateTime, shortId, safeError } from '../lib/format';
import {
  Store as StoreIcon, Package, ClipboardList, Settings, Plus, Pencil, Trash2, Eye, EyeOff,
  Upload, Save, RefreshCw, Phone, MapPin, X, ShoppingBag, BadgeCheck, TrendingUp, ReceiptText
} from 'lucide-react';

const emptyStore = { name: '', description: '', area: 'عزان', category: '', phone: '', lat: '', lng: '', logo_url: '', cover_url: '', is_open: true };
const emptyProduct = { name: '', description: '', price: '', old_price: '', stock: 10, category: '', image_url: '' };

export default function StoreAdmin() {
  const { user, profile, loading: authLoading, allowed } = useAuthGuard(['merchant', 'admin']);
  const [stores, setStores] = useState([]);
  const [storeId, setStoreId] = useState('');
  const [storeForm, setStoreForm] = useState(emptyStore);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [storeSaving, setStoreSaving] = useState(false);
  const [productEditor, setProductEditor] = useState(null);
  const [productFile, setProductFile] = useState(null);
  const [productSaving, setProductSaving] = useState(false);
  const [busyId, setBusyId] = useState('');

  const store = stores.find((s) => s.id === storeId) || null;

  const loadStores = async (uid) => {
    try {
      const { data, error: loadError } = await supabase
        .from('stores')
        .select('*')
        .eq('owner_id', uid)
        .order('created_at', { ascending: true });
      if (loadError) {
        setError(safeError(loadError));
        return;
      }
      setStores(data || []);
      setStoreId((current) => current || data?.[0]?.id || '');
    } catch (e) {
      setError(safeError(e));
    } finally {
      setLoading(false);
    }
  };

  const loadProducts = async (sid) => {
    try {
      const { data, error: loadError } = await supabase
        .from('products')
        .select('*')
        .eq('store_id', sid)
        .order('created_at', { ascending: false });
      if (loadError) setError(safeError(loadError));
      else setProducts(data || []);
    } catch (e) {
      setError(safeError(e));
    }
  };

  const loadOrders = async (sid) => {
    try {
      const { data, error: loadError } = await supabase
        .from('orders')
        .select('*')
        .eq('store_id', sid)
        .order('created_at', { ascending: false })
        .limit(100);
      if (loadError) setError(safeError(loadError));
      else setOrders(data || []);
    } catch (e) {
      setError(safeError(e));
    }
  };

  useEffect(() => {
    if (allowed && user) loadStores(user.id);
  }, [allowed, user]);

  useEffect(() => {
    if (!storeId) return;
    loadProducts(storeId);
    loadOrders(storeId);
    const current = stores.find((s) => s.id === storeId);
    if (current) {
      setStoreForm({
        name: current.name || '',
        description: current.description || '',
        area: current.area || 'عزان',
        category: current.category || '',
        phone: current.phone || '',
        lat: current.lat ?? '',
        lng: current.lng ?? '',
        logo_url: current.logo_url || '',
        cover_url: current.cover_url || '',
        is_open: current.is_open !== false
      });
    }
  }, [storeId, stores]);

  useEffect(() => {
    if (!storeId || !supabase) return undefined;
    const channel = supabase
      .channel(`store-orders-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `store_id=eq.${storeId}` }, () => loadOrders(storeId))
      .subscribe();
    // Realtime can be disabled on a project; polling keeps the dashboard fresh.
    const timer = setInterval(() => loadOrders(storeId), 30000);
    return () => { supabase.removeChannel(channel); clearInterval(timer); };
  }, [storeId]);

  const stats = useMemo(() => {
    const pending = orders.filter((o) => o.status === 'pending').length;
    const delivered = orders.filter((o) => o.status === 'delivered');
    const revenue = delivered.reduce((sum, o) => sum + Number(o.total || 0), 0);
    return {
      products: products.length,
      activeProducts: products.filter((p) => p.is_active).length,
      orders: orders.length,
      pending,
      delivered: delivered.length,
      revenue
    };
  }, [orders, products]);

  const flash = (message, type = 'success') => {
    if (type === 'error') { setError(message); setOk(''); }
    else { setOk(message); setError(''); }
  };

  const saveStore = async (e) => {
    e.preventDefault();
    if (!storeId) return;
    if (!storeForm.name.trim()) return flash('اسم المتجر مطلوب.', 'error');
    setStoreSaving(true);
    try {
      const { data: updated, error: saveError } = await supabase
        .from('stores')
        .update({
          name: storeForm.name.trim(),
          description: storeForm.description.trim(),
          area: storeForm.area.trim() || 'عزان',
          category: storeForm.category.trim() || null,
          phone: storeForm.phone.trim() || null,
          lat: storeForm.lat === '' ? null : Number(storeForm.lat),
          lng: storeForm.lng === '' ? null : Number(storeForm.lng),
          logo_url: storeForm.logo_url.trim() || null,
          cover_url: storeForm.cover_url.trim() || null,
          is_open: storeForm.is_open
        })
        .eq('id', storeId)
        .select('id');
      if (saveError) throw saveError;
      if (!updated?.length) throw new Error('لم يتم حفظ بيانات المتجر. تحقق من صلاحيتك على هذا المتجر ثم حاول مرة أخرى.');
      flash('تم حفظ بيانات المتجر.');
      loadStores(user.id);
    } catch (err) {
      flash(safeError(err), 'error');
    } finally {
      setStoreSaving(false);
    }
  };

  const uploadStoreImage = async (kind, file) => {
    if (!file || !storeId) return;
    setBusyId(kind);
    try {
      const url = await uploadImage('product-images', storeId, file);
      const patch = kind === 'logo' ? { logo_url: url } : { cover_url: url };
      const { data: updated, error: updateError } = await supabase.from('stores').update(patch).eq('id', storeId).select('id');
      if (updateError) throw updateError;
      if (!updated?.length) throw new Error('تم رفع الصورة لكن تعذر ربطها بالمتجر. تحقق من صلاحيتك ثم حاول مرة أخرى.');
      setStoreForm((s) => ({ ...s, ...patch }));
      flash('تم رفع الصورة.');
      loadStores(user.id);
    } catch (err) {
      flash(err?.message || 'تعذر رفع الصورة.', 'error');
    } finally {
      setBusyId('');
    }
  };

  const openProductEditor = (product) => {
    setProductFile(null);
    if (product) {
      setProductEditor({
        id: product.id,
        name: product.name || '',
        description: product.description || '',
        price: product.price ?? '',
        old_price: product.old_price ?? '',
        stock: product.stock ?? 0,
        category: product.category || '',
        image_url: product.images?.[0] || ''
      });
    } else {
      setProductEditor({ ...emptyProduct });
    }
  };

  const saveProduct = async (e) => {
    e.preventDefault();
    if (!productEditor) return;
    if (!productEditor.name.trim()) return flash('اسم المنتج مطلوب.', 'error');
    if (Number(productEditor.price) <= 0) return flash('سعر المنتج يجب أن يكون أكبر من صفر.', 'error');
    setProductSaving(true);
    try {
      let imageUrl = productEditor.image_url.trim();
      if (productFile) imageUrl = await uploadImage('product-images', storeId, productFile);
      const payload = {
        store_id: storeId,
        name: productEditor.name.trim(),
        description: productEditor.description.trim(),
        price: Number(productEditor.price),
        old_price: productEditor.old_price === '' ? null : Number(productEditor.old_price),
        stock: Math.max(0, Number(productEditor.stock) || 0),
        category: productEditor.category.trim() || null,
        images: imageUrl ? [imageUrl] : []
      };
      const query = productEditor.id
        ? supabase.from('products').update(payload).eq('id', productEditor.id).select('id')
        : supabase.from('products').insert({ ...payload, is_active: true }).select('id');
      const { data: saved, error: saveError } = await query;
      if (saveError) throw saveError;
      if (!saved?.length) throw new Error(productEditor.id
        ? 'لم يتم تحديث المنتج. تحقق من صلاحيتك على هذا المتجر ثم حاول مرة أخرى.'
        : 'لم تتم إضافة المنتج. تحقق من صلاحيتك على هذا المتجر ثم حاول مرة أخرى.');
      flash(productEditor.id ? 'تم تحديث المنتج.' : 'تمت إضافة المنتج.');
      setProductEditor(null);
      setProductFile(null);
      loadProducts(storeId);
    } catch (err) {
      flash(err?.message || 'تعذر حفظ المنتج.', 'error');
    } finally {
      setProductSaving(false);
    }
  };

  const toggleProduct = async (product) => {
    setBusyId(product.id);
    try {
      const { data: updated, error: updateError } = await supabase.from('products').update({ is_active: !product.is_active }).eq('id', product.id).select('id');
      if (updateError) throw updateError;
      if (!updated?.length) throw new Error('لم يتم تغيير حالة المنتج. تحقق من صلاحيتك على هذا المتجر ثم حاول مرة أخرى.');
      loadProducts(storeId);
    } catch (err) {
      flash(safeError(err), 'error');
    } finally {
      setBusyId('');
    }
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`سيتم حذف المنتج "${product.name}" نهائيًا. هل تريد المتابعة؟`)) return;
    setBusyId(product.id);
    try {
      const { data: deleted, error: deleteError } = await supabase.from('products').delete().eq('id', product.id).select('id');
      if (deleteError) throw deleteError;
      if (!deleted?.length) throw new Error('لم يتم حذف المنتج. تحقق من صلاحيتك على هذا المتجر ثم حاول مرة أخرى.');
      flash('تم حذف المنتج.');
      loadProducts(storeId);
    } catch (err) {
      flash(safeError(err), 'error');
    } finally {
      setBusyId('');
    }
  };

  const updateOrder = async (order, status) => {
    if (status === 'cancelled' && !window.confirm('سيتم رفض/إلغاء الطلب. هل تريد المتابعة؟')) return;
    setBusyId(order.id);
    try {
      const { data: updated, error: updateError } = await supabase.from('orders').update({ status }).eq('id', order.id).select('id');
      if (updateError) throw updateError;
      if (!updated?.length) throw new Error('لم يتم تحديث الطلب. قد تكون حالته تغيّرت؛ حدّث الصفحة ثم حاول مرة أخرى.');
      flash(status === 'processing' ? 'تم قبول الطلب وبدأ تجهيزه.' : 'تم إلغاء الطلب.');
      loadOrders(storeId);
    } catch (err) {
      flash(safeError(err), 'error');
    } finally {
      setBusyId('');
    }
  };

  if (authLoading || !allowed || loading) {
    return <Layout><div className="page-wrap"><div className="container"><ListSkeleton rows={3}/></div></div></Layout>;
  }

  const tabs = [
    ['overview', 'نظرة عامة', TrendingUp],
    ['orders', 'الطلبات', ClipboardList],
    ['products', 'المنتجات', Package],
    ['store', 'بيانات المتجر', Settings]
  ];

  return <Layout title="لوحة التاجر">
    <div className="page-wrap">
      <div className="container">
        <div className="dashboard-head">
          <div>
            <span className="eyebrow">لوحة التاجر</span>
            <h1 className="page-title mt-3">{store?.name || 'متجري'}</h1>
            <p className="page-lead mb-0">إدارة منتجات متجرك، طلبات العملاء، وبيانات المتجر.</p>
          </div>
          <div className="dashboard-actions">
            {stores.length > 1 && (
              <select className="input" value={storeId} onChange={(e) => setStoreId(e.target.value)} aria-label="اختيار المتجر">
                {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <button type="button" className="btn-outline" onClick={() => { if (storeId) { loadProducts(storeId); loadOrders(storeId); } }}>
              <RefreshCw size={15}/> تحديث
            </button>
          </div>
        </div>

        {error && <Notice type="error" onClose={() => setError('')}>{error}</Notice>}
        {ok && <Notice type="success" onClose={() => setOk('')}>{ok}</Notice>}
        {profile?.role === 'admin' && <Notice type="info">أنت مسجل كمدير منصة؛ هذه اللوحة تعرض المتاجر المرتبطة بحسابك فقط.</Notice>}

        {!store ? (
          <EmptyState title="لا يوجد متجر مرتبط بحسابك" icon={StoreIcon}>
            تواصل مع إدارة لبيه لإنشاء متجرك وربطه بحسابك.
          </EmptyState>
        ) : (
          <>
            <div className="tabs-row dashboard-tabs">
              {tabs.map(([key, label, Icon]) => (
                <button key={key} type="button" className={tab === key ? 'chip active' : 'chip'} onClick={() => setTab(key)}>
                  <Icon size={15}/> {label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <>
                <div className="stat-grid dashboard-stats">
                  <div className="stat"><span>المنتجات</span><strong>{stats.products}</strong><small>{stats.activeProducts} نشط</small></div>
                  <div className="stat"><span>طلبات جديدة</span><strong>{stats.pending}</strong><small>بانتظار القبول</small></div>
                  <div className="stat"><span>إجمالي الطلبات</span><strong>{stats.orders}</strong><small>{stats.delivered} تم تسليمها</small></div>
                  <div className="stat"><span>مبيعات مسلّمة</span><strong>{currency(stats.revenue)}</strong><small>من الطلبات المسلّمة</small></div>
                </div>
                <div className="panel">
                  <div className="panel-head"><h2>أحدث الطلبات</h2><button type="button" className="link-btn" onClick={() => setTab('orders')}>عرض الكل</button></div>
                  {orders.slice(0, 5).map((order) => (
                    <div className="mini-row" key={order.id}>
                      <div><b>#{shortId(order.id)}</b><span>{order.customer_name} · {dateTime(order.created_at)}</span></div>
                      <div><b>{currency(order.total)}</b><StatusBadge status={order.status}/></div>
                    </div>
                  ))}
                  {!orders.length && <EmptyState title="لا توجد طلبات بعد" icon={ReceiptText}>ستظهر طلبات عملائك هنا مباشرة.</EmptyState>}
                </div>
              </>
            )}

            {tab === 'orders' && (
              <div className="order-list">
                {orders.map((order) => (
                  <div className="order-card" key={order.id}>
                    <div className="order-card-head">
                      <div>
                        <b>طلب #{shortId(order.id)}</b>
                        <span className="small"> · {dateTime(order.created_at)}</span>
                      </div>
                      <StatusBadge status={order.status}/>
                    </div>
                    <div className="order-card-body">
                      <div>
                        <p><b>{order.customer_name}</b> · <a href={`tel:${order.customer_phone}`} dir="ltr">{order.customer_phone}</a></p>
                        <p className="small"><MapPin size={13}/> {order.delivery_address}</p>
                        {order.notes && <p className="small order-note">ملاحظات: {order.notes}</p>}
                        <ul className="order-items-list">
                          {(order.items || []).map((item, index) => (
                            <li key={`${item.product_id || item.name}-${index}`}>
                              <span>{item.name} × {item.quantity}</span>
                              <b>{currency(Number(item.price) * Number(item.quantity))}</b>
                            </li>
                          ))}
                        </ul>
                        <div className="order-totals">
                          <span>المنتجات: {currency(order.subtotal)}</span>
                          <span>التوصيل: {currency(order.delivery_fee)}</span>
                          <b>الإجمالي: {currency(order.total)}</b>
                        </div>
                      </div>
                      <div className="order-actions">
                        {order.status === 'pending' && (
                          <>
                            <button type="button" className="btn-primary" disabled={busyId === order.id} onClick={() => updateOrder(order, 'processing')}>
                              <BadgeCheck size={16}/> قبول الطلب
                            </button>
                            <button type="button" className="btn-outline danger-outline" disabled={busyId === order.id} onClick={() => updateOrder(order, 'cancelled')}>
                              <X size={16}/> رفض الطلب
                            </button>
                          </>
                        )}
                        {order.status === 'processing' && (
                          <span className="small">تم قبول الطلب. بانتظار إسناد السائق من الإدارة.</span>
                        )}
                        {['assigned', 'on_delivery', 'delivered', 'cancelled'].includes(order.status) && (
                          <span className="small">لا يوجد إجراء مطلوب من المتجر حاليًا.</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {!orders.length && <EmptyState title="لا توجد طلبات بعد" icon={ReceiptText}>ستظهر طلبات عملائك هنا مباشرة.</EmptyState>}
              </div>
            )}

            {tab === 'products' && (
              <>
                <div className="panel-head">
                  <h2>المنتجات ({products.length})</h2>
                  <button type="button" className="btn-primary" onClick={() => openProductEditor(null)}><Plus size={16}/> إضافة منتج</button>
                </div>
                {!products.length ? (
                  <EmptyState title="لا توجد منتجات" icon={Package}>أضف أول منتج ليظهر للعملاء في متجرك.</EmptyState>
                ) : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>المنتج</th><th>السعر</th><th>المخزون</th><th>التصنيف</th><th>الحالة</th><th>الإجراءات</th></tr></thead>
                      <tbody>
                        {products.map((product) => (
                          <tr key={product.id}>
                            <td>
                              <div className="table-product">
                                <span className="table-thumb">{product.images?.[0] ? <img src={product.images[0]} alt={product.name}/> : <ShoppingBag size={16}/>}</span>
                                <div><b>{product.name}</b><span className="small">{product.description || '—'}</span></div>
                              </div>
                            </td>
                            <td>{currency(product.price)}{product.old_price ? <div className="small"><s>{currency(product.old_price)}</s></div> : null}</td>
                            <td>{product.stock}</td>
                            <td>{product.category || '—'}</td>
                            <td><span className={product.is_active ? 'status status-success' : 'status'}>{product.is_active ? 'نشط' : 'مخفي'}</span></td>
                            <td>
                              <div className="table-actions">
                                <button type="button" className="icon-btn" title="تعديل" onClick={() => openProductEditor(product)}><Pencil size={15}/></button>
                                <button type="button" className="icon-btn" title={product.is_active ? 'إخفاء' : 'إظهار'} disabled={busyId === product.id} onClick={() => toggleProduct(product)}>
                                  {product.is_active ? <EyeOff size={15}/> : <Eye size={15}/>}
                                </button>
                                <button type="button" className="icon-btn danger" title="حذف" disabled={busyId === product.id} onClick={() => deleteProduct(product)}><Trash2 size={15}/></button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {tab === 'store' && (
              <form className="form-card mx-0" onSubmit={saveStore}>
                <h2 className="section-title"><StoreIcon size={18}/> بيانات المتجر</h2>
                <div className="split">
                  <div className="field"><label>اسم المتجر</label><input required value={storeForm.name} onChange={(e) => setStoreForm((s) => ({ ...s, name: e.target.value }))} maxLength={80}/></div>
                  <div className="field"><label>التصنيف</label><input value={storeForm.category} onChange={(e) => setStoreForm((s) => ({ ...s, category: e.target.value }))} placeholder="مطاعم، سوبرماركت..." maxLength={40}/></div>
                </div>
                <div className="field"><label>وصف المتجر</label><textarea value={storeForm.description} onChange={(e) => setStoreForm((s) => ({ ...s, description: e.target.value }))} maxLength={500}/></div>
                <div className="split">
                  <div className="field"><label>المنطقة</label><input value={storeForm.area} onChange={(e) => setStoreForm((s) => ({ ...s, area: e.target.value }))}/></div>
                  <div className="field"><label><Phone size={13}/> رقم التواصل</label><input dir="ltr" value={storeForm.phone} onChange={(e) => setStoreForm((s) => ({ ...s, phone: e.target.value }))}/></div>
                </div>
                <div className="split">
                  <div className="field"><label>Latitude (لحساب رسوم التوصيل)</label><input dir="ltr" value={storeForm.lat} onChange={(e) => setStoreForm((s) => ({ ...s, lat: e.target.value }))}/></div>
                  <div className="field"><label>Longitude</label><input dir="ltr" value={storeForm.lng} onChange={(e) => setStoreForm((s) => ({ ...s, lng: e.target.value }))}/></div>
                </div>
                <label className="switch-row">
                  <input type="checkbox" checked={storeForm.is_open} onChange={(e) => setStoreForm((s) => ({ ...s, is_open: e.target.checked }))}/>
                  <span>المتجر مفتوح ويستقبل الطلبات</span>
                </label>
                <div className="split mt-4">
                  <div className="field">
                    <label>شعار المتجر</label>
                    <input dir="ltr" value={storeForm.logo_url} onChange={(e) => setStoreForm((s) => ({ ...s, logo_url: e.target.value }))} placeholder="https://..."/>
                    <label className="upload-btn"><Upload size={15}/> {busyId === 'logo' ? 'جارٍ الرفع...' : 'رفع شعار'}<input type="file" accept="image/*" onChange={(e) => uploadStoreImage('logo', e.target.files?.[0])}/></label>
                  </div>
                  <div className="field">
                    <label>صورة الغلاف</label>
                    <input dir="ltr" value={storeForm.cover_url} onChange={(e) => setStoreForm((s) => ({ ...s, cover_url: e.target.value }))} placeholder="https://..."/>
                    <label className="upload-btn"><Upload size={15}/> {busyId === 'cover' ? 'جارٍ الرفع...' : 'رفع غلاف'}<input type="file" accept="image/*" onChange={(e) => uploadStoreImage('cover', e.target.files?.[0])}/></label>
                  </div>
                </div>
                <button className="btn-primary" disabled={storeSaving}><Save size={16}/> {storeSaving ? 'جارٍ الحفظ...' : 'حفظ بيانات المتجر'}</button>
                <p className="small mt-3">تغيير حالة المتجر (تفعيل/إيقاف) متاح لإدارة المنصة فقط.</p>
              </form>
            )}
          </>
        )}

        {productEditor && (
          <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="منتج" onClick={() => setProductEditor(null)}>
            <form className="modal product-modal" onSubmit={saveProduct} onClick={(e) => e.stopPropagation()}>
              <button type="button" className="modal-close" onClick={() => setProductEditor(null)} aria-label="إغلاق"><X size={18}/></button>
              <h2>{productEditor.id ? 'تعديل المنتج' : 'إضافة منتج'}</h2>
              <div className="field"><label>اسم المنتج</label><input required value={productEditor.name} onChange={(e) => setProductEditor((s) => ({ ...s, name: e.target.value }))} maxLength={100}/></div>
              <div className="field"><label>الوصف</label><textarea value={productEditor.description} onChange={(e) => setProductEditor((s) => ({ ...s, description: e.target.value }))} maxLength={500}/></div>
              <div className="split">
                <div className="field"><label>السعر (ر.ي)</label><input type="number" min="1" required value={productEditor.price} onChange={(e) => setProductEditor((s) => ({ ...s, price: e.target.value }))}/></div>
                <div className="field"><label>السعر قبل الخصم (اختياري)</label><input type="number" min="0" value={productEditor.old_price} onChange={(e) => setProductEditor((s) => ({ ...s, old_price: e.target.value }))}/></div>
              </div>
              <div className="split">
                <div className="field"><label>المخزون</label><input type="number" min="0" value={productEditor.stock} onChange={(e) => setProductEditor((s) => ({ ...s, stock: e.target.value }))}/></div>
                <div className="field"><label>التصنيف</label><input value={productEditor.category} onChange={(e) => setProductEditor((s) => ({ ...s, category: e.target.value }))} placeholder="مثال: مشروبات" maxLength={40}/></div>
              </div>
              <div className="field">
                <label>صورة المنتج</label>
                {productEditor.image_url && <img className="modal-product-preview" src={productEditor.image_url} alt="معاينة المنتج"/>}
                <input dir="ltr" value={productEditor.image_url} onChange={(e) => setProductEditor((s) => ({ ...s, image_url: e.target.value }))} placeholder="https://..."/>
                <label className="upload-btn"><Upload size={15}/> {productFile ? productFile.name : 'رفع صورة'}<input type="file" accept="image/*" onChange={(e) => setProductFile(e.target.files?.[0] || null)}/></label>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-primary" disabled={productSaving}><Save size={16}/> {productSaving ? 'جارٍ الحفظ...' : 'حفظ المنتج'}</button>
                <button type="button" className="btn-outline" onClick={() => setProductEditor(null)}>إلغاء</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  </Layout>;
}
