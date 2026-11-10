import { useEffect, useState } from 'react';
import Link from 'next/link';
import Layout from '../components/Layout';
import Notice from '../components/Notice';
import { supabase } from '../lib/supabase';
import { roleHome } from '../lib/auth';
import { useAuth } from '../lib/useAuth';
import { useRouter } from 'next/router';
import { Store, Truck, ShieldCheck } from 'lucide-react';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function loginErrorMessage(error) {
  const message = String(error?.message || '');
  if (/failed to fetch|networkerror|load failed|err_name_not_resolved|network request failed/i.test(message)) {
    return 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.';
  }
  if (/rate limit|too many|security purposes/i.test(message)) {
    return 'تم إرسال عدة محاولات خلال وقت قصير. انتظر دقيقة ثم حاول مرة أخرى.';
  }
  if (/invalid email|email address/i.test(message)) {
    return 'البريد الإلكتروني غير صالح. تحقق من الكتابة وحاول مرة أخرى.';
  }
  if (/smtp|send|mail/i.test(message)) {
    return 'تعذر إرسال رسالة التحقق حاليًا. حاول لاحقًا أو تواصل مع إدارة لبيه.';
  }
  return message || 'تعذر إرسال رمز الدخول. حاول مرة أخرى.';
}

export default function Login() {
  const router = useRouter();
  const { user, profile, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (loading || !user) return;
    if (profile) {
      router.replace(roleHome(profile.role));
    }
  }, [loading, user, profile, router]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (!supabase) return setErr('أضف إعدادات Supabase في ملف .env.local أولاً.');
    const cleanEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleanEmail)) return setErr('اكتب بريدًا إلكترونيًا صحيحًا.');
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          shouldCreateUser: true,
          data: { full_name: name.trim(), phone: phone.trim() || null }
        }
      });
      if (error) {
        setErr(loginErrorMessage(error));
        return;
      }
      const next = typeof router.query.next === 'string' ? router.query.next : '';
      router.push(`/verify?email=${encodeURIComponent(cleanEmail)}${next ? `&next=${encodeURIComponent(next)}` : ''}`);
    } catch (e) {
      setErr(loginErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout title="الدخول">
      <div className="page-wrap">
        <div className="container">
          <div className="auth-shell">
            <aside className="auth-brand">
              <div>
                <Link href="/" className="brand">
                  <img src="/logo-mark.png" alt="" className="brand-logo" width="46" height="48"/>
                  <span className="brand-text"><b>لبيه</b></span>
                </Link>
                <h2>أهلًا بك في لبيه</h2>
                <p>حساب واحد لمتابعة طلباتك، حفظ عنوانك، والوصول إلى كل متاجر عزّان بسهولة.</p>
              </div>
              <ul className="auth-benefits">
                <li><Store size={16}/> متاجر عزّان في مكان واحد</li>
                <li><Truck size={16}/> توصيل موثوق إلى بابك</li>
                <li><ShieldCheck size={16}/> دخول آمن عبر رمز البريد</li>
              </ul>
            </aside>

            <div className="auth-form">
              <span className="eyebrow">تسجيل الدخول</span>
              <h1 className="mt-3">الدخول إلى لبيه</h1>
              <p className="page-lead">سجّل الدخول أو أنشئ حسابك باستخدام بريدك الإلكتروني. سنرسل رمز تحقق مكوّنًا من أرقام.</p>
              {err && <Notice type="error">{err}</Notice>}
              <form onSubmit={submit}>
                <div className="field">
                  <label>الاسم الكامل <span className="small">(للحسابات الجديدة)</span></label>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسمك" autoComplete="name" maxLength={80} />
                </div>
                <div className="field">
                  <label>البريد الإلكتروني</label>
                  <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" required />
                </div>
                <div className="field">
                  <label>رقم الجوال للتواصل والتوصيل <span className="small">(اختياري الآن، ويمكن إضافته لاحقًا من حسابك)</span></label>
                  <input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+9677xxxxxxxx" autoComplete="tel" maxLength={20} />
                </div>
                <button className="btn-gold w-full" disabled={busy || loading}>
                  {busy ? 'جارٍ إرسال رمز الدخول...' : 'إرسال رمز الدخول إلى البريد'}
                </button>
              </form>
              <p className="small auth-foot">
                الحساب الجديد يُنشأ تلقائيًا كعميل. لا يمكن اختيار صلاحية مدير أو تاجر أو سائق من شاشة التسجيل.
                إذا لم يصل الرمز، تحقق من مجلد الرسائل غير المرغوب فيها.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
