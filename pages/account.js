import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import EmptyState from '../components/EmptyState';
import StatusBadge from '../components/StatusBadge';
import { ListSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuthGuard } from '../lib/useAuth';
import { roleHome, roleLabel, signOut } from '../lib/auth';
import { currency, dateTime, shortId, safeError } from '../lib/format';
import { ClipboardList, LogOut, Save, UserRound, Store, ArrowLeft, PackageOpen, Phone, Mail, ShieldCheck } from 'lucide-react';

const tabs = [
  ['orders', 'طلبات المتاجر'],
  ['custom_orders', 'طلباتي الخاصة'],
  ['global_orders', 'طلبات شي إن']
];

export default function Account() {
  const router = useRouter();
  const { user, profile, loading, error: authError, allowed } = useAuthGuard();
  const [tab, setTab] = useState('orders');
  const [orders, setOrders] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [form, setForm] = useState({ full_name: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (profile) setForm({ full_name: profile.full_name || '', phone: profile.phone || '' });
  }, [profile]);

  const loadOrders = useCallback(async (type, userId) => {
    if (!supabase || !userId) return;
    setListLoading(true);
    setListError('');
    setOrders([]);
    try {
      const select = type === 'orders' ? '*, stores(name)' : '*';
      const { data, error } = await supabase
        .from(type)
        .select(select)
        .eq('customer_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) setListError(safeError(error));
      else setOrders(data || []);
    } catch (e) {
      setListError(safeError(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed && user) loadOrders(tab, user.id);
  }, [allowed, user, tab, loadOrders]);

  const saveProfile = async (e) => {
    e.preventDefault();
    if (!supabase || !user) return;
    setSaveOk('');
    setSaveError('');
    setSaving(true);
    try {
      const { data: updated, error } = await supabase
        .from('profiles')
        .update({ full_name: form.full_name.trim(), phone: form.phone.trim() || null })
        .eq('id', user.id)
        .select('id');
      if (error) {
        setSaveError(/duplicate|unique/i.test(error.message)
          ? 'رقم الجوال مسجل لحساب آخر. استخدم رقمًا مختلفًا.'
          : safeError(error));
        return;
      }
      if (!updated?.length) {
        setSaveError('لم يتم تحديث بياناتك. تحقق من صلاحية الحساب ثم حاول مرة أخرى.');
        return;
      }
      setSaveOk('تم حفظ بيانات حسابك.');
    } catch (e) {
      setSaveError(safeError(e));
    } finally {
      setSaving(false);
    }
  };

  const logout = async () => {
    await signOut();
    router.push('/');
  };

  if (loading || !allowed) {
    return <Layout><div className="page-wrap"><div className="container"><ListSkeleton rows={2} /></div></div></Layout>;
  }

  const signedIn = profile || {};
  const initial = (signedIn.full_name || 'ل').trim().charAt(0) || 'ل';

  return <Layout title="حسابي">
    <div className="page-wrap">
      <div className="container">
        <section className="profile-hero">
          <span className="profile-avatar" aria-hidden="true">{initial}</span>
          <div className="profile-main">
            <h1>{signedIn.full_name || 'مرحبًا بك في لبيه'}</h1>
            <p dir="ltr" style={{ textAlign: 'start' }}>{user?.email}</p>
            <div className="profile-chips">
              <span className="profile-chip"><ShieldCheck size={12}/> {roleLabel(signedIn.role)}</span>
              {signedIn.phone && <span className="profile-chip"><Phone size={12}/> <span dir="ltr">{signedIn.phone}</span></span>}
            </div>
          </div>
          <div className="profile-actions">
            {signedIn.role && signedIn.role !== 'customer' && (
              <Link className="btn-outline" href={roleHome(signedIn.role)}>لوحة {roleLabel(signedIn.role)}</Link>
            )}
            <button className="btn-outline danger-outline" onClick={logout}><LogOut size={16}/> تسجيل الخروج</button>
          </div>
        </section>

        {authError && <Notice type="error">{authError}</Notice>}

        <div className="account-grid">
          <form className="form-card mx-0" onSubmit={saveProfile}>
            <h2 className="section-title"><UserRound size={18}/> بيانات الحساب</h2>
            {saveError && <Notice type="error">{saveError}</Notice>}
            {saveOk && <Notice type="success">{saveOk}</Notice>}
            <div className="field">
              <label>الاسم الكامل</label>
              <input value={form.full_name} onChange={(e) => setForm((s) => ({ ...s, full_name: e.target.value }))} maxLength={80} />
            </div>
            <div className="field">
              <label><Phone size={13}/> رقم الجوال</label>
              <input dir="ltr" type="tel" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} placeholder="+9677xxxxxxxx" maxLength={20} />
            </div>
            <div className="field">
              <label><Mail size={13}/> البريد الإلكتروني</label>
              <input dir="ltr" value={user?.email || ''} disabled readOnly />
              <span className="small">تسجيل الدخول يتم عبر رمز يُرسل إلى هذا البريد.</span>
            </div>
            <button className="btn-primary" disabled={saving}><Save size={16}/> {saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}</button>
          </form>

          <section className="panel">
            <h2 className="section-title"><ClipboardList size={18}/> طلباتي</h2>
            <div className="tabs-row">
              {tabs.map(([key, label]) => (
                <button key={key} className={tab === key ? 'chip active' : 'chip'} onClick={() => setTab(key)}>{label}</button>
              ))}
            </div>

            {listError && <Notice type="error">{listError}</Notice>}
            {listLoading ? <ListSkeleton rows={3}/> : !orders.length ? (
              <EmptyState title="لا توجد طلبات بعد" icon={ClipboardList}>
                تصفح المتاجر أو أرسل طلبك الخاص ليظهر هنا.
              </EmptyState>
            ) : (
              <div className="order-list">
                {orders.map((order) => (
                  <div className="account-order" key={order.id}>
                    <div className="account-order-main">
                      <div className="order-topline">
                        <b>#{shortId(order.id)}</b>
                        <StatusBadge status={order.status} />
                      </div>
                      {tab === 'orders' && (
                        <p><Store size={14}/> {order.stores?.name || 'متجر'} · {currency(order.total)}</p>
                      )}
                      {tab === 'custom_orders' && (
                        <p><PackageOpen size={14}/> {order.title || order.order_text}</p>
                      )}
                      {tab === 'global_orders' && (
                        <p><PackageOpen size={14}/> {order.description || order.product_link || 'طلب من شي إن'}</p>
                      )}
                      <span className="small">{dateTime(order.created_at)}</span>
                      {tab === 'custom_orders' && order.admin_response && (
                        <div className="admin-reply"><b>رد الإدارة:</b> {order.admin_response}</div>
                      )}
                    </div>
                    <Link className="btn-outline" href={`/track/${order.id}?type=${tab}`}>تتبع <ArrowLeft size={15}/></Link>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  </Layout>;
}
