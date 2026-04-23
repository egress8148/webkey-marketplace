import type { OrderStatusFilter, RequestStatusFilter } from '../../types/marketplace'

export const DAO2_TOKEN_ADDRESS = '0xe0A281deFf5c9d8d67aF09D39340E134Ac81b82E' as const

export const DAO2_ERC20_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

export const ORDER_STATUS_FILTER_OPTIONS: Array<{ value: OrderStatusFilter; label: string }> = [
  { value: 'All', label: '전체 주문' },
  { value: 'Paid', label: '결제 완료' },
  { value: 'Preparing', label: '상품 준비 중' },
  { value: 'Shipped', label: '배송/전달 중' },
  { value: 'Completed', label: '거래 완료' },
  { value: 'CancelRequested', label: '취소 요청' },
  { value: 'Cancelled', label: '취소됨' },
]

export const REQUEST_STATUS_FILTER_OPTIONS: Array<{ value: RequestStatusFilter; label: string }> = [
  { value: 'All', label: '전체 요청' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Approved', label: 'Approved' },
  { value: 'Rejected', label: 'Rejected' },
  { value: 'Paused', label: 'Paused' },
  { value: 'SoldOut', label: 'SoldOut' },
]
