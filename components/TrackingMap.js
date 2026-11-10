import { MapPin } from 'lucide-react';

export default function TrackingMap({ src, title = 'موقع التوصيل', label = 'موقع التوصيل', emptyTitle = 'الخريطة غير متاحة بعد', emptyText = 'ستظهر الخريطة هنا بعد توفر إحداثيات الموقع.' }) {
  if (!src) {
    return (
      <div className="map-card">
        <div className="map-empty">
          <MapPin size={26}/>
          <b>{emptyTitle}</b>
          <span>{emptyText}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="map-card">
      <iframe title={title} src={src} loading="lazy"/>
      {label && <span className="map-label"><MapPin size={11}/> {label}</span>}
    </div>
  );
}
