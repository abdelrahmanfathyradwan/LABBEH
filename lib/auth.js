import { supabase } from './supabase';

export async function getProfile() {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: ensured } = await supabase.rpc('ensure_profile');
  return ensured || null;
}

export async function requireRole(roles) {
  const profile = await getProfile();
  if (!profile || !roles.includes(profile.role)) throw new Error('ليس لديك صلاحية للوصول إلى هذه الصفحة.');
  return profile;
}

export const roleHome = (role) => {
  if (role === 'admin') return '/admin';
  if (role === 'merchant') return '/store-admin';
  if (role === 'driver') return '/driver';
  return '/';
};

export const roleLabel = (role) => {
  if (role === 'admin') return 'مدير المنصة';
  if (role === 'merchant') return 'تاجر';
  if (role === 'driver') return 'سائق';
  return 'عميل';
};

export async function signOut() {
  if (supabase) await supabase.auth.signOut();
}
