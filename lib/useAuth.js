import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from './supabase';
import { roleHome } from './auth';

async function loadProfile(userId) {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: ensured, error: ensureError } = await supabase.rpc('ensure_profile');
  if (ensureError) throw ensureError;
  return ensured || null;
}

export function useAuth() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setError('إعدادات Supabase غير مكتملة.');
      return undefined;
    }
    let alive = true;

    const load = async () => {
      try {
        setError('');
        const { data: { session } } = await supabase.auth.getSession();
        if (!alive) return;
        if (!session?.user) {
          setUser(null);
          setProfile(null);
          setLoading(false);
          return;
        }
        setUser(session.user);
        const data = await loadProfile(session.user.id);
        if (!alive) return;
        setProfile(data);
      } catch (e) {
        if (alive) setError(e?.message || 'تعذر تحميل بيانات الحساب.');
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setProfile(null);
        setLoading(false);
        return;
      }
      load();
    });

    return () => {
      alive = false;
      subscription?.unsubscribe();
    };
  }, []);

  return { user, profile, loading, error };
}

export function useAuthGuard(roles) {
  const router = useRouter();
  const auth = useAuth();
  const [allowed, setAllowed] = useState(false);
  const rolesKey = Array.isArray(roles) ? roles.join(',') : '';

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.user) {
      setAllowed(false);
      router.replace(`/login?next=${encodeURIComponent(router.asPath)}`);
      return;
    }
    // Without a verified profile the role cannot be established, so deny access
    // instead of rendering a protected dashboard.
    if (!auth.profile) {
      setAllowed(false);
      router.replace(`/login?next=${encodeURIComponent(router.asPath)}`);
      return;
    }
    const allowedRoles = rolesKey ? rolesKey.split(',') : null;
    if (allowedRoles && !allowedRoles.includes(auth.profile.role)) {
      setAllowed(false);
      router.replace(roleHome(auth.profile.role));
      return;
    }
    setAllowed(true);
  }, [auth.loading, auth.user, auth.profile, rolesKey, router]);

  return { ...auth, allowed };
}
