import { X } from 'lucide-react';

export default function Notice({ type = 'info', children, onClose }) {
  return (
    <div role="status" className={`notice notice-${type}`}>
      <span className="notice-text">{children}</span>
      {onClose && (
        <button type="button" className="notice-close" onClick={onClose} aria-label="إغلاق"><X size={15}/></button>
      )}
    </div>
  );
}
