import { Minus, Plus } from 'lucide-react';

export default function QuantitySelector({ value, onChange, min = 1, max = 99, label = 'الكمية' }) {
  const clamp = (next) => Math.max(min, Math.min(max, next));
  const current = Number(value) || min;

  return (
    <div className="qty-stepper">
      <button type="button" onClick={() => onChange(clamp(current - 1))} disabled={current <= min} aria-label="تقليل الكمية">
        <Minus size={14}/>
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(clamp(Number(e.target.value) || min))}
      />
      <button type="button" onClick={() => onChange(clamp(current + 1))} disabled={current >= max} aria-label="زيادة الكمية">
        <Plus size={14}/>
      </button>
    </div>
  );
}
