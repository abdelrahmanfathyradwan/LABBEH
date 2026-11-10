import Link from 'next/link';
import { Search } from 'lucide-react';
import Layout from '../components/Layout';

export default function NotFound() {
  return <Layout title="الصفحة غير موجودة">
    <div className="page-wrap">
      <div className="form-card text-center">
        <div className="empty-icon"><Search size={25}/></div>
        <h1 className="page-title">الصفحة غير موجودة</h1>
        <p className="page-lead">قد يكون الرابط قديمًا أو أن الصفحة نُقلت. يمكنك العودة للرئيسية أو تصفح طلباتك.</p>
        <div className="form-actions justify-center">
          <Link href="/" className="btn-primary">العودة للرئيسية</Link>
          <Link href="/account" className="btn-outline">حسابي وطلباتي</Link>
        </div>
      </div>
    </div>
  </Layout>;
}
