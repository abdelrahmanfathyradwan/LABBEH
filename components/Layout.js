import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { supabase } from '../lib/supabase';
import { signOut } from '../lib/auth';
import AppHeader from './AppHeader';
import BottomNav from './BottomNav';
import { MapPin, Instagram, Facebook, Phone, MessageCircle } from 'lucide-react';

export default function Layout({ children, compact = false, hideHeader = false, title }) {
  const router = useRouter();
  const [settings, setSettings] = useState({});
  const [authUser, setAuthUser] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    if (!supabase) return undefined;
    let alive = true;

    const loadProfile = async (userId) => {
      const { data } = await supabase.from('profiles').select('id,full_name,role').eq('id', userId).maybeSingle();
      if (alive) setProfile(data);
    };

    supabase.from('settings').select('contact_phone,whatsapp_number,instagram_url,facebook_url').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (alive && data) setSettings(data); })
      .catch(() => {});

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!alive) return;
      if (session?.user) {
        setAuthUser(session.user);
        loadProfile(session.user.id);
      }
    }).catch(() => {});

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (session?.user) {
        setAuthUser(session.user);
        loadProfile(session.user.id);
      } else {
        setAuthUser(null);
        setProfile(null);
      }
    });

    return () => { alive = false; subscription?.unsubscribe(); };
  }, []);

  const logout = async () => {
    await signOut();
    setAuthUser(null);
    setProfile(null);
    router.push('/');
  };

  const phone = settings.contact_phone || process.env.NEXT_PUBLIC_CONTACT_PHONE;
  const whatsapp = settings.whatsapp_number || process.env.NEXT_PUBLIC_WHATSAPP_NUMBER;
  const socialUrl = (value) => (typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null);
  const instagram = socialUrl(settings.instagram_url) || socialUrl(process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM);
  const facebook = socialUrl(settings.facebook_url) || socialUrl(process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK);

  return <div dir="rtl" className="min-h-screen flex flex-col">
    <Head><title>{title ? `${title} · لبيه` : 'لبيه · التسوق والطلبات المحلية في عزان'}</title></Head>
    {!hideHeader && <AppHeader user={authUser} profile={profile} onLogout={logout}/>}
    <main className="app-main">{children}</main>
    {!compact && <footer className="footer">
      <div className="container footer-grid">
        <div>
          <Link href="/" className="brand footer-brand"><img src="/logo-mark.png" alt="" className="brand-logo" width="38" height="39"/><span className="brand-text"><b>لبيه</b></span></Link>
          <p>طلباتك اليومية من متاجر عزّان، أقرب وأسهل. توصيل موثوق وأسعار واضحة.</p>
        </div>
        <div>
          <h3>روابط سريعة</h3>
          <Link href="/request">اكتب طلبك الخاص</Link>
          <Link href="/global">اطلب من شي إن</Link>
          <Link href="/account">حسابي وطلباتي</Link>
        </div>
        <div>
          <h3>تواصل معنا</h3>
          {phone && <a href={`tel:${phone}`}><Phone size={14}/> {phone}</a>}
          {whatsapp && <a href={`https://wa.me/${whatsapp.replace(/[^0-9]/g, '')}`} target="_blank" rel="noreferrer"><MessageCircle size={14}/> واتساب</a>}
          {instagram && <a href={instagram} target="_blank" rel="noreferrer"><Instagram size={14}/> Instagram</a>}
          {facebook && <a href={facebook} target="_blank" rel="noreferrer"><Facebook size={14}/> Facebook</a>}
          <span><MapPin size={14}/> عزّان - شبوة</span>
        </div>
      </div>
      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} لبيه. جميع الحقوق محفوظة.</span>
        <span>صُنع بعناية لخدمة أهل عزّان</span>
      </div>
    </footer>}
    {!hideHeader && <BottomNav/>}
  </div>;
}
