import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import { supabase } from '../lib/supabase';
import { uploadImage } from '../lib/storage';
import { useAuth } from '../lib/useAuth';
import { safeError } from '../lib/format';
import { ArrowRight, MapPin, MapPinned, Navigation, Send, NotebookPen, FileText, UserRound, ImagePlus, X } from 'lucide-react';

export default function RequestPage() {
  const { user, profile, loading: authLoading } = useAuth();
  const [form, setForm] = useState({ title: '', name: '', phone: '', text: '', address: '' });
  const [coords, setCoords] = useState(null);
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

  const locate = () => {
    setError('');
    if (!navigator.geolocation) return setError('المتصفح لا يدعم تحديد الموقع. اكتب عنوانك يدويًا.');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setForm((s) => ({ ...s, address: s.address || 'تم تحديد موقعي الحالي' }));
      },
      () => setError('تعذر تحديد الموقع. تحقق من إذن الموقع أو اكتب عنوانك يدويًا.'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setDone('');
    if (!supabase) return setError('إعدادات قاعدة البيانات غير مكتملة.');
    if (!user) return setError('سجّل الدخول أولًا لإرسال الطلب.');
    if (!form.title.trim() || !form.text.trim() || !form.address.trim() || !form.name.trim() || !form.phone.trim()) {
      return setError('أكمل عنوان الطلب وتفاصيله وبيانات التواصل والعنوان.');
    }
    setBusy(true);
    try {
      let imageUrl = null;
      if (file) imageUrl = await uploadImage('request-images', 'custom-requests', file);
      const { data, error: submitError } = await supabase.rpc('submit_custom_request', {
        p_customer_name: form.name.trim(),
        p_customer_phone: form.phone.trim(),
        p_order_text: form.text.trim(),
        p_delivery_address: form.address.trim(),
        p_customer_lat: coords?.lat ?? null,
        p_customer_lng: coords?.lng ?? null,
        p_title: form.title.trim(),
        p_image_url: imageUrl
      });
      if (submitError) throw submitError;
      setCreatedId(data);
      setDone(`تم إرسال طلبك بنجاح. رقم الطلب: ${data}`);
      setForm({ title: '', name: form.name, phone: form.phone, text: '', address: '' });
      setCoords(null);
      setFile(null);
    } catch (err) {
      setError(safeError(err));
    } finally {
      setBusy(false);
    }
  };

  return <Layout title="اكتب طلبك">
    <div className="page-wrap request-page">
      <div className="container">
        <div className="request-main">
          <section className="request-hero">
            <Link href="/" className="back-link"><ArrowRight size={15}/> الرئيسية</Link>
            <span className="request-hero-icon" aria-hidden="true"><NotebookPen size={23}/></span>
            <h1>سجل طلبك هنا</h1>
            <p>أدخل تفاصيل طلبك وسنقوم بتنفيذه في أقرب وقت. يمكنك إرفاق صورة وتحديد موقعك لتسهيل التوصيل.</p>
          </section>

          <form className="request-form" onSubmit={submit}>
            <section className="request-panel">
              {error && <Notice type="error">{error}</Notice>}
              {done && <Notice type="success">{done} {createdId && <Link className="underline font-bold" href={`/track/${createdId}?type=custom_orders`}>تتبع الطلب</Link>}</Notice>}
              {!authLoading && !user && (
                <Notice type="info">يلزم تسجيل الدخول لإرسال الطلب. <Link className="underline font-bold" href="/login?next=%2Frequest">تسجيل الدخول</Link></Notice>
              )}
              <h2 className="request-section-title"><NotebookPen size={18}/> عنوان الطلب</h2>
              <input
                className="request-title-input"
                required
                value={form.title}
                onChange={(e) => set('title', e.target.value)}
                placeholder="مثال: طلب أدوية من صيدلية"
                aria-label="عنوان الطلب"
                maxLength={120}
              />
              <h2 className="request-section-title mt-4"><FileText size={18}/> تفاصيل الطلب</h2>
              <textarea required value={form.text} onChange={(e) => set('text', e.target.value)} placeholder="اكتب تفاصيل طلبك هنا..." aria-label="تفاصيل الطلب"/>
              <div className="request-image-upload">
                {preview ? (
                  <div className="request-image-preview">
                    <img src={preview} alt="صورة مرفقة للطلب"/>
                    <button type="button" onClick={() => setFile(null)} aria-label="إزالة الصورة"><X size={16}/></button>
                  </div>
                ) : (
                  <label className="file-drop">
                    <ImagePlus size={22}/>
                    <span>إرفاق صورة (اختياري)</span>
                    <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                  </label>
                )}
              </div>
            </section>

            <section className="request-panel">
              <h2 className="request-section-title"><MapPin size={18}/> الموقع</h2>
              <div className="location-input">
                <MapPinned size={20}/>
                <input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="أدخل موقعك أو وصف العنوان" aria-label="العنوان"/>
              </div>
              <button type="button" className="use-location" onClick={locate}><Navigation size={16}/> استخدم موقعي الحالي</button>
              {coords && <div className="location-confirm">تم تحديد موقعك الحالي بنجاح</div>}
            </section>

            <section className="request-panel request-contact-panel">
              <h2 className="request-section-title"><UserRound size={18}/> بيانات التواصل</h2>
              <input required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="الاسم" aria-label="الاسم" maxLength={80}/>
              <input required dir="ltr" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="رقم الجوال" aria-label="رقم الجوال" maxLength={20}/>
            </section>

            <button className="request-submit" disabled={busy || !user}><Send size={19}/>{busy ? 'جارٍ إرسال الطلب...' : 'إرسال الطلب'}</button>
          </form>
        </div>
      </div>
    </div>
  </Layout>;
}
