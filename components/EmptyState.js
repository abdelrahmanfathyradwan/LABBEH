import { Inbox } from 'lucide-react';

export default function EmptyState({ title, children, icon: Icon = Inbox }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true"><Icon size={25}/></span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
