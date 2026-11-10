import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import { supabase } from '../lib/supabase';
import { roleHome } from '../lib/auth';
import { safeError } from '../lib/format';
import { ShieldCheck, MailCheck, Store, Truck } from 'lucide-react';

export default function Verify() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (router.query.email) setEmail(String(router.query.email));
  }, [router.query.email]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    timerRef.current = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timerRef.current);
  }, [cooldown]);

  const verify = async (e) => {
    e.preventDefault();
    if (!supabase) return setError('إعدادات Supabase غير مكتملة.');
    if (!email.trim()) return setError('اكتب بريدك الإلكتروني.');
    if (!token.trim()) return setError('أدخل رمز التحقق الذي وصلك عبر البريد.');
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: token.trim(),
        type: 'email'
      });
      if (verifyError) {
        setError(/expired|invalid|token/i.test(verifyError.message)
          ? 'رمز التحقق غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا وحاول مرة أخرى.'
          : safeError(verifyError));
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('تم التحقق، لكن تعذر قراءة الحساب. حاول تسجيل الدخول مرة أخرى.');
        return;
      }

      let { data: profile, error: profileError } = await supabase
        .from('profiles').select('*').eq('id', user.id).maybeSingle();

      if (!profile) {
        const { data: ensured, error: ensureError } = await supabase.rpc('ensure_profile');
        if (!ensureError && ensured) profile = ensured;
        else profileError = ensureError || profileError;
      }

      if (profileError && !profile) {
        setError('تم تسجيل الدخول، لكن تعذر تجهيز ملفك الشخصي. تواصل مع إدارة لبيه.');
        return;
      }

      const next = typeof router.query.next === 'string' ? router.query.next : '';
      const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '';
      if (profile?.role === 'customer' && safeNext) router.replace(safeNext);
      else router.replace(roleHome(profile?.role));
    } catch (e) {
      setError(safeError(e));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!supabase || cooldown > 0) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) return setError('اكتب بريدك الإلكتروني أولًا.');
    setResending(true);
    setError('');
    setInfo('');
    try {
      const { error: resendError } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: true }
      });
      if (resendError) {
        setError(/rate limit|too many|security purposes/i.test(resendError.message)
          ? 'انتظر دقيقة قبل طلب رمز جديد.'
          : safeError(resendError));
        return;
      }
      setCooldown(60);
      setInfo('تم إرسال رمز تحقق جديد إلى بريدك الإلكتروني.');
    } catch (e) {
      setError(safeError(e));
    } finally {
      setResending(false);
    }
  };

  return (
    <Layout title="تأكيد البريد الإلكتروني">
      <div className="page-wrap">
        <div className="container">
          <div className="auth-shell">
            <aside className="auth-brand">
              <div>
                <Link href="/" className="brand">
                  <img src="/logo-mark.png" alt="" className="brand-logo" width="46" height="48"/>
                  <span className="brand-text"><b>لبيه</b></span>
                </Link>
                <h2>خطوة واحدة وتصلك طلباتك</h2>
                <p>تحقق من بريدك الإلكتروني لإكمال الدخول بأمان. الرمز قصير العمر ويُستخدم مرة واحدة.</p>
              </div>
              <ul className="auth-benefits">
                <li><MailCheck size={16}/> رمز تحقق يُرسل إلى بريدك</li>
                <li><ShieldCheck size={16}/> حماية لحسابك وطلباتك</li>
                <li><Store size={16}/> متاجر عزّان بانتظارك</li>
                <li><Truck size={16}/> تابع طلبك حتى باب منزلك</li>
              </ul>
            </aside>

            <div className="auth-form">
              <span className="eyebrow">تأكيد الحساب</span>
              <h1 className="mt-3">تأكيد البريد الإلكتروني</h1>
              <p className="page-lead">
                أدخل رمز التحقق الذي وصلك عبر البريد الإلكتروني{email ? <> إلى <b dir="ltr">{email}</b></> : null}.
              </p>
              {error && <Notice type="error">{error}</Notice>}
              {info && <Notice type="success">{info}</Notice>}
              <form onSubmit={verify}>
                <div className="field">
                  <label>البريد الإلكتروني</label>
                  <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="field auth-code-input">
                  <label>رمز التحقق</label>
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    maxLength={10}
                    required
                  />
                </div>
                <button className="btn-gold w-full" disabled={busy}>{busy ? 'جارٍ التحقق...' : 'تأكيد وتسجيل الدخول'}</button>
                <button type="button" className="btn-outline w-full mt-3" disabled={resending || cooldown > 0} onClick={resend}>
                  {resending ? 'جارٍ إعادة الإرسال...' : cooldown > 0 ? `إعادة إرسال الرمز بعد ${cooldown} ثانية` : 'إعادة إرسال الرمز'}
                </button>
              </form>
              <p className="small auth-foot">الرموز تنتهي صلاحيتها سريعًا. إذا لم يصلك الرمز، راجع مجلد الرسائل غير المرغوب فيها.</p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
