export type ViewMode = 'home' | 'buy' | 'sell'

export type RequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Paused' | 'SoldOut'

export type OrderStatus =
  | 'Paid'
  | 'Preparing'
  | 'Shipped'
  | 'Completed'
  | 'CancelRequested'
  | 'Cancelled'

export type OrderStatusFilter = 'All' | OrderStatus
export type RequestStatusFilter = 'All' | RequestStatus

export type SellerRequest = {
  id: number
  dbProductId?: string
  seller: string
  title: string
  description: string
  metadataUri: string
  category: string
  priceUsdt: string
  stock: string
  imageUrl: string
  productType: string
  productOptions: string
  shippingFeeUsdt: string
  status: RequestStatus
  soldCount: number
  revenueDao2: string
  createdAt: string
  source: 'local' | 'onchain'
  onchainListingId?: string
}

export type PurchaseOrder = {
  id: number
  dbOrderId?: string
  listingId: number
  productTitle: string
  buyer: string
  seller: string
  quantity: number
  selectedOption: string
  shippingFeeUsdt: string
  totalUsdt: string
  totalDao2: string
  sellerRevenueDao2: string
  platformFeeDao2: string
  recipientName: string
  recipientContact: string
  deliveryAddress: string
  deliveryMemo: string
  trackingNumber: string
  cancelReason: string
  cancelRequestedAt: string
  sellerCancelResponse: string
  status: OrderStatus
  updatedAt: string
  createdAt: string
  source: 'local' | 'onchain'
  onchainListingId?: string
}

export type DexPair = {
  chainId?: string
  dexId?: string
  pairAddress?: string
  priceUsd?: string
  liquidity?: {
    usd?: number
  }
  baseToken?: {
    address?: string
    symbol?: string
  }
  quoteToken?: {
    address?: string
    symbol?: string
  }
}
