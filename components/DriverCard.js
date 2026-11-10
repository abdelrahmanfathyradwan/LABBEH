import { Phone, Clock } from 'lucide-react';
import { dateTime } from '../lib/format';

export default function DriverCard({ driver, lastUpdate }) {
  const name = driver.full_name || 'مندوب لبيه';
  const initial = name.trim().charAt(0) || 'ل';

  return (
    <div className="driver-card">
      <div className="driver-profile">
        <span className="driver-avatar" aria-hidden="true">{initial}</span>
        <div>
          <p className="driver-name">{name}</p>
          <span className="driver-role">سائق توصيل · لبيه عزّان</span>
        </div>
      </div>
      {driver.phone && (
        <a className="btn-gold w-full" href={`tel:${driver.phone}`}>
          <Phone size={15}/> <span dir="ltr">{driver.phone}</span>
        </a>
      )}
      <p className="small" style={{ display: 'flex', alignItems: 'center', gap: 4, margin: 0 }}>
        <Clock size={12}/>
        {lastUpdate ? `آخر تحديث للموقع: ${dateTime(lastUpdate)}` : 'بانتظار مشاركة موقع السائق.'}
      </p>
    </div>
  );
}
