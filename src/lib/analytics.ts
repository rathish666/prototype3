import type { Order } from '@/types';

export function isCountedRevenueOrder(order: Pick<Order, 'payment_status' | 'status'>) {
  return order.payment_status === 'paid' && !['Cancelled', 'Returned'].includes(order.status);
}

export function estimatedProfitFromRevenue(revenue: number) {
  return revenue * 0.35;
}
