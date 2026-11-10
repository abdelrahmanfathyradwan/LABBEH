export const currency = (value) => `${new Intl.NumberFormat('ar-YE', { maximumFractionDigits: 0 }).format(Number(value || 0))} ر.ي`;
export const moneyNumber = (value) => Math.max(0, Math.round(Number(value) || 0));
export const safeError = (error) => {
  const message = String(error?.message || '');
  if (/failed to fetch|networkerror|load failed|err_name_not_resolved|network request failed/i.test(message)) {
    return 'تعذر الاتصال بالخادم. تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.';
  }
  return message || 'حدث خطأ غير متوقع. حاول مرة أخرى.';
};
export const haversineKm = (aLat, aLng, bLat, bLng) => {
  if ([aLat, aLng, bLat, bLng].some(v => v === null || v === undefined || Number.isNaN(Number(v)))) return null;
  const rad = v => Number(v) * Math.PI / 180;
  const dLat = rad(bLat - aLat), dLng = rad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};
// Distance is rounded UP to the next whole kilometre beyond the first 2 km:
// 2.1 km -> 1 extra km, 3.0 km -> 1 extra km, 3.1 km -> 2 extra km.
export const deliveryFee = (km, base = 1000, perKm = 300) => km === null ? null : Math.round(Number(base) + Math.ceil(Math.max(0, km - 2)) * Number(perKm));

export const statusLabels = {
  pending: 'بانتظار المراجعة',
  pending_review: 'بانتظار المراجعة',
  quoted: 'تم التسعير',
  approved: 'معتمد',
  assigned: 'تم إسناد السائق',
  processing: 'قيد التجهيز',
  on_delivery: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغي'
};

export const statusLabel = (status) => statusLabels[status] || status || 'غير معروف';

export const statusTone = (status) => {
  if (status === 'delivered') return 'status status-success';
  if (status === 'cancelled') return 'status status-danger';
  if (status === 'on_delivery') return 'status status-info';
  if (status === 'processing' || status === 'assigned') return 'status status-warn';
  return 'status';
};

const orderFlows = {
  global_orders: [
    ['pending_review', 'مراجعة الطلب'],
    ['quoted', 'تحديد السعر'],
    ['approved', 'اعتماد السعر'],
    ['assigned', 'إسناد السائق'],
    ['processing', 'قيد التجهيز'],
    ['on_delivery', 'في الطريق'],
    ['delivered', 'تم التسليم']
  ],
  orders: [
    ['pending', 'استلام الطلب'],
    ['processing', 'قيد التجهيز'],
    ['assigned', 'إسناد السائق'],
    ['on_delivery', 'في الطريق'],
    ['delivered', 'تم التسليم']
  ],
  custom_orders: [
    ['pending', 'استلام الطلب'],
    ['processing', 'قيد التجهيز'],
    ['assigned', 'إسناد السائق'],
    ['on_delivery', 'في الطريق'],
    ['delivered', 'تم التسليم']
  ]
};

export const orderSteps = (type) => orderFlows[type] || orderFlows.orders;

export const stepIndex = (type, status) => {
  if (!status || status === 'cancelled') return -1;
  return orderSteps(type).findIndex(([value]) => value === status);
};

const statusTransitions = {
  orders: {
    pending: ['processing', 'assigned', 'cancelled'],
    processing: ['assigned', 'cancelled'],
    assigned: ['on_delivery', 'assigned', 'cancelled'],
    on_delivery: ['delivered', 'assigned', 'cancelled'],
    delivered: [],
    cancelled: []
  },
  custom_orders: {
    pending: ['processing', 'assigned', 'cancelled'],
    processing: ['assigned', 'on_delivery', 'cancelled'],
    assigned: ['on_delivery', 'assigned', 'cancelled'],
    on_delivery: ['delivered', 'assigned', 'cancelled'],
    delivered: [],
    cancelled: []
  },
  global_orders: {
    pending_review: ['quoted', 'assigned', 'cancelled'],
    quoted: ['approved', 'assigned', 'cancelled'],
    approved: ['assigned', 'cancelled'],
    assigned: ['processing', 'on_delivery', 'assigned', 'cancelled'],
    processing: ['on_delivery', 'assigned', 'cancelled'],
    on_delivery: ['delivered', 'assigned', 'cancelled'],
    delivered: [],
    cancelled: []
  }
};

// Mirrors the database transition and driver triggers: finalized orders are
// locked, delivery follows on_delivery, states that imply delivery require a
// driver, and no transition may skip a required stage.
export const adminStatusOptions = (type, order) => {
  const status = order?.status;
  const transitions = statusTransitions[type] || statusTransitions.orders;
  if (!status) return Object.keys(transitions);
  if (status === 'delivered' || status === 'cancelled') return [status];

  const driverRequired = ['assigned', 'on_delivery', 'delivered'];
  const next = (transitions[status] || []).filter((candidate) => {
    if (driverRequired.includes(candidate) && !order?.driver_id) return false;
    return true;
  });

  return Array.from(new Set([status, ...next]));
};

export const dateTime = (value) => {
  if (!value) return '';
  try {
    return new Date(value).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
};

export const shortId = (id) => (id ? String(id).slice(0, 8) : '');
