import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import { supabase } from '../lib/supabase';
import { uploadImage } from '../lib/storage';
import { useAuth } from '../lib/useAuth';
import { safeError } from '../lib/format';
import { ImagePlus, X, ClipboardPaste, UserRound, Ruler, Palette, Hash, MapPin, Send, PackageOpen } from 'lucide-react';

export default function GlobalOrder() {
  const { user, profile, loading: authLoading } = useAuth();
  const [form, setForm] = useState({ name: '', phone: '', link: '', description: '', size: '', color: '', quantity: 1, address: '' });
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [createdId, setCreatedId] = useState('');
  const [prefilled, setPrefilled] = useState(false);

  useEffect(() => {
    if (!profile || prefilled) return;
    setForm((s) => ({ ...s, name: s.name || profile.full_name || '', phone: s.phone || profile.phone || '' }));
    setPrefilled(true);
  }, [profile, prefilled]);

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const set = (key, value) => setForm((s) => ({ ...s, [key]: value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setDone('');
    if (!supabase) return setError('إعدادات Supabase غير مكتملة.');
    if (!user) return setError('سجّل الدخول أولًا لإرسال الطلب.');
    if (!form.link.trim() && !file) return setError('أضف رابط المنتج أو صورة له على الأقل.');
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) return setError('أكمل بيانات الاسم والجوال وعنوان التوصيل.');
    setBusy(true);
    try {
      let imageUrl = null;
      if (file) imageUrl = await uploadImage('request-images', 'shein-requests', file);
      const { data, error: submitError } = await supabase.rpc('submit_global_request', {
        p_customer_name: form.name.trim(),
        p_customer_phone: form.phone.trim(),
        p_product_link: form.link.trim() || null,
        p_product_image: imageUrl,
        p_description: form.description.trim(),
        p_size: form.size.trim(),
        p_color: form.color.trim(),
        p_quantity: Math.max(1, Math.min(30, Number(form.quantity) || 1)),
        p_delivery_address: form.address.trim()
      });
      if (submitError) throw submitError;
      setCreatedId(data);
      setDone(`وصل طلبك للمراجعة. رقم الطلب: ${data}`);
      setForm((s) => ({ ...s, link: '', description: '', size: '', color: '', quantity: 1, address: '' }));
      setFile(null);
    } catch (err) {
      setError(safeError(err));
    } finally {
      setBusy(false);
    }
  };

  return <Layout title="اطلب من شي إن">
    <div className="page-wrap">
      <div className="container">
        <form className="form-card" onSubmit={submit}>
          <span className="eyebrow"><PackageOpen size={13}/> طلب من خارج المتاجر المحلية</span>
          <h1 className="page-title mt-3">اطلب من شي إن</h1>
          <p className="page-lead">
            الصق رابط المنتج أو أرسل صورته، وأضف المقاس واللون والكمية وأي تفاصيل مهمة. تراجع الإدارة الطلب وتحدد السعر قبل التنفيذ.
          </p>

          {error && <Notice type="error">{error}</Notice>}
          {done && <Notice type="success">{done} {createdId && <Link className="underline font-bold" href={`/track/${createdId}?type=global_orders`}>تتبع الطلب</Link>}</Notice>}
          {!authLoading && !user && (
            <Notice type="info">يلزم تسجيل الدخول لإرسال الطلب. <Link className="underline font-bold" href="/login?next=%2Fglobal">تسجيل الدخول</Link></Notice>
          )}

          <div className="field">
            <label><ClipboardPaste size={14}/> رابط المنتج</label>
            <input type="url" dir="ltr" value={form.link} onChange={(e) => set('link', e.target.value)} placeholder="https://..." />
          </div>

          <div className="field">
            <label><ImagePlus size={14}/> صورة المنتج (اختياري)</label>
            {preview ? (
              <div className="request-image-preview global-preview">
                <img src={preview} alt="صورة المنتج"/>
                <button type="button" onClick={() => setFile(null)} aria-label="إزالة الصورة"><X size={16}/></button>
              </div>
            ) : (
              <label className="file-drop">
                <ImagePlus size={22}/>
                <span>اختر صورة للمنتج</span>
                <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
            )}
          </div>

          <div className="field">
            <label>تفاصيل إضافية</label>
            <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="اسم المنتج أو وصفه وأي ملاحظات" maxLength={500}/>
          </div>

          <div className="split">
            <div className="field">
              <label><Ruler size={14}/> المقاس</label>
              <input value={form.size} onChange={(e) => set('size', e.target.value)} placeholder="مثال: M / 42" maxLength={30}/>
            </div>
            <div className="field">
              <label><Palette size={14}/> اللون</label>
              <input value={form.color} onChange={(e) => set('color', e.target.value)} placeholder="مثال: أسود" maxLength={30}/>
            </div>
          </div>

          <div className="field">
            <label><Hash size={14}/> الكمية</label>
            <input type="number" min="1" max="30" value={form.quantity} onChange={(e) => set('quantity', e.target.value)}/>
          </div>

          <div className="field">
            <label><UserRound size={14}/> الاسم</label>
            <input required value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80}/>
          </div>
          <div className="field">
            <label>رقم الجوال</label>
            <input required dir="ltr" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} maxLength={20}/>
          </div>
          <div className="field">
            <label><MapPin size={14}/> عنوان التوصيل</label>
            <textarea required value={form.address} onChange={(e) => set('address', e.target.value)}/>
          </div>

          <button className="btn-gold w-full" disabled={busy || !user}><Send size={16}/> {busy ? 'جارٍ إرسال الطلب...' : 'إرسال الطلب للمراجعة'}</button>
        </form>
      </div>
    </div>
  </Layout>;
}
