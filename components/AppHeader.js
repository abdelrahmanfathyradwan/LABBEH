import Link from 'next/link';
import { useRouter } from 'next/router';
import { ShoppingBag, LayoutDashboard, LogOut, UserRound } from 'lucide-react';
import { roleHome, roleLabel } from '../lib/auth';
import { useCartCount } from '../lib/useCartCount';

const links = [
  ['/', 'الرئيسية'],
  ['/request', 'اكتب طلبك'],
  ['/global', 'اطلب من شي إن'],
  ['/cart', 'السلة']
];

export default function AppHeader({ user, profile, onLogout }) {
  const router = useRouter();
  const cartCount = useCartCount();

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand" aria-label="لبيه — الرئيسية">
          <img src="/logo-mark.png" alt="" className="brand-logo" width="42" height="43"/>
          <span className="brand-text"><b>لبيه</b></span>
        </Link>

        <nav className="desktop-nav" aria-label="التنقل الرئيسي">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className={router.pathname === href ? 'active' : undefined}>{label}</Link>
          ))}
          {user && <Link href="/account" className={router.pathname === '/account' ? 'active' : undefined}>طلباتي</Link>}
        </nav>

        <div className="header-actions">
          <Link className="icon-link" href="/cart" aria-label={`السلة${cartCount ? ` — ${cartCount} قطعة` : ''}`}>
            <ShoppingBag size={18}/>
            {cartCount > 0 && <span className="cart-count">{cartCount > 99 ? '99+' : cartCount}</span>}
          </Link>
          {user ? (
            <>
              {profile?.role && profile.role !== 'customer' && (
                <Link className="login-link dashboard-link" href={roleHome(profile.role)}>
                  <LayoutDashboard size={15}/> {roleLabel(profile.role)}
                </Link>
              )}
              <Link className="icon-link account-link" href="/account" aria-label="حسابي" title={profile?.full_name || 'حسابي'}>
                <UserRound size={18}/>
              </Link>
              <button type="button" className="icon-link logout-link rotate-180 hover:bg-red-950 hover:text-red-500 hover:border-red-500" onClick={onLogout} aria-label="تسجيل الخروج" title="تسجيل الخروج">
                <LogOut size={17}/>
              </button>
            </>
          ) : (
            <Link className="login-link" href="/login">دخول / حساب جديد</Link>
          )}
        </div>
      </div>
    </header>
  );
}
