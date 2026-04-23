export type SupabaseProductStatus = 'Pending' | 'Approved' | 'Rejected' | 'Paused' | 'SoldOut'
export type SupabaseOrderStatus = 'Paid' | 'Preparing' | 'Shipped' | 'Completed' | 'CancelRequested' | 'Cancelled'

export type SupabaseProductRow = {
  id: string
  seller_wallet: string
  title: string
  description: string | null
  category: string | null
  image_url: string | null
  metadata_uri: string | null
  price_usdt: string
  stock: number
  status: SupabaseProductStatus
  created_at: string
}

export type SupabaseOrderRow = {
  id: string
  product_id: string | null
  buyer_wallet: string
  seller_wallet: string
  quantity: number
  total_usdt: string
  total_dao2: string | null
  status: SupabaseOrderStatus
  recipient_name: string | null
  recipient_contact: string | null
  delivery_address: string | null
  created_at: string
}
