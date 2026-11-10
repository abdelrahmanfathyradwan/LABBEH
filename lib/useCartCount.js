import { useEffect, useState } from 'react';

const CART_KEY = 'labbeh_cart';

export function readCartCount() {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    if (!Array.isArray(cart)) return 0;
    return cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  } catch {
    return 0;
  }
}

export function useCartCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const update = () => setCount(readCartCount());
    update();
    window.addEventListener('labbeh-cart-updated', update);
    window.addEventListener('storage', update);
    window.addEventListener('focus', update);
    return () => {
      window.removeEventListener('labbeh-cart-updated', update);
      window.removeEventListener('storage', update);
      window.removeEventListener('focus', update);
    };
  }, []);

  return count;
}
