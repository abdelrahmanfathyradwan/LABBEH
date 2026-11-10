import { statusLabel, statusTone } from '../lib/format';

export default function StatusBadge({ status }) {
  return <span className={statusTone(status)}>{statusLabel(status)}</span>;
}
