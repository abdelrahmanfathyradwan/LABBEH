import Link from 'next/link';
import { MapPin, Store as StoreIcon } from 'lucide-react';

export default function StoreCard({ store, index = 0, distance = null }) {
  const closed = store.is_open === false;
  return (
    <Link href={`/store/${store.id}`} className="store-tile">
      <div className={`store-tile-media tone-${index % 3}`}>
        {store.logo_url
          ? <img src={store.logo_url} alt={store.name} loading="lazy"/>
          : <StoreIcon size={36} className="store-tile-fallback" aria-hidden="true"/>}
        <span className={closed ? 'store-tile-open closed' : 'store-tile-open'}>{closed ? 'مغلق' : 'مفتوح'}</span>
        <span className="store-tile-distance">
          {distance !== null && distance !== undefined
            ? `${Number(distance).toFixed(1)} كم`
            : <><MapPin size={10}/> عزان</>}
        </span>
      </div>
      <div className="store-tile-body">
        <h3>{store.name}</h3>
        <span className="store-tile-cat">{store.category || 'متجر محلي'}</span>
        <div className="store-tile-meta">
          <MapPin size={11}/>
          <span>{store.area || 'عزان، شبوة'}</span>
        </div>
      </div>
    </Link>
  );
}
