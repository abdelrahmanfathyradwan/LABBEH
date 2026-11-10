import Link from 'next/link';
import { useRouter } from 'next/router';
import { Home, ClipboardList, ShoppingBag, UserRound, PenLine } from 'lucide-react';
import { useCartCount } from '../lib/useCartCount';

const items = [
  { href: '/', label: 'الرئيسية', icon: Home, match: (path) => path === '/' || path.startsWith('/store/') },
  { href: '/account', label: 'طلباتي', icon: ClipboardList, match: (path) => path === '/account' },
  { href: '/cart', label: 'السلة', icon: ShoppingBag, badge: true, match: (path) => path === '/cart' },
  { href: '/request', label: 'اطلب', icon: PenLine, match: (path) => path === '/request' }
];

const hiddenRoutes = ['/admin', '/store-admin', '/driver', '/login', '/verify'];

export default function BottomNav() {
  const router = useRouter();
  const cartCount = useCartCount();

  if (hiddenRoutes.includes(router.pathname)) return null;

  return (
    <nav className="bottom-nav" aria-label="التنقل السريع">
      {items.map(({ href, label, icon: Icon, badge, match }) => {
        const active = match(router.pathname);
        return (
          <Link key={href} href={href} className={active ? 'bottom-nav-item active' : 'bottom-nav-item'} aria-current={active ? 'page' : undefined}>
            <span className="bottom-nav-icon">
              <Icon size={19} strokeWidth={active ? 2.2 : 1.9}/>
              {badge && cartCount > 0 && <span className="bottom-nav-badge">{cartCount > 99 ? '99+' : cartCount}</span>}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
