import { supabase } from './supabase';

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export async function uploadImage(bucket, folder, file) {
  if (!supabase) throw new Error('إعدادات Supabase غير مكتملة.');
  if (!file) throw new Error('لم يتم اختيار صورة.');
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error('صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WEBP أو GIF.');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('حجم الصورة يجب أن يكون 5 ميجابايت أو أقل.');
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: false, cacheControl: '3600' });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
