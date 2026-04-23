import type { OrderStatus, RequestStatus } from '../../types/marketplace'

export const getLaunchCheckClassName = (status: 'ready' | 'warning' | 'blocked') => {
  if (status === 'ready') {
    return 'rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs text-green-300'
  }
  if (status === 'warning') {
    return 'rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-300'
  }
  return 'rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs text-red-300'
}

export const getOrderStatusLabel = (status: OrderStatus) => {
  if (status === 'Paid') return '결제 완료'
  if (status === 'Preparing') return '상품 준비 중'
  if (status === 'Shipped') return '배송/전달 중'
  if (status === 'Completed') return '거래 완료'
  if (status === 'CancelRequested') return '취소 요청'
  return '취소됨'
}

export const getOrderStatusClassName = (status: OrderStatus) => {
  if (status === 'Paid') {
    return 'rounded-full border border-blue-500/20 bg-blue-500/10 px-3 py-1 text-xs text-blue-300'
  }
  if (status === 'Preparing') {
    return 'rounded-full border border-yellow-500/20 bg-yellow-500/10 px-3 py-1 text-xs text-yellow-300'
  }
  if (status === 'Shipped') {
    return 'rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-xs text-purple-300'
  }
  if (status === 'Completed') {
    return 'rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1 text-xs text-green-300'
  }
  if (status === 'CancelRequested') {
    return 'rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-xs text-orange-300'
  }
  return 'rounded-full border border-red-500/20 bg-red-500/10 px-3 py-1 text-xs text-red-300'
}

export const mapOnchainListingStatus = (value: unknown): RequestStatus => {
  const statusNumber = Number(value)

  if (statusNumber === 1) return 'Approved'
  if (statusNumber === 2) return 'Rejected'
  if (statusNumber === 3) return 'Paused'
  if (statusNumber === 4) return 'SoldOut'
  return 'Pending'
}
