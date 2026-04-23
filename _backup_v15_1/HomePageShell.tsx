'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useEffect, useMemo, useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { erc20Abi } from 'viem'
import { useToast } from '@/lib/toast'  // ✨ v15
import { MARKETPLACE_ADDRESS, ADMIN_WALLET } from '../../lib/contracts'
import { webkeyDao2MarketplaceAbi } from '../../lib/abi/temp_contract_abi'

type ViewMode = 'home' | 'buy' | 'sell'
type RequestStatus = 'Pending' | 'Approved' | 'Rejected' | 'Paused' | 'SoldOut'

type SellerRequest = {
  id: string
  seller: string
  title: string
  description: string
  metadataUri: string
  category: string
  priceUsdt: string
  stock: string
  status: RequestStatus
  soldCount: number
  revenueDao2: string
  createdAt: string
  imageUrl?: string
  rejectionReason?: string
  rejectedAt?: string
  // ✨ Patch v9.2: 유형/카테고리·메타
  productType?: 'physical' | 'service' | 'food' | 'digital'
  categoryCode?: string
  metadataExtra?: Record<string, unknown>
}

type RuntimeConfig = {
  marketplace?: {
    marketplace_address?: string | null
    fee_bps?: number | null
    promotion_open_sell?: boolean | null
    promotion_end_date?: string | null
  } | null
  prime?: {
    plan_name?: string | null
  } | null
  promotion?: {
    active?: boolean
    endDate?: string | null
    daysRemaining?: number | null
  } | null
}

const normalizeItem = (item: Record<string, unknown>): SellerRequest => ({
  id: String(item.id ?? ''),
  seller: String(item.seller_wallet ?? ''),
  title: String(item.title ?? ''),
  description: String(item.description ?? ''),
  metadataUri: String(item.metadata_uri ?? ''),
  category: String(item.category ?? ''),
  priceUsdt: String(item.price_usdt ?? ''),
  stock: String(item.stock ?? ''),
  status: String(item.status ?? 'Pending') as RequestStatus,
  soldCount: Number(item.sold_count ?? 0),
  revenueDao2: String(item.revenue_dao2 ?? '0'),
  createdAt: String(item.created_at ?? ''),
  imageUrl: String(item.image_url ?? ''),
  rejectionReason: item.rejection_reason ? String(item.rejection_reason) : undefined,
  rejectedAt: item.rejected_at ? String(item.rejected_at) : undefined,
  // ✨ Patch v9.2: 유형/카테고리 코드·메타
  productType:
    (item.product_type as 'physical' | 'service' | 'food' | 'digital' | undefined) ||
    undefined,
  categoryCode: item.category_code ? String(item.category_code) : undefined,
  metadataExtra:
    typeof item.metadata_extra === 'object' && item.metadata_extra !== null
      ? (item.metadata_extra as Record<string, unknown>)
      : undefined,
})

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { cache: 'no-store', ...init })
  const json = await response.json()

  if (!response.ok || json?.ok === false) {
    throw new Error(json?.message || json?.error || 'Request failed.')
  }

  return json as T
}

export default function HomePageShell() {
  const { address, isConnected } = useAccount()
  const [viewMode, setViewMode] = useState<ViewMode>('home')

  const [productTitle, setProductTitle] = useState('')
  const [productDescription, setProductDescription] = useState('')
  const [metadataUri, setMetadataUri] = useState('')
  const [category, setCategory] = useState('')
  const [priceUsdt, setPriceUsdt] = useState('')
  const [stock, setStock] = useState('')

  // ✨ Patch v11.0: 판매 등록 시 variant 조합 리스트
  type DraftVariant = {
    key: string                              // react key
    options: Record<string, string>          // { size: 'M', color: '검정' } 등
    stock: string                            // string 입력 (상태)
    price_delta: string
    sku: string
  }
  const [draftVariants, setDraftVariants] = useState<DraftVariant[]>([])

  // ✨ Patch v11.0: 구매 모달에 불러온 variant 목록
  type VariantRow = {
    id: string
    options: Record<string, unknown>
    stock: number
    reserved: number
    available: number
    price_usdt_delta: number
    sku: string | null
    is_active: boolean
  }
  const [buyingVariants, setBuyingVariants] = useState<VariantRow[]>([])
  const [buyingVariantsLoading, setBuyingVariantsLoading] = useState(false)
  const [selectedVariantId, setSelectedVariantId] = useState<string>('')

  // ✨ Patch v9.0: 상품 유형 + 동적 카테고리
  type ProductTypeKey = 'physical' | 'service' | 'food' | 'digital'
  type CategoryRow = {
    id: string
    code: string
    name_ko: string
    emoji: string | null
    product_type: ProductTypeKey
    sort_order: number
  }

  const [productType, setProductType] = useState<ProductTypeKey>('physical')
  const [categoriesAll, setCategoriesAll] = useState<CategoryRow[]>([])
  const [categoriesByType, setCategoriesByType] = useState<Record<ProductTypeKey, CategoryRow[]>>({
    physical: [],
    service: [],
    food: [],
    digital: [],
  })
  const [categoriesLoaded, setCategoriesLoaded] = useState(false)
  // ✨ Patch v11.1: 카테고리 로드 진단 메시지 (UI에 노출)
  const [categoriesDebug, setCategoriesDebug] = useState<string>('')

  // 유형별 추가 필드
  // physical
  const [extraSize, setExtraSize] = useState('')
  const [extraColor, setExtraColor] = useState('')
  // service
  const [extraDurationMinutes, setExtraDurationMinutes] = useState('')
  const [extraReservationRequired, setExtraReservationRequired] = useState(true)
  // food
  const [extraShopAddress, setExtraShopAddress] = useState('')
  const [extraOpenHours, setExtraOpenHours] = useState('')
  // digital
  const [extraDeliveryMethod, setExtraDeliveryMethod] = useState('email')

  // ✨ Patch v2.2: 이미지 업로드
  const [productImageUrl, setProductImageUrl] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)

  // ✨ Patch v2.2: 판매자 본인 상품 수정 모달
  const [editingSellerProductId, setEditingSellerProductId] = useState<string | null>(null)
  const [editingSellerTitle, setEditingSellerTitle] = useState('')
  const [editingSellerDescription, setEditingSellerDescription] = useState('')
  const [editingSellerCategory, setEditingSellerCategory] = useState('')
  const [editingSellerPriceUsdt, setEditingSellerPriceUsdt] = useState('')
  const [editingSellerStock, setEditingSellerStock] = useState('')
  const [editingSellerImageUrl, setEditingSellerImageUrl] = useState('')

  const [requests, setRequests] = useState<SellerRequest[]>([])
  const [approvedProducts, setApprovedProducts] = useState<SellerRequest[]>([])
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig | null>(null)
  const [loading, setLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')

  // ✨ Patch v1: 거절 사유 입력 모달 상태
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [rejectingPrevStatus, setRejectingPrevStatus] = useState<RequestStatus>('Pending')
  const [rejectionReasonInput, setRejectionReasonInput] = useState('')

  // ✨ Patch v1: 구매자 영역 카테고리 필터
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  // ✨ Patch v9.2: 구매 화면 상품 유형 필터 ('all' 또는 4종 유형)
  const [selectedProductType, setSelectedProductType] = useState<'all' | 'physical' | 'service' | 'food' | 'digital'>('all')

  // ✨ Patch v9.2: 판매자 게이트 탭 ('mine' 개인 | 'register' 등록 | 'admin' 관리자)
  const [sellTab, setSellTab] = useState<'mine' | 'register' | 'admin'>('register')

  // ✨ v15: 내 판매 관리 부탭 (등록 현황 | 들어온 주문)
  const [mineSubTab, setMineSubTab] = useState<'requests' | 'incoming_orders'>('requests')

  // ✨ v15: 관리자 부탭 (심사 | 카테고리 | 설정 | 매일큐)
  const [adminSubTab, setAdminSubTab] = useState<'review' | 'categories' | 'settings' | 'mail'>('review')

  // ✨ v15: 구매자 내 주문 목록
  type BuyerOrderRow = {
    order_id: string
    status: string
    quantity: number
    options_snapshot: Record<string, unknown>
    delivery_info: Record<string, unknown>
    total_usdt6: number | null
    total_dao2: number | null
    tx_hash: string | null
    tracking_no: string | null
    tracking_company: string | null
    shipped_at: string | null
    delivered_at: string | null
    completed_at: string | null
    ordered_at: string
    buyer_wallet: string
    seller_wallet: string
    product_id: string | null
    product_title: string | null
    product_type: string | null
    product_image_url: string | null
    variant_sku: string | null
  }
  const [myBuyOrders, setMyBuyOrders] = useState<BuyerOrderRow[]>([])
  const [myBuyOrdersLoading, setMyBuyOrdersLoading] = useState(false)

  // ✨ v15: 판매자에게 들어온 주문
  const [mySellOrders, setMySellOrders] = useState<BuyerOrderRow[]>([])
  const [mySellOrdersLoading, setMySellOrdersLoading] = useState(false)

  // ✨ v15: 관리자 카테고리 관리
  type AdminCategoryRow = CategoryRow & { is_active: boolean }
  const [adminCategories, setAdminCategories] = useState<AdminCategoryRow[]>([])
  const [adminCategoriesLoading, setAdminCategoriesLoading] = useState(false)
  const [newCategoryCode, setNewCategoryCode] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryEmoji, setNewCategoryEmoji] = useState('🏷️')
  const [newCategoryType, setNewCategoryType] = useState<'physical' | 'service' | 'food' | 'digital'>('physical')

  // ✨ v15: 구매 모달 배송 정보
  const [buyDeliveryEmail, setBuyDeliveryEmail] = useState('')
  const [buyDeliveryPhone, setBuyDeliveryPhone] = useState('')
  const [buyDeliveryAddress, setBuyDeliveryAddress] = useState('')
  const [buyDeliveryNote, setBuyDeliveryNote] = useState('')
  const [buyServiceDate, setBuyServiceDate] = useState('')
  const [buyServiceTime, setBuyServiceTime] = useState('')
  const [buyFoodMethod, setBuyFoodMethod] = useState<'pickup' | 'delivery'>('pickup')

  // ✨ v15: 토스트
  const toast = useToast()

  // ✨ Patch v2.1: 검색 & 정렬
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sortOption, setSortOption] = useState<'newest' | 'priceLow' | 'priceHigh' | 'popular' | 'stock'>('newest')

  // ✨ Patch v2.2: 프로모션 상태
  // ✨ Patch v8: 프로모션 기본값 true (항상 ON)
  const [promotionActive, setPromotionActive] = useState(true)
  const [promotionDaysRemaining, setPromotionDaysRemaining] = useState<number | null>(null)

  // ✨ Patch v1: 관리자 상품 검토 - 상태별 탭 필터
  const [adminStatusFilter, setAdminStatusFilter] = useState<'All' | RequestStatus>('Pending')

  const [editProductId, setEditProductId] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editMetadataUri, setEditMetadataUri] = useState('')
  const [editCategory, setEditCategory] = useState('')
  const [editPriceUsdt, setEditPriceUsdt] = useState('')
  const [editStock, setEditStock] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editProductType, setEditProductType] = useState('일반 상품')
  const [editProductOptions, setEditProductOptions] = useState('')
  const [editShippingFeeUsdt, setEditShippingFeeUsdt] = useState('0')
  const [deleteStoragePath, setDeleteStoragePath] = useState('')

  const [primePlanName, setPrimePlanName] = useState('DAO2 Prime Pass')
  const [primeMonthlyPriceUsdt, setPrimeMonthlyPriceUsdt] = useState('0')
  const [primeDao2PassRequirement, setPrimeDao2PassRequirement] = useState('0')
  const [primeBenefitSummary, setPrimeBenefitSummary] = useState('')
  const [primePolicyMemo, setPrimePolicyMemo] = useState('')

  const [marketplaceAddressInput, setMarketplaceAddressInput] = useState('')
  const [dao2TokenAddress, setDao2TokenAddress] = useState('')
  const [configAdminWallet, setConfigAdminWallet] = useState('')
  const [treasuryWallet, setTreasuryWallet] = useState('')
  const [configFeeBps, setConfigFeeBps] = useState('700')
  const [dao2PriceUsdt6, setDao2PriceUsdt6] = useState('')
  const [storageMode, setStorageMode] = useState('hybrid')
  const [settingsNotes, setSettingsNotes] = useState('')

  const [sellerProfilesJson, setSellerProfilesJson] = useState(`[
  {
    "seller_wallet": "",
    "display_name": "",
    "status": "approved"
  }
]`)

  const hasMarketplaceAddress = Boolean(MARKETPLACE_ADDRESS)

  const isAdmin =
    Boolean(address) &&
    Boolean(ADMIN_WALLET) &&
    address!.toLowerCase() === ADMIN_WALLET!.toLowerCase()

  const { data: feeBps, isLoading: feeLoading } = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: webkeyDao2MarketplaceAbi,
    functionName: 'feeBps',
    query: {
      enabled: hasMarketplaceAddress,
    },
  })

  const { data: nextListingId, isLoading: listingLoading } = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: webkeyDao2MarketplaceAbi,
    functionName: 'nextListingId',
    query: {
      enabled: hasMarketplaceAddress,
    },
  })

  const { data: canSellData, isLoading: canSellLoading } = useReadContract({
    address: MARKETPLACE_ADDRESS,
    abi: webkeyDao2MarketplaceAbi,
    functionName: 'canSell',
    args: address ? [address] : undefined,
    query: {
      enabled: hasMarketplaceAddress && Boolean(address),
    },
  })

  // ✨ Patch v8: 프로모션 항상 ON 기반 – canSell 우회
  // 프로모션 중이거나 컨트랙트 주소 없으면 canSell() 값과 무관하게 판매 가능으로 판정
  const rawCanSell = Boolean(canSellData)
  const canSell = promotionActive || !hasMarketplaceAddress || rawCanSell

  // ✨ Patch v8: 구매(buy) 로직 – DAO2 approve → buyListing
  // dao2TokenAddress 는 상단의 useState 를 그대로 사용 (관리자 설정 프로모션 구조 유지)
  // env 값이 있으면 env 를 우선, 없으면 상태 값 사용
  const effectiveDao2TokenAddress = (
    process.env.NEXT_PUBLIC_DAO2_TOKEN_ADDRESS || dao2TokenAddress || ''
  ) as `0x${string}` | ''

  const {
    data: buyTxHash,
    writeContract: writeBuy,
    isPending: buyPending,
    error: buyError,
    reset: resetBuy,
  } = useWriteContract()

  const {
    data: approveTxHash,
    writeContract: writeApprove,
    isPending: approvePending,
    error: approveError,
    reset: resetApprove,
  } = useWriteContract()

  const { isLoading: approveConfirming, isSuccess: approveConfirmed } =
    useWaitForTransactionReceipt({ hash: approveTxHash })

  const { isLoading: buyConfirming, isSuccess: buyConfirmed } =
    useWaitForTransactionReceipt({ hash: buyTxHash })

  // 구매 진행 상태
  const [buyingItem, setBuyingItem] = useState<SellerRequest | null>(null)
  const [buyQuantity, setBuyQuantity] = useState<number>(1)
  const [buyStep, setBuyStep] = useState<'idle' | 'approving' | 'buying' | 'done'>('idle')
  const [buyMsg, setBuyMsg] = useState<string>('')

  const isFormValid = useMemo(() => {
    return (
      productTitle.trim().length > 0 &&
      productDescription.trim().length > 0 &&
      category.trim().length > 0 &&
      priceUsdt.trim().length > 0 &&
      stock.trim().length > 0
    )
  }, [productTitle, productDescription, category, priceUsdt, stock])

  // ✨ Patch v2.2: 프로모션 중이면 canSell 체크 우회
  const canSubmitRequest =
    isConnected &&
    isFormValid &&
    (promotionActive || !hasMarketplaceAddress || canSell)

  // ✨ Patch v8: 구매 플로우 핸들러
  // 1단계: DAO2 token approve (marketplace 계약이 spender)
  // 2단계: marketplace.buyListing(listingId, quantity)
  async function handleOpenBuy(item: SellerRequest) {
    resetApprove()
    resetBuy()
    setBuyStep('idle')
    setBuyMsg('')
    setBuyQuantity(1)
    setBuyingItem(item)
    // ✨ Patch v11.0: 상품 variant 목록 로드
    setSelectedVariantId('')
    setBuyingVariants([])
    setBuyingVariantsLoading(true)
    try {
      const res = await fetch(`/api/public/product-variants?productId=${item.id}`, { cache: 'no-store' })
      const json = await res.json()
      if (json?.ok && Array.isArray(json.items)) {
        setBuyingVariants(json.items)
        // 옵션 1개면 자동 선택
        if (json.items.length === 1) {
          setSelectedVariantId(json.items[0].id)
        }
      }
    } catch {
      // variant 로드 실패 시 옵션 없는 상품으로 취급
    } finally {
      setBuyingVariantsLoading(false)
    }
  }

  function closeBuyModal() {
    setBuyingItem(null)
    setBuyStep('idle')
    setBuyMsg('')
    setBuyQuantity(1)
    resetApprove()
    resetBuy()
  }

  async function handleApproveDao2() {
    if (!buyingItem) return
    if (!isConnected) {
      setBuyMsg('지갑을 먼저 연결하세요.')
      return
    }
    if (!hasMarketplaceAddress) {
      setBuyMsg('머켓플레이스 계약 주소가 설정되지 않았습니다.')
      return
    }
    if (!effectiveDao2TokenAddress) {
      setBuyMsg('DAO2 토큰 주소가 설정되지 않았습니다. 관리자 설정 화면에서 입력하거나 .env.local 에 NEXT_PUBLIC_DAO2_TOKEN_ADDRESS 를 추가하세요.')
      return
    }
    const qty = Math.max(1, Math.min(buyQuantity, Number(buyingItem.stock) || 1))
    try {
      setBuyStep('approving')
      setBuyMsg('DAO2 사용 승인(approve) 트랜잭션 요청중...')
      // 충분히 큰 한도로 approve (2^256-1)
      const MAX_UINT256 =
        BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
      writeApprove({
        address: effectiveDao2TokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [MARKETPLACE_ADDRESS as `0x${string}`, MAX_UINT256],
      })
      void qty
    } catch (err) {
      setBuyStep('idle')
      setBuyMsg('approve 요청 실패: ' + String(err))
    }
  }

  // ✨ Patch v11.0: 주문 ID를 상태에 보관해 tx 확정 시 confirm 처리에 사용
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null)

  async function handleConfirmBuy() {
    if (!buyingItem) return
    if (!isConnected) {
      setBuyMsg('지갑을 먼저 연결하세요.')
      return
    }
    if (!hasMarketplaceAddress) {
      setBuyMsg('머켓플레이스 계약 주소가 설정되지 않았습니다.')
      return
    }

    // ✨ Patch v11.0: variant 검증
    if (buyingVariants.length > 0 && !selectedVariantId) {
      setBuyMsg('옵션을 선택하세요.')
      return
    }

    const selectedVariant = buyingVariants.find((v) => v.id === selectedVariantId)
    const qtyMax = selectedVariant
      ? selectedVariant.available
      : (Number(buyingItem.stock) || 1)
    const qty = Math.max(1, Math.min(buyQuantity, qtyMax))
    if (qty <= 0) {
      setBuyMsg('재고가 없습니다.')
      return
    }

    try {
      setBuyStep('buying')
      setBuyMsg('주문 생성중 (재고 예약)...')

      // 1) Supabase 상에 pending 주문 생성 (재고 임시 차감)
      let createdOrderId: string | null = null
      try {
        const orderRes = await fetch('/api/buyer/product-orders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': address!,
          },
          body: JSON.stringify({
            productId: buyingItem.id,
            variantId: selectedVariantId || undefined,
            quantity: qty,
            options_snapshot: selectedVariant?.options || {},
            delivery_info: {},
          }),
        })
        const orderJson = await orderRes.json()
        if (orderRes.ok && orderJson?.ok && orderJson?.item?.id) {
          createdOrderId = orderJson.item.id
          setPendingOrderId(createdOrderId)
        } else {
          throw new Error(orderJson?.message || '주문 생성 실패')
        }
      } catch (orderErr) {
        setBuyStep('idle')
        setBuyMsg('❌ 주문 생성 실패: ' + (orderErr instanceof Error ? orderErr.message : String(orderErr)))
        return
      }

      // 2) 온체인 buyListing 호출
      setBuyMsg('구매 트랜잭션 요청중... 지갑에서 승인해주세요.')
      writeBuy({
        address: MARKETPLACE_ADDRESS as `0x${string}`,
        abi: webkeyDao2MarketplaceAbi,
        functionName: 'buyListing',
        args: [BigInt(buyingItem.id), BigInt(qty)],
      })
    } catch (err) {
      setBuyStep('idle')
      setBuyMsg('buy 요청 실패: ' + String(err))
    }
  }

  // approve 확정 감지
  useEffect(() => {
    if (approveConfirmed && buyStep === 'approving') {
      setBuyStep('idle')
      setBuyMsg('✅ DAO2 승인 완료. 아래 "구매 확정" 를 눌러 진행하세요.')
    }
  }, [approveConfirmed, buyStep])

  // buy 확정 감지 (Patch v11.0: 주문 confirm API 호출)
  useEffect(() => {
    if (buyConfirmed && buyStep === 'buying') {
      (async () => {
        if (pendingOrderId && address) {
          try {
            await fetch('/api/buyer/product-orders', {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-wallet-address': address,
              },
              body: JSON.stringify({
                orderId: pendingOrderId,
                tx_hash: buyTxHash,
              }),
            })
          } catch {
            // confirm 실패해도 온체인은 이미 성공 – 서버로그만 남김
          }
        }
        setPendingOrderId(null)
        setBuyStep('done')
        setBuyMsg('🎉 구매 완료되었습니다.')
      })()
      const t = setTimeout(() => {
        closeBuyModal()
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [buyConfirmed, buyStep, pendingOrderId, buyTxHash, address])

  // 에러 감지
  useEffect(() => {
    if (approveError && buyStep === 'approving') {
      setBuyStep('idle')
      setBuyMsg('❌ approve 실패: ' + (approveError as Error).message)
    }
  }, [approveError, buyStep])

  useEffect(() => {
    if (buyError && buyStep === 'buying') {
      // ✨ Patch v11.0: tx 실패 시 주문 자동 취소
      (async () => {
        if (pendingOrderId && address) {
          try {
            await fetch(`/api/buyer/product-orders?id=${pendingOrderId}`, {
              method: 'DELETE',
              headers: { 'x-wallet-address': address },
            })
          } catch {
            /* ignore */
          }
          setPendingOrderId(null)
        }
      })()
      setBuyStep('idle')
      setBuyMsg('❌ buyListing 실패: ' + (buyError as Error).message)
    }
  }, [buyError, buyStep, pendingOrderId, address])

  const sellerRequests = useMemo(() => {
    if (!address) return []
    return requests.filter(
      (request) => request.seller.toLowerCase() === address.toLowerCase(),
    )
  }, [requests, address])

  const sellerStats = useMemo(() => {
    return sellerRequests.reduce(
      (acc, request) => {
        acc.total += 1
        if (request.status === 'Pending') acc.pending += 1
        if (request.status === 'Approved') acc.approved += 1
        if (request.status === 'Rejected') acc.rejected += 1
        if (request.status === 'Paused') acc.paused += 1
        acc.soldCount += request.soldCount
        acc.revenueDao2 += Number(request.revenueDao2)
        return acc
      },
      {
        total: 0,
        pending: 0,
        approved: 0,
        rejected: 0,
        paused: 0,
        soldCount: 0,
        revenueDao2: 0,
      },
    )
  }, [sellerRequests])

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === 'Pending'),
    [requests],
  )

  // ✨ Patch v1: 관리자 요청 목록 - 상태별 필터
  const filteredAdminRequests = useMemo(() => {
    if (adminStatusFilter === 'All') return requests
    return requests.filter((request) => request.status === adminStatusFilter)
  }, [requests, adminStatusFilter])

  // ✨ Patch v1: 관리자 상태별 카운트
  const adminStatusCounts = useMemo(() => {
    return requests.reduce(
      (acc, r) => {
        acc.All += 1
        acc[r.status] = (acc[r.status] || 0) + 1
        return acc
      },
      { All: 0, Pending: 0, Approved: 0, Rejected: 0, Paused: 0, SoldOut: 0 } as Record<string, number>,
    )
  }, [requests])

  // ✨ Patch v1: 구매자 영역 - Approved 상품만 표시 (핵심 버그 수정!)
  //   기존: approvedProducts 전체 사용 → status 체크 없어서 버그
  //   수정: status === 'Approved' 만 필터 + stock > 0
  const displayableProducts = useMemo(() => {
    return approvedProducts.filter(
      (p) => p.status === 'Approved' && Number(p.stock) > 0,
    )
  }, [approvedProducts])

  // ✨ Patch v1: 카테고리 목록 추출
  const availableCategories = useMemo(() => {
    const cats = new Set<string>()
    displayableProducts.forEach((p) => {
      if (p.category) cats.add(p.category)
    })
    return Array.from(cats).sort()
  }, [displayableProducts])

  // ✨ Patch v9.2: 검색 + 유형 필터 + 카테고리 필터 + 정렬 통합
  const filteredBuyProducts = useMemo(() => {
    let result = [...displayableProducts]

    // 1) 상품 유형 필터 (Patch v9.2)
    if (selectedProductType !== 'all') {
      result = result.filter((p) => (p.productType || 'physical') === selectedProductType)
    }

    // 2) 카테고리 필터 – 신규 categoryCode 우선, 없으면 기존 category 문자열 사용
    if (selectedCategory !== 'all') {
      result = result.filter(
        (p) => (p.categoryCode || p.category) === selectedCategory,
      )
    }

    // 3) 검색 필터 (상품명 / 설명 / 카테고리 / 판매자 주소)
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.seller.toLowerCase().includes(q),
      )
    }

    // 3) 정렬
    switch (sortOption) {
      case 'newest':
        result.sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0
          return bTime - aTime
        })
        break
      case 'priceLow':
        result.sort((a, b) => Number(a.priceUsdt) - Number(b.priceUsdt))
        break
      case 'priceHigh':
        result.sort((a, b) => Number(b.priceUsdt) - Number(a.priceUsdt))
        break
      case 'popular':
        result.sort((a, b) => b.soldCount - a.soldCount)
        break
      case 'stock':
        result.sort((a, b) => Number(b.stock) - Number(a.stock))
        break
    }

    return result
  }, [displayableProducts, selectedProductType, selectedCategory, searchQuery, sortOption])

  // ✨ Patch v2.1: 카테고리별 그룹핑 — 검색/정렬 적용 후 그룹화
  //   검색어가 있거나 특정 카테고리 선택 시에는 그룹핑 안 함 (평평한 결과)
  const productsByCategory = useMemo(() => {
    const groups: Record<string, SellerRequest[]> = {}
    filteredBuyProducts.forEach((p) => {
      const cat = p.category || '기타'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(p)
    })
    return groups
  }, [filteredBuyProducts])

  const fetchRuntime = async () => {
    const json = await readJson<{
      ok: true
      marketplace: RuntimeConfig['marketplace']
      prime: RuntimeConfig['prime']
      promotion?: { active: boolean; endDate: string | null; daysRemaining: number | null }
    }>('/api/public/runtime')

    setRuntimeConfig({
      marketplace: json.marketplace,
      prime: json.prime,
      promotion: json.promotion,
    })

    // ✨ Patch v2.2: 프로모션 상태 업데이트
    if (json.promotion) {
      // ✨ Patch v8: 서버가 false를 내려도 프로모션 ON 유지 (항상 ON 정책)
      setPromotionActive(true)
      setPromotionDaysRemaining(json.promotion.daysRemaining)
    }
  }

  const fetchApprovedProducts = async () => {
    const json = await readJson<{ ok: true; items: Record<string, unknown>[] }>(
      '/api/public/products',
    )
    setApprovedProducts((json.items ?? []).map(normalizeItem))
  }

  const fetchSellData = async () => {
    if (!address) {
      setRequests([])
      return
    }

    setLoading(true)
    setMessage('')

    try {
      if (isAdmin) {
        const json = await readJson<{ ok: true; items: Record<string, unknown>[] }>(
          '/api/admin/marketplace-products',
          {
            headers: {
              'x-wallet-address': address,
            },
          },
        )
        setRequests((json.items ?? []).map(normalizeItem))
      } else {
        const json = await readJson<{ ok: true; items: Record<string, unknown>[] }>(
          `/api/seller/my-products?wallet=${address}`,
          {
            headers: {
              'x-wallet-address': address,
            },
          },
        )
        setRequests((json.items ?? []).map(normalizeItem))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '목록 불러오기에 실패했다.')
      setRequests([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRuntime().catch(() => undefined)
    fetchApprovedProducts().catch(() => undefined)
    // ✨ Patch v9.0: 카테고리 로드
    loadCategories().catch(() => undefined)
  }, [])

  // ✨ Patch v11.1: 카테고리 로드 – DB 비어있거나 API 실패 시에도 등록 가능하도록 fallback 강제
  function getFallbackCategories(): CategoryRow[] {
    return [
      { id: 'f-top', code: 'top', name_ko: '상의', emoji: '👕', product_type: 'physical', sort_order: 10 },
      { id: 'f-bottom', code: 'bottom', name_ko: '하의', emoji: '👖', product_type: 'physical', sort_order: 20 },
      { id: 'f-outer', code: 'outer', name_ko: '아우터', emoji: '🧥', product_type: 'physical', sort_order: 30 },
      { id: 'f-shoes', code: 'shoes', name_ko: '신발', emoji: '👟', product_type: 'physical', sort_order: 40 },
      { id: 'f-hat', code: 'hat', name_ko: '모자', emoji: '🧢', product_type: 'physical', sort_order: 50 },
      { id: 'f-watch', code: 'watch', name_ko: '시계', emoji: '⌚', product_type: 'physical', sort_order: 60 },
      { id: 'f-bag', code: 'bag', name_ko: '가방', emoji: '👜', product_type: 'physical', sort_order: 70 },
      { id: 'f-appliance', code: 'appliance', name_ko: '가전', emoji: '📺', product_type: 'physical', sort_order: 80 },
      { id: 'f-service', code: 'service', name_ko: '서비스', emoji: '💅', product_type: 'service', sort_order: 100 },
      { id: 'f-food', code: 'food', name_ko: '음식', emoji: '🍱', product_type: 'food', sort_order: 110 },
      { id: 'f-etc', code: 'etc', name_ko: '기타', emoji: '📦', product_type: 'physical', sort_order: 200 },
    ]
  }

  function applyFallbackCategories(reason: string) {
    const fb = getFallbackCategories()
    setCategoriesAll(fb)
    setCategoriesByType({
      physical: fb.filter((c) => c.product_type === 'physical'),
      service: fb.filter((c) => c.product_type === 'service'),
      food: fb.filter((c) => c.product_type === 'food'),
      digital: fb.filter((c) => c.product_type === 'digital'),
    })
    setCategoriesLoaded(true)
    setCategoriesDebug(reason)
  }

  async function loadCategories() {
    try {
      const res = await fetch('/api/public/categories', { cache: 'no-store' })

      // 1) HTTP status 쳋크
      if (!res.ok) {
        applyFallbackCategories(
          `API 나킨 HTTP ${res.status} – 하드코딩 카테고리 사용 중. SQL 00_MASTER_RUN_ALL.sql 실행 여부 확인`,
        )
        return
      }

      // 2) JSON 파싱
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        applyFallbackCategories(
          `API 응답이 JSON 이 아님 (content-type=${contentType}) – 라우트 미배포 가능성. /api/public/categories/route.ts 확인`,
        )
        return
      }

      const json = await res.json()

      // 3) ok=false
      if (!json?.ok) {
        applyFallbackCategories(
          `API 오류: ${json?.message || '알 수 없음'} – SUPABASE_SERVICE_ROLE_KEY 확인`,
        )
        return
      }

      // 4) items 비어있음 (테이블은 있는데 seed 미실행)
      if (!Array.isArray(json.items) || json.items.length === 0) {
        applyFallbackCategories(
          'DB 카테고리가 0개 – SQL 00_MASTER_RUN_ALL.sql 흐은 03 실행 여부 확인. 임시로 하드코딩 사용 중',
        )
        return
      }

      // 5) 성공
      setCategoriesAll(json.items)
      setCategoriesByType({
        physical: json.grouped?.physical ?? [],
        service: json.grouped?.service ?? [],
        food: json.grouped?.food ?? [],
        digital: json.grouped?.digital ?? [],
      })
      setCategoriesLoaded(true)
      setCategoriesDebug('')
    } catch (err) {
      applyFallbackCategories(
        `네트워크 오류: ${err instanceof Error ? err.message : String(err)} – 하드코딩 카테고리 사용 중`,
      )
    }
  }

  useEffect(() => {
    if (!runtimeConfig) return

    setPrimePlanName(runtimeConfig?.prime?.plan_name || 'DAO2 Prime Pass')
    setMarketplaceAddressInput(runtimeConfig?.marketplace?.marketplace_address || '')
    setConfigFeeBps(String(runtimeConfig?.marketplace?.fee_bps ?? 700))
    setConfigAdminWallet(ADMIN_WALLET || address || '')
  }, [runtimeConfig, address])

  useEffect(() => {
    if (viewMode !== 'sell') return
    if (!address) {
      setRequests([])
      return
    }

    fetchSellData().catch(() => undefined)
  }, [viewMode, address, isAdmin])

  const handleSubmitRequest = async () => {
    if (!address || !canSubmitRequest) return

    setActionLoading(true)
    setMessage('')

    try {
      // ✨ Patch v9.0: 상품 유형·카테고리 코드 + 유형별 추가 필드 metadata_extra
      const selectedCategoryRow = categoriesAll.find((c) => c.code === category)
      const categoryLabel = selectedCategoryRow
        ? `${selectedCategoryRow.emoji ? selectedCategoryRow.emoji + ' ' : ''}${selectedCategoryRow.name_ko}`
        : category

      const metadataExtra: Record<string, unknown> = {}
      if (productType === 'physical') {
        if (extraSize) metadataExtra.size = extraSize
        if (extraColor) metadataExtra.color = extraColor
      } else if (productType === 'service') {
        if (extraDurationMinutes) metadataExtra.duration_minutes = Number(extraDurationMinutes)
        metadataExtra.reservation_required = extraReservationRequired
      } else if (productType === 'food') {
        if (extraShopAddress) metadataExtra.shop_address = extraShopAddress
        if (extraOpenHours)  metadataExtra.open_hours = extraOpenHours
      } else if (productType === 'digital') {
        metadataExtra.delivery_method = extraDeliveryMethod
      }

      // ✨ Patch v11.0: variant 총합 재고로 stock 재계산 (variant 이 있으면 개별 stock 합산, 없으면 입력받은 stock 그대로)
      const effectiveStock =
        draftVariants.length > 0
          ? draftVariants.reduce((sum, v) => sum + Number(v.stock || 0), 0)
          : Number(stock || 0)

      const createRes = await readJson<{ ok: boolean; item: { id: string } }>(
        '/api/seller/product-request',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-wallet-address': address,
          },
          body: JSON.stringify({
            wallet: address,
            title: productTitle,
            description: productDescription,
            metadataUri,
            category: categoryLabel || category,
            product_type: productType,
            category_code: category,
            metadata_extra: metadataExtra,
            priceUsdt,
            stock: effectiveStock,
            imageUrl: productImageUrl,
          }),
        },
      )

      // ✨ Patch v11.0: variant 저장
      const newProductId = createRes?.item?.id
      if (newProductId && draftVariants.length > 0) {
        for (const v of draftVariants) {
          if (!Object.keys(v.options).length) continue
          try {
            await fetch('/api/seller/product-variants', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-wallet-address': address,
              },
              body: JSON.stringify({
                productId: newProductId,
                options: v.options,
                stock: Number(v.stock || 0),
                price_usdt_delta: Number(v.price_delta || 0),
                sku: v.sku || undefined,
              }),
            })
          } catch {
            // 개별 실패 무시, 본인이 나중에 관리화면에서 추가 가능
          }
        }
      }

      setDraftVariants([])
      setProductTitle('')
      setProductDescription('')
      setMetadataUri('')
      setCategory('')
      setPriceUsdt('')
      setStock('')
      setProductImageUrl('')
      // v9.0 추가 필드 초기화
      setExtraSize('')
      setExtraColor('')
      setExtraDurationMinutes('')
      setExtraReservationRequired(true)
      setExtraShopAddress('')
      setExtraOpenHours('')
      setExtraDeliveryMethod('email')
      setMessage('✅ 등록 요청이 저장되었다. 관리자 심사 후 공개된다.')
      // ✨ v15: 등록 완료 토스트 + 내 판매 관리로 이동 버튼
      toast.custom({
        kind: 'success',
        title: '상품 등록 요청 완료',
        description: '변경사항은 “내 판매 관리” 탭에서 확인할 수 있습니다. 관리자 심사 후 공개됩니다.',
        actionLabel: '내 판매 관리로 이동',
        onAction: () => {
          setSellTab('mine')
          setMineSubTab('requests')
        },
        ttlMs: 8000,
      })
      await fetchSellData()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '등록 요청 저장에 실패했다.'
      setMessage(msg)
      toast.error('등록 실패', msg)
    } finally {
      setActionLoading(false)
    }
  }

  // ✨ Patch v9.1: 이미지 업로드 핸들러 (서버 API 실패 시 브라우저 직접 업로드 fallback)
  const handleImageUpload = async (file: File, target: 'register' | 'edit') => {
    if (!address) {
      setMessage('지갑 연결이 필요합니다.')
      return
    }

    // 클라이언트 체크
    if (file.size > 5 * 1024 * 1024) {
      setMessage('파일 크기는 5MB 이하여야 합니다.')
      return
    }
    if (!file.type.startsWith('image/')) {
      setMessage('이미지 파일만 업로드 가능합니다.')
      return
    }
    const allowedMime = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
    if (!allowedMime.includes((file.type || '').toLowerCase())) {
      setMessage(`허용 형식: JPG / PNG / WebP / GIF (입력된 MIME: ${file.type || '없음'})`)
      return
    }

    setUploadingImage(true)
    setMessage('이미지 업로드 중...')

    // 1차: 서버 API 경로 시도
    let imageUrl = ''
    let serverErrMsg = ''
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('wallet', address)

      const response = await fetch('/api/seller/product-image-upload', {
        method: 'POST',
        headers: { 'x-wallet-address': address },
        body: formData,
      })

      const contentType = response.headers.get('content-type') || ''
      let json: { ok?: boolean; imageUrl?: string; message?: string; detail?: string; hint?: string } = {}
      if (contentType.includes('application/json')) {
        json = await response.json()
      } else {
        const text = await response.text()
        json = { ok: false, message: text.slice(0, 200) }
      }

      if (response.ok && json.ok !== false && json.imageUrl) {
        imageUrl = json.imageUrl
      } else {
        serverErrMsg =
          (json.message || `HTTP ${response.status}`) +
          (json.detail ? ` | ${json.detail}` : '') +
          (json.hint ? ` | ${json.hint}` : '')
      }
    } catch (err) {
      serverErrMsg = err instanceof Error ? err.message : String(err)
    }

    // 2차: 서버 API 실패 → 브라우저 직접 Supabase Storage 업로드 fallback
    if (!imageUrl) {
      try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (!supabaseUrl || !supabaseAnonKey) {
          throw new Error(
            '서버 API 실패, 브라우저 fallback도 불가 (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 누락). 서버 에러: ' + serverErrMsg,
          )
        }

        const ext =
          file.type === 'image/png' ? 'png' :
          file.type === 'image/webp' ? 'webp' :
          file.type === 'image/gif' ? 'gif' :
          'jpg'
        const objectPath = `${address.toLowerCase()}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
        const uploadUrl = `${supabaseUrl}/storage/v1/object/product-images/${objectPath}`

        const upRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            apikey: supabaseAnonKey,
            Authorization: `Bearer ${supabaseAnonKey}`,
            'Content-Type': file.type || 'application/octet-stream',
            'x-upsert': 'false',
            'Cache-Control': 'max-age=31536000',
          },
          body: file,
        })

        if (!upRes.ok) {
          const errText = await upRes.text()
          throw new Error(`브라우저 fallback 실패 (HTTP ${upRes.status}): ${errText.slice(0, 200)}`)
        }

        imageUrl = `${supabaseUrl}/storage/v1/object/public/product-images/${objectPath}`
      } catch (fbErr) {
        setUploadingImage(false)
        setMessage(
          '❌ 이미지 업로드 실패.\n' +
          (serverErrMsg ? '· 서버: ' + serverErrMsg + '\n' : '') +
          '· 브라우저: ' + (fbErr instanceof Error ? fbErr.message : String(fbErr)) + '\n' +
          '· 확인할 사항: Supabase Storage 버킷(product-images)이 public 인지, .env.local 에 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY 가 있는지',
        )
        return
      }
    }

    if (target === 'register') {
      setProductImageUrl(imageUrl)
    } else {
      setEditingSellerImageUrl(imageUrl)
    }
    setMessage('✅ 이미지 업로드 완료.')
    toast.success('이미지 업로드 완료')
    setUploadingImage(false)
  }

  // ✨ Patch v2.2: 판매자 본인 상품 수정 모달 열기
  const openSellerEditModal = (request: SellerRequest) => {
    setEditingSellerProductId(request.id)
    setEditingSellerTitle(request.title)
    setEditingSellerDescription(request.description)
    setEditingSellerCategory(request.category)
    setEditingSellerPriceUsdt(request.priceUsdt)
    setEditingSellerStock(request.stock)
    setEditingSellerImageUrl(request.imageUrl || '')
  }

  // ✨ Patch v2.2: 판매자 본인 상품 수정 저장
  const handleSellerSaveProduct = async () => {
    if (!address || !editingSellerProductId) return

    setActionLoading(true)
    setMessage('')

    try {
      await readJson('/api/seller/product-manage', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
        },
        body: JSON.stringify({
          wallet: address,
          productId: editingSellerProductId,
          title: editingSellerTitle,
          description: editingSellerDescription,
          category: editingSellerCategory,
          priceUsdt: editingSellerPriceUsdt,
          stock: editingSellerStock,
          imageUrl: editingSellerImageUrl,
        }),
      })

      setMessage('✅ 상품 수정 완료.')
      toast.success('상품 수정 완료')
      setEditingSellerProductId(null)
      await fetchSellData()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '수정 실패')
    } finally {
      setActionLoading(false)
    }
  }

  // ✨ Patch v2.2: 판매자 본인 상품 삭제
  const handleSellerDeleteProduct = async (productId: string, title: string) => {
    if (!address) return
    if (!confirm(`'${title}' 상품을 정말 삭제할까?`)) return

    setActionLoading(true)
    setMessage('')

    try {
      await readJson('/api/seller/product-manage', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
        },
        body: JSON.stringify({
          wallet: address,
          productId,
        }),
      })

      setMessage('✅ 상품 삭제 완료.')
      await fetchSellData()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '삭제 실패')
    } finally {
      setActionLoading(false)
    }
  }

  const handleUpdateRequestStatus = async (
    requestId: string,
    nextStatus: RequestStatus,
    previousStatus: RequestStatus,
    rejectionReason?: string,
  ) => {
    if (!address || !isAdmin) return

    setActionLoading(true)
    setMessage('')

    try {
      await readJson('/api/admin/product-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
        },
        body: JSON.stringify({
          wallet: address,
          productId: requestId,
          status: nextStatus,
          previousStatus,
          rejectionReason: rejectionReason || undefined,
        }),
      })

      setMessage(`상품 상태가 ${nextStatus}(으)로 변경되었다.`)
      await fetchSellData()
      await fetchApprovedProducts()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '상태 변경에 실패했다.')
    } finally {
      setActionLoading(false)
    }
  }

  // ✨ Patch v1: 거절 모달 열기
  const openRejectModal = (requestId: string, previousStatus: RequestStatus) => {
    setRejectingId(requestId)
    setRejectingPrevStatus(previousStatus)
    setRejectionReasonInput('')
  }

  // ✨ Patch v1: 거절 모달 확정
  const confirmReject = async () => {
    if (!rejectingId) return
    if (!rejectionReasonInput.trim()) {
      setMessage('거절 사유를 입력해야 한다.')
      return
    }

    await handleUpdateRequestStatus(rejectingId, 'Rejected', rejectingPrevStatus, rejectionReasonInput.trim())
    setRejectingId(null)
    setRejectionReasonInput('')
  }

  // ✨ Patch v1: 거절 모달 취소
  const cancelReject = () => {
    setRejectingId(null)
    setRejectionReasonInput('')
  }

  const loadRequestIntoEditor = (request: SellerRequest) => {
    setEditProductId(request.id)
    setEditTitle(request.title)
    setEditDescription(request.description)
    setEditMetadataUri(request.metadataUri)
    setEditCategory(request.category)
    setEditPriceUsdt(request.priceUsdt)
    setEditStock(request.stock)
    setEditImageUrl(request.imageUrl || '')
    setEditProductType('일반 상품')
    setEditProductOptions('')
    setEditShippingFeeUsdt('0')
    setMessage(`편집 대상 상품 ${request.title} 를 불러왔다.`)
  }

  const handleSaveProduct = async () => {
    if (!address || !isAdmin || !editProductId) return

    setActionLoading(true)
    setMessage('')

    try {
      await readJson('/api/admin/product-manage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
        },
        body: JSON.stringify({
          wallet: address,
          productId: editProductId,
          title: editTitle,
          description: editDescription,
          metadataUri: editMetadataUri,
          category: editCategory,
          priceUsdt: editPriceUsdt,
          stock: editStock,
          imageUrl: editImageUrl,
          productType: editProductType,
          productOptions: editProductOptions,
          shippingFeeUsdt: editShippingFeeUsdt,
        }),
      })

      setMessage('상품 수정 저장이 완료되었다.')
      await fetchSellData()
      await fetchApprovedProducts()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '상품 수정 저장에 실패했다.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteProduct = async () => {
    if (!address || !isAdmin || !editProductId) return
    if (!confirm('정말 이 상품을 삭제할까?')) return

    setActionLoading(true)
    setMessage('')

    try {
      await readJson('/api/admin/product-manage', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
        },
        body: JSON.stringify({
          wallet: address,
          productId: editProductId,
          storagePath: deleteStoragePath,
        }),
      })

      setMessage('상품 삭제가 완료되었다.')
      setEditProductId('')
      await fetchSellData()
      await fetchApprovedProducts()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '상품 삭제에 실패했다.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteProductImage = async () => {
    if (!address || !isAdmin || !editProductId) return

    setActionLoading(true)
    setMessage('')

    try {
      await readJson('/api/admin/product-image-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
        },
        body: JSON.stringify({
          wallet: address,
          productId: editProductId,
          storagePath: deleteStoragePath,
          previousImageUrl: editImageUrl,
        }),
      })

      setEditImageUrl('')
      setMessage('대표 이미지 삭제가 완료되었다.')
      await fetchSellData()
      await fetchApprovedProducts()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '대표 이미지 삭제에 실패했다.')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSavePrimeSettings = async () => {
    if (!address || !isAdmin) return
    setActionLoading(true)
    setMessage('')
    try {
      await readJson('/api/admin/settings-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': address },
        body: JSON.stringify({
          wallet: address,
          scope: 'prime',
          planName: primePlanName,
          monthlyPriceUsdt: primeMonthlyPriceUsdt,
          dao2PassRequirement: primeDao2PassRequirement,
          benefitSummary: primeBenefitSummary,
          policyMemo: primePolicyMemo,
        }),
      })
      setMessage('Prime 정책 저장 완료')
      await fetchRuntime()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Prime 정책 저장 실패')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSaveMarketplaceSettings = async () => {
    if (!address || !isAdmin) return
    setActionLoading(true)
    setMessage('')
    try {
      await readJson('/api/admin/settings-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': address },
        body: JSON.stringify({
          wallet: address,
          scope: 'marketplace',
          marketplaceAddress: marketplaceAddressInput,
          dao2TokenAddress,
          adminWallet: configAdminWallet,
          treasuryWallet,
          feeBps: configFeeBps,
          dao2PriceUsdt6,
          storageMode,
          notes: settingsNotes,
        }),
      })
      setMessage('Marketplace 설정 저장 완료')
      await fetchRuntime()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Marketplace 설정 저장 실패')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSyncSellerProfiles = async () => {
    if (!address || !isAdmin) return
    setActionLoading(true)
    setMessage('')
    try {
      await readJson('/api/admin/seller-profiles-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': address },
        body: JSON.stringify({
          wallet: address,
          profiles: JSON.parse(sellerProfilesJson),
        }),
      })
      setMessage('판매자 프로필 동기화 완료')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '판매자 프로필 동기화 실패')
    } finally {
      setActionLoading(false)
    }
  }

  const handleMaintenanceAction = async (action: 'operation_health_check' | 'backup_snapshot_create') => {
    if (!address || !isAdmin) return
    setActionLoading(true)
    setMessage('')
    try {
      await readJson('/api/admin/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': address },
        body: JSON.stringify({ wallet: address, action }),
      })
      setMessage(`운영 액션 실행 완료: ${action}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '운영 액션 실행 실패')
    } finally {
      setActionLoading(false)
    }
  }

  return (
    <main className="min-h-screen text-slate-800 relative">
      {/* Premium Plus v7: 활발한 파스텔 블롭 + 파티클은 globals.css body::before */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="pp-blob pp-blob-lavender" style={{ top: '-6rem', left: '-4rem', width: '22rem', height: '22rem' }} />
        <div className="pp-blob pp-blob-pink"     style={{ top: '8rem', right: '-5rem', width: '24rem', height: '24rem', animationDelay: '2s' }} />
        <div className="pp-blob pp-blob-sky"      style={{ bottom: '10%', left: '30%', width: '22rem', height: '22rem', animationDelay: '4s' }} />
        <div className="pp-blob pp-blob-fuchsia"  style={{ bottom: '-6rem', right: '20%', width: '20rem', height: '20rem', animationDelay: '6s' }} />
      </div>
      <div className="relative z-10">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-8 md:px-8 md:py-12">
        <section className="relative mb-8 overflow-hidden rounded-[40px] border border-white/70 p-6 md:p-10" style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.56) 100%)',
          backdropFilter: 'blur(24px) saturate(185%)',
          WebkitBackdropFilter: 'blur(24px) saturate(185%)',
          boxShadow: '0 35px 100px rgba(109,40,217,0.16), inset 0 1px 0 rgba(255,255,255,0.92)'
        }}>
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -left-16 -top-12 h-56 w-56 rounded-full bg-fuchsia-300/35 blur-3xl" />
            <div className="absolute right-0 top-0 h-72 w-72 rounded-full bg-violet-300/25 blur-3xl" />
            <div className="absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-cyan-300/25 blur-3xl" />
          </div>

          <div className="relative z-10 grid gap-8 xl:grid-cols-[1.35fr_0.9fr] xl:items-stretch">
            <div className="flex flex-col justify-between">
              <div>
                <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/80 px-4 py-2 text-xs font-black text-violet-700 shadow-sm md:text-sm">
                  ✨ WebKey DAO2 Marketplace · Premium Launch UI
                </div>

                <h1 className="text-4xl font-black tracking-[-0.06em] text-slate-900 md:text-6xl xl:text-7xl">
                  <span className="bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 bg-clip-text text-transparent">BNB Chain 기반</span>
                  <br />
                  <span className="bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">DAO2 Marketplace DApp</span>
                </h1>

                <p className="mt-6 max-w-2xl text-sm leading-7 text-slate-700 md:text-base xl:text-lg">
                  구매자와 판매자 흐름을 분리하고, 관리자 심사와 프로모션 모드를 함께 운용하는 Web3 마켓플레이스입니다.
                  상단 홈 화면에서 구매 진입과 판매 진입을 명확히 구분해 첫인상을 프리미엄 랜딩처럼 보이도록 재구성했습니다.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="rounded-full border border-sky-200 bg-sky-50/90 px-4 py-2 text-xs font-bold text-sky-700 shadow-sm md:text-sm">⚡ BNB Chain Mainnet</span>
                  <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50/90 px-4 py-2 text-xs font-bold text-fuchsia-700 shadow-sm md:text-sm">💎 DAO2 실사용 마켓</span>
                  <span className="rounded-full border border-violet-200 bg-violet-50/90 px-4 py-2 text-xs font-bold text-violet-700 shadow-sm md:text-sm">🛡️ 관리자 심사 + 운영 제어</span>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="rounded-[26px] border border-violet-200 bg-white/80 px-4 py-3 shadow-lg shadow-violet-100/70 backdrop-blur-xl">
                  <ConnectButton />
                </div>

                <div className="grid grid-cols-2 gap-3 md:min-w-[340px]">
                  <div className="rounded-2xl border border-white/80 bg-white/72 p-4 shadow-lg shadow-violet-100/60 backdrop-blur-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-500">Items</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{displayableProducts.length}</div>
                    <div className="mt-1 text-xs text-slate-600">구매 가능 상품</div>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/72 p-4 shadow-lg shadow-fuchsia-100/60 backdrop-blur-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500">Prime</div>
                    <div className="mt-2 text-lg font-black text-slate-900 truncate">{runtimeConfig?.prime?.plan_name || 'DAO2 Prime'}</div>
                    <div className="mt-1 text-xs text-slate-600">프리미엄 멤버십</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[32px] border border-violet-200/90 bg-white/78 p-6 shadow-2xl shadow-violet-100/70 backdrop-blur-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-500">Marketplace Status</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{hasMarketplaceAddress ? 'Active' : 'Setup Required'}</div>
                  </div>
                  <div className="rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-3 text-white shadow-lg">🚀</div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-violet-100 bg-white/78 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Fee</div>
                    <div className="mt-2 text-xl font-black text-slate-900">
                      {!hasMarketplaceAddress
                        ? String(runtimeConfig?.marketplace?.fee_bps ?? '-')
                        : feeLoading
                        ? '...'
                        : `${String(feeBps ?? '-')} bps`}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-fuchsia-100 bg-white/78 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Seller Access</div>
                    <div className="mt-2 text-xl font-black text-slate-900">
                      {!isConnected ? 'Wallet 연결 필요' : (promotionActive ? '가능 (프로모션)' : canSellLoading ? 'Checking...' : canSell ? '가능' : '심사 필요')}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Current Wallet</div>
                  <div className="mt-2 truncate text-sm font-semibold text-slate-800">{address ?? '지갑 미연결'}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {isAdmin && <span className="rounded-full bg-violet-100 px-3 py-1 font-bold text-violet-700">ADMIN</span>}
                    {promotionActive && <span className="rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-700">PROMOTION ON</span>}
                  </div>
                </div>
              </div>

              {promotionActive && (
                <div className="rounded-[28px] border border-amber-200/90 bg-gradient-to-r from-amber-100/95 via-orange-100/90 to-pink-100/95 p-5 shadow-xl shadow-amber-100/80">
                  <div className="flex flex-wrap items-center gap-3 text-sm font-black text-slate-800 md:text-base">
                    <span>🎉 런칭 프로모션 진행 중</span>
                    {promotionDaysRemaining !== null && promotionDaysRemaining > 0 && (
                      <span className="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-black text-white shadow-md">
                        D-{promotionDaysRemaining}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">프로모션 기간 동안 누구나 등록 가능 · 공개 전 관리자 심사 진행</p>
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mb-8 grid gap-6 lg:grid-cols-2">
          <button
            onClick={() => setViewMode('buy')}
            className="group relative overflow-hidden text-left"
            style={{
              minHeight: '300px',
              borderRadius: '34px',
              padding: '34px',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.74) 100%)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(191,219,254,0.95)',
              boxShadow: '0 28px 70px rgba(2,132,199,0.12), inset 0 1px 0 rgba(255,255,255,0.84)',
              transition: 'all 0.28s ease'
            }}
          >
            <div className="absolute -right-12 -top-10 h-44 w-44 rounded-full bg-sky-300/25 blur-3xl" />
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50/80 px-4 py-1.5 text-xs font-black text-sky-700 shadow-sm">🛒 BUY MODE</div>
                <div className="mt-5 text-4xl font-black tracking-[-0.04em] text-sky-700 md:text-5xl">구매하기</div>
                <p className="mt-4 max-w-lg text-sm leading-7 text-slate-700 md:text-base">
                  승인된 상품을 카테고리별로 둘러보고, 검색·정렬·상품 카드 중심으로 쇼핑 경험을 시작하는 메인 진입 영역입니다.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/80 bg-white/78 p-4 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500">Explorer</div>
                    <div className="mt-2 text-sm font-bold text-slate-800">카테고리 탐색 + 검색 + 정렬</div>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/78 p-4 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500">Payment</div>
                    <div className="mt-2 text-sm font-bold text-slate-800">DAO2 기준 결제 흐름 연결</div>
                  </div>
                </div>
              </div>

              <div className="mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-sky-200/90">
                마켓 탐색 시작 →
              </div>
            </div>
          </button>

          <button
            onClick={() => { setViewMode('sell'); setSellTab('register') }}
            className="group relative overflow-hidden text-left"
            style={{
              minHeight: '300px',
              borderRadius: '34px',
              padding: '34px',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.88) 0%, rgba(255,255,255,0.74) 100%)',
              backdropFilter: 'blur(20px) saturate(180%)',
              WebkitBackdropFilter: 'blur(20px) saturate(180%)',
              border: '1px solid rgba(233,213,255,0.98)',
              boxShadow: '0 28px 70px rgba(168,85,247,0.14), inset 0 1px 0 rgba(255,255,255,0.84)',
              transition: 'all 0.28s ease'
            }}
          >
            <div className="absolute -right-10 -top-8 h-44 w-44 rounded-full bg-fuchsia-300/25 blur-3xl" />
            <div className="relative z-10 flex h-full flex-col justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-200 bg-fuchsia-50/80 px-4 py-1.5 text-xs font-black text-fuchsia-700 shadow-sm">💼 SELL MODE</div>
                <div className="mt-5 text-4xl font-black tracking-[-0.04em] text-violet-700 md:text-5xl">판매하기</div>
                <p className="mt-4 max-w-lg text-sm leading-7 text-slate-700 md:text-base">
                  상품 등록, 이미지 업로드, 요청 현황 추적, 관리자 검토 대응, 운영 설정까지 한 번에 이어지는 셀러 진입 영역입니다.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/80 bg-white/78 p-4 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500">Seller Flow</div>
                    <div className="mt-2 text-sm font-bold text-slate-800">등록 · 수정 · 삭제 · 요청 관리</div>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/78 p-4 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500">Review</div>
                    <div className="mt-2 text-sm font-bold text-slate-800">관리자 심사 + 거절 사유 확인</div>
                  </div>
                </div>
              </div>

              <div className="mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-fuchsia-200/90">
                셀러 대시보드 열기 →
              </div>
            </div>
          </button>
        </section>

        {viewMode === 'home' && (
          <section className="mb-10 grid gap-6 xl:grid-cols-3">
            <div className="rounded-[30px] border border-white/80 bg-white/78 p-6 shadow-2xl shadow-violet-100/60 backdrop-blur-2xl">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-500">How it works</div>
              <div className="mt-4 space-y-4">
                <div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 font-black text-violet-700">1</span><div><div className="font-bold text-slate-900">상품 등록</div><div className="text-sm text-slate-600">판매자는 상품 정보와 이미지를 등록합니다.</div></div></div>
                <div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 font-black text-sky-700">2</span><div><div className="font-bold text-slate-900">관리자 검토</div><div className="text-sm text-slate-600">승인 후 구매 목록에 노출됩니다.</div></div></div>
                <div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-fuchsia-100 font-black text-fuchsia-700">3</span><div><div className="font-bold text-slate-900">DAO2 결제</div><div className="text-sm text-slate-600">구매자는 DAO2 기준으로 결제합니다.</div></div></div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/80 bg-white/78 p-6 shadow-2xl shadow-sky-100/60 backdrop-blur-2xl">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-500">Marketplace Snapshot</div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                  <div className="text-xs font-bold text-slate-500">Marketplace 주소</div>
                  <div className="mt-2 break-all font-mono text-xs text-slate-800">{MARKETPLACE_ADDRESS || runtimeConfig?.marketplace?.marketplace_address || '미설정'}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                  <div className="text-xs font-bold text-slate-500">플랫폼 수수료</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">
                    {!hasMarketplaceAddress ? String(runtimeConfig?.marketplace?.fee_bps ?? '-') : feeLoading ? '...' : `${String(feeBps ?? '-')} bps`}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/80 bg-white/78 p-6 shadow-2xl shadow-fuchsia-100/60 backdrop-blur-2xl">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-500">Launch Notes</div>
              <div className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
                <p>• 관리자 영역은 일반 사용자에게 숨김 처리</p>
                <p>• 프로모션 기간 동안 누구나 등록 가능</p>
                <p>• 판매자 요청 상태와 거절 사유를 UI에서 확인 가능</p>
                <p>• 검색/정렬/카테고리 구조는 구매 섹션에서 바로 연결</p>
              </div>
            </div>
          </section>
        )}
        {viewMode !== 'home' && (
          <div className="mb-6">
            <button
              onClick={() => setViewMode('home')}
              className="rounded-xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 px-5 py-2.5 text-sm font-semibold text-purple-700 transition hover:bg-purple-50"
            >
              ← 처음 화면으로 돌아가기
            </button>
          </div>
        )}

        {viewMode === 'buy' && (
          <div className="relative space-y-6 transition-all duration-500">
            {/* Premium Plus v7: BUY 영역 모션 블롭 */}
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
              <div className="pp-blob pp-blob-sky"      style={{ top: '-4rem', left: '-6rem', width: '24rem', height: '24rem' }} />
              <div className="pp-blob pp-blob-fuchsia"  style={{ top: '30%', right: '-6rem', width: '26rem', height: '26rem', animationDelay: '3s' }} />
              <div className="pp-blob pp-blob-lavender" style={{ bottom: '-4rem', left: '20%', width: '22rem', height: '22rem', animationDelay: '5s' }} />
            </div>
            <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
              <h2 className="text-3xl font-black bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">🛒 구매자 영역</h2>
              <p className="mt-3 text-sm text-slate-700">
                승인된 상품 목록과 운영 설정을 서버 API 기준으로 불러온다.
              </p>

              <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 hover:-translate-y-1 transition-all duration-300">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider">Marketplace 주소</div>
                  <div className="mt-2 break-all text-xs text-slate-800 font-mono">
                    {MARKETPLACE_ADDRESS || runtimeConfig?.marketplace?.marketplace_address || '미설정'}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 hover:-translate-y-1 transition-all duration-300">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider">💰 플랫폼 수수료</div>
                  <div className="mt-2 text-2xl font-bold bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 bg-clip-text text-transparent">
                    {!hasMarketplaceAddress
                      ? String(runtimeConfig?.marketplace?.fee_bps ?? '-')
                      : feeLoading
                      ? '...'
                      : `${String(feeBps ?? '-')} bps`}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 hover:-translate-y-1 transition-all duration-300">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider">✨ Prime 플랜</div>
                  <div className="mt-2 text-lg font-bold text-slate-900">
                    {runtimeConfig?.prime?.plan_name || '-'}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 hover:-translate-y-1 transition-all duration-300">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider">📦 구매 가능 상품</div>
                  <div className="mt-2 text-2xl font-bold bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
                    {displayableProducts.length}개
                  </div>
                </div>
              </div>
            </div>

            {/* ✨ Patch v3.1: Sky Cyber 검색/정렬 바 */}
            {displayableProducts.length > 0 && (
              <div className="rounded-3xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="relative flex-1">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-purple-500 text-lg">
                      🔍
                    </span>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="상품명, 카테고리, 판매자 주소로 검색..."
                      className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 py-3 pl-11 pr-11 text-sm"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-purple-700 hover:bg-purple-200"
                        title="검색어 지우기"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="text-sm font-semibold text-slate-800">정렬:</label>
                    <select
                      value={sortOption}
                      onChange={(e) => setSortOption(e.target.value as typeof sortOption)}
                      className="rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-2.5 text-sm cursor-pointer"
                    >
                      <option value="newest">📅 최신 등록순</option>
                      <option value="popular">🔥 인기순 (판매량)</option>
                      <option value="priceLow">💰 가격 낮은순</option>
                      <option value="priceHigh">💸 가격 높은순</option>
                      <option value="stock">📦 재고 많은순</option>
                    </select>
                  </div>
                </div>

                {searchQuery.trim() && (
                  <div className="mt-4 text-xs text-slate-700">
                    <span className="font-bold text-purple-700">&quot;{searchQuery}&quot;</span> 검색 결과: <span className="font-bold bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">{filteredBuyProducts.length}개</span>
                  </div>
                )}
              </div>
            )}

            {/* ✨ Patch v9.2: 상품 유형 탭 (4종) */}
            <div className="rounded-3xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
              <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-violet-500">상품 유형</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {([
                  { key: 'all',      label: '🗂️ 전체',     color: 'violet' },
                  { key: 'physical', label: '📦 일반상품', color: 'sky' },
                  { key: 'service',  label: '💅 서비스',    color: 'fuchsia' },
                  { key: 'food',     label: '🍱 음식',      color: 'amber' },
                  { key: 'digital',  label: '💻 디지털',    color: 'emerald' },
                ] as const).map((t) => {
                  const count =
                    t.key === 'all'
                      ? displayableProducts.length
                      : displayableProducts.filter((p) => (p.productType || 'physical') === t.key).length
                  const active = selectedProductType === t.key
                  return (
                    <button
                      key={t.key}
                      onClick={() => {
                        setSelectedProductType(t.key as typeof selectedProductType)
                        setSelectedCategory('all')
                      }}
                      className={`rounded-2xl border px-3 py-3 text-left transition ${
                        active
                          ? 'border-violet-400 bg-gradient-to-br from-violet-100 via-fuchsia-100 to-pink-100 shadow-lg shadow-fuchsia-200/60'
                          : 'border-purple-200 bg-white/80 hover:border-purple-300'
                      }`}
                    >
                      <div className="text-sm font-black text-slate-900">{t.label}</div>
                      <div className="mt-1 text-[11px] text-slate-600">{count}개</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* ✨ Patch v9.2: 카테고리 칩 – 선택된 유형의 카테고리만 표시 (categoriesByType 사용) */}
            {categoriesLoaded && (
              <div className="rounded-3xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-violet-500">카테고리</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      selectedCategory === 'all'
                        ? 'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white shadow-lg shadow-fuchsia-300/60'
                        : 'bg-white/80 border border-violet-200 text-violet-700 hover:border-violet-400'
                    }`}
                  >
                    전체
                  </button>
                  {((selectedProductType === 'all'
                      ? categoriesAll
                      : (categoriesByType[selectedProductType] || [])
                    ) as CategoryRow[]
                  ).map((c) => {
                    const count = displayableProducts.filter(
                      (p) => (p.categoryCode || p.category) === c.code,
                    ).length
                    const active = selectedCategory === c.code
                    return (
                      <button
                        key={c.code}
                        onClick={() => setSelectedCategory(c.code)}
                        className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                          active
                            ? 'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white shadow-lg shadow-fuchsia-300/60'
                            : 'bg-white/80 border border-violet-200 text-violet-700 hover:border-violet-400'
                        }`}
                      >
                        {c.emoji ? `${c.emoji} ` : ''}{c.name_ko} ({count})
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ✨ Patch v3.1: Sky Cyber 상품 목록 영역 */}
            {displayableProducts.length === 0 ? (
              <div className="rounded-3xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-10 text-center">
                <div className="text-6xl">🛒</div>
                <div className="mt-4 text-xl font-bold bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">구매 가능한 상품이 아직 없습니다</div>
                <div className="mt-2 text-sm text-slate-600">판매자가 상품을 등록하고 관리자가 승인하면 표시됩니다.</div>
              </div>
            ) : filteredBuyProducts.length === 0 ? (
              <div className="rounded-3xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-10 text-center">
                <div className="text-6xl">🔍</div>
                <div className="mt-4 text-xl font-bold bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">검색 결과가 없습니다</div>
                <div className="mt-2 text-sm text-slate-600">다른 검색어나 카테고리를 시도해보세요.</div>
                <button
                  onClick={() => { setSearchQuery(''); setSelectedCategory('all') }}
                  className="mt-5 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white shadow-lg shadow-fuchsia-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-fuchsia-300/70 transition-all duration-300 px-5 py-2.5 text-sm font-semibold"
                >
                  필터 초기화
                </button>
              </div>
            ) : selectedCategory === 'all' && !searchQuery.trim() ? (
              // 전체 + 검색 없음 → 카테고리별 그룹핑
              <div className="space-y-10">
                {Object.entries(productsByCategory).map(([cat, products]) => (
                  <div key={cat}>
                    <h3 className="mb-5 flex items-center gap-3 text-2xl font-black">
                      <span className="h-1.5 w-10 rounded-full bg-gradient-to-r from-purple-500 via-pink-500 to-blue-500"></span>
                      <span className="bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">{cat}</span>
                      <span className="text-sm font-semibold text-slate-600">({products.length}개)</span>
                    </h3>
                    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                      {products.map((item) => (
                        <ProductCard key={item.id} item={item} onBuy={handleOpenBuy} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {filteredBuyProducts.map((item) => (
                  <ProductCard key={item.id} item={item} onBuy={handleOpenBuy} />
                ))}
              </div>
            )}
          </div>
        )}

        {viewMode === 'sell' && (
          <div className="relative">
            {/* Premium Plus v7: SELL 영역 모션 블롭 */}
            <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
              <div className="pp-blob pp-blob-fuchsia"  style={{ top: '-5rem', left: '-5rem', width: '24rem', height: '24rem' }} />
              <div className="pp-blob pp-blob-lavender" style={{ top: '25%', right: '-6rem', width: '24rem', height: '24rem', animationDelay: '3s' }} />
              <div className="pp-blob pp-blob-pink"     style={{ bottom: '-4rem', left: '30%', width: '22rem', height: '22rem', animationDelay: '6s' }} />
            </div>

            {/* ✨ Patch v9.2: 판매하기 탭 바 (정리된 UI) */}
            <div className="mb-6 rounded-3xl border border-purple-300/70 bg-white/85 p-3 shadow-xl shadow-purple-200/60 backdrop-blur-2xl">
              <div className={`grid gap-2 ${isAdmin ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
                {([
                  { key: 'register', label: '➕ 상품 등록',       desc: '판매할 상품 등록 엨지' },
                  { key: 'mine',     label: '📋 내 판매 관리',    desc: '내 요청 현황/지표/지갑상태' },
                  ...(isAdmin
                    ? [{ key: 'admin', label: '👑 관리자',          desc: '심사 / 수정 / Prime / 설정' }]
                    : []),
                ] as const).map((t) => {
                  const active = sellTab === t.key
                  return (
                    <button
                      key={t.key}
                      onClick={() => setSellTab(t.key as typeof sellTab)}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        active
                          ? 'border-violet-400 bg-gradient-to-br from-violet-100 via-fuchsia-100 to-pink-100 shadow-lg shadow-fuchsia-200/60'
                          : 'border-purple-200 bg-white/80 hover:border-purple-300'
                      }`}
                    >
                      <div className="text-sm font-black text-slate-900">{t.label}</div>
                      <div className="mt-0.5 text-[11px] text-slate-600">{t.desc}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 내 판매 관리 탭: 판매자 진입 게이트 + 지표 + 내 요청 현황 */}
            <div className={`${sellTab === 'mine' ? 'block' : 'hidden'} space-y-6`}>
              <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                <h2 className="text-2xl font-semibold">판매자 진입 게이트</h2>
                <p className="mt-3 text-sm text-slate-700">
                  판매하기 클릭 시 현재 지갑의 판매 가능 여부를 canSell()로 판정
                </p>

                <div className="mt-6 space-y-4 rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 text-sm text-slate-800">
                  <div className="flex justify-between gap-4">
                    <span>연결 상태</span>
                    <span>{isConnected ? '연결됨' : '연결 안됨'}</span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span>현재 지갑</span>
                    <span className="max-w-[220px] truncate">{address ?? '-'}</span>
                  </div>

                  {/* ✨ Patch v1: 관리자 여부는 관리자에게만 노출 */}
                  {isAdmin && (
                    <div className="flex justify-between gap-4">
                      <span>관리자 여부</span>
                      <span className="text-purple-300">관리자</span>
                    </div>
                  )}

                  <div className="flex justify-between gap-4">
                    <span>판매 가능 여부</span>
                    <span>
                      {!isConnected
                        ? '-'
                        : !hasMarketplaceAddress
                        ? '개발 모드'
                        : canSellLoading
                        ? '확인 중...'
                        : canSell
                        ? '가능'
                        : '불가'}
                    </span>
                  </div>

                  {/* ✨ Patch v1: nextListingId는 관리자만 볼 필요 있음 */}
                  {isAdmin && (
                    <div className="flex justify-between gap-4">
                      <span>nextListingId</span>
                      <span>
                        {!hasMarketplaceAddress
                          ? '-'
                          : listingLoading
                          ? '불러오는 중...'
                          : String(nextListingId ?? '-')}
                      </span>
                    </div>
                  )}
                </div>

                {!isConnected && (
                  <div className="mt-6 rounded-2xl inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-300 text-amber-700 shadow-sm p-4 text-sm">
                    먼저 지갑을 연결해야 판매하기 진입 자격을 확인할 수 있다.
                  </div>
                )}

                {isConnected && hasMarketplaceAddress && canSellLoading && (
                  <div className="mt-6 rounded-2xl inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-sky-100 to-cyan-100 border border-sky-300 text-sky-700 shadow-sm p-4 text-sm">
                    판매 자격을 확인 중이다...
                  </div>
                )}

                {isConnected && hasMarketplaceAddress && !canSellLoading && !canSell && (
                  <div className="mt-6 rounded-2xl inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-300 text-amber-700 shadow-sm p-4 text-sm">
                    현재 판매 자격이 없다. 운영 승인 또는 이후 자동 자격 판정 조건을 만족해야 한다.
                  </div>
                )}

                {isConnected && hasMarketplaceAddress && !canSellLoading && canSell && (
                  <div className="mt-6 rounded-2xl inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-100 to-green-100 border border-emerald-300 text-emerald-700 shadow-sm p-4 text-sm">
                    판매 가능 지갑으로 확인되었다. 판매자 대시보드에 진입할 수 있다.
                  </div>
                )}
              </div>

              <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                <h2 className="text-2xl font-semibold">판매자 지표</h2>
                <p className="mt-3 text-sm text-slate-700">현재는 서버 API 기준으로 표시된다</p>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
                    <div className="text-sm text-slate-700">등록 상품 수</div>
                    <div className="mt-2 text-2xl font-bold">{sellerStats.total}</div>
                  </div>

                  <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
                    <div className="text-sm text-slate-700">승인 대기</div>
                    <div className="mt-2 text-2xl font-bold">{sellerStats.pending}</div>
                  </div>

                  <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
                    <div className="text-sm text-slate-700">승인됨</div>
                    <div className="mt-2 text-2xl font-bold text-emerald-300">{sellerStats.approved}</div>
                  </div>

                  <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
                    <div className="text-sm text-slate-700">거절됨</div>
                    <div className="mt-2 text-2xl font-bold text-red-300">{sellerStats.rejected}</div>
                  </div>

                  <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
                    <div className="text-sm text-slate-700">판매 수량</div>
                    <div className="mt-2 text-2xl font-bold">{sellerStats.soldCount}</div>
                  </div>

                  <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5">
                    <div className="text-sm text-slate-700">누적 수익</div>
                    <div className="mt-2 text-2xl font-bold">
                      {sellerStats.revenueDao2} DAO2
                    </div>
                  </div>
                </div>
              </div>

              {/* ✨ Patch v1: 내 등록 요청 현황 - 거절 사유 표시 포함 */}
              <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                <h2 className="text-2xl font-semibold">내 등록 요청 현황</h2>
                <p className="mt-3 text-sm text-slate-700">
                  내가 올린 상품 요청의 상태를 확인하는 영역
                </p>

                <div className="mt-6 space-y-3">
                  {loading ? (
                    <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-4 text-sm text-slate-700">
                      목록을 불러오는 중이다.
                    </div>
                  ) : sellerRequests.length === 0 ? (
                    <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-4 text-sm text-slate-700">
                      아직 등록 요청이 없다.
                    </div>
                  ) : (
                    sellerRequests.map((request) => (
                      <div
                        key={request.id}
                        className={`rounded-2xl border p-4 ${
                          request.status === 'Rejected'
                            ? 'border-red-500/40 bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-500/40/5'
                            : request.status === 'Approved'
                            ? 'border-green-500/30 bg-gradient-to-r from-cyan-400 to-blue-400 shadow-md shadow-cyan-500/40/5'
                            : request.status === 'Pending'
                            ? 'border-yellow-500/30 bg-yellow-500/5'
                            : 'border-purple-200/50 bg-white/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-sm text-slate-700">{request.category}</div>
                            <div className="mt-1 text-lg font-bold text-slate-900">
                              {request.title}
                            </div>
                          </div>
                          <div
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                              request.status === 'Rejected'
                                ? 'border-red-500/40 bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-500/40/10 text-red-300'
                                : request.status === 'Approved'
                                ? 'border-green-500/30 bg-gradient-to-r from-cyan-400 to-blue-400 shadow-md shadow-cyan-500/40/10 text-emerald-300'
                                : request.status === 'Pending'
                                ? 'border-yellow-500/30 bg-yellow-500/10 text-amber-300'
                                : 'border-white/10 text-slate-800'
                            }`}
                          >
                            {request.status}
                          </div>
                        </div>

                        <div className="mt-3 text-sm text-slate-700">
                          가격 {request.priceUsdt} USDT / 재고 {request.stock}개
                        </div>

                        <div className="mt-2 text-xs text-slate-600">
                          요청 시각: {request.createdAt || '-'}
                        </div>

                        {/* ✨ Patch v1: 거절 사유 표시 */}
                        {request.status === 'Rejected' && request.rejectionReason && (
                          <div className="mt-4 rounded-xl border border-red-500/30 bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-500/40/10 p-4">
                            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-red-300">
                              <span>⚠️</span>
                              <span>거절 사유 (관리자 메시지)</span>
                            </div>
                            <div className="text-sm leading-6 text-red-100">
                              {request.rejectionReason}
                            </div>
                            {request.rejectedAt && (
                              <div className="mt-2 text-xs text-red-300/70">
                                거절 시각: {new Date(request.rejectedAt).toLocaleString('ko-KR')}
                              </div>
                            )}
                            <div className="mt-3 text-xs text-slate-700">
                              💡 사유를 확인한 뒤 아래 수정 버튼을 눌러 수정 후 재등록하세요.
                            </div>
                          </div>
                        )}

                        {/* ✨ Patch v2.2: 판매자 수정/삭제 버튼 (Pending/Rejected에서만) */}
                        {(request.status === 'Pending' || request.status === 'Rejected') && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              onClick={() => openSellerEditModal(request)}
                              disabled={actionLoading}
                              className="rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg shadow-sky-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-sky-300/70 transition-all duration-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                            >
                              ✏️ 수정
                            </button>
                            <button
                              onClick={() => handleSellerDeleteProduct(request.id, request.title)}
                              disabled={actionLoading}
                              className="rounded-xl bg-gradient-to-r from-red-500 to-pink-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-600 hover:to-pink-600 disabled:opacity-50 transition"
                            >
                              🗑️ 삭제
                            </button>
                            {request.status === 'Rejected' && (
                              <span className="self-center text-xs text-slate-600">
                                수정하면 Pending으로 돌아갑니다
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* 상품 등록 탭 */}
            <div className={`${sellTab === 'register' ? 'block' : 'hidden'} space-y-6`}>
              <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                <h2 className="text-2xl font-semibold">상품 등록 양식</h2>
                <p className="mt-3 text-sm text-slate-700">
                  판매자가 관리자 승인을 요청하기 전에 작성하는 등록 양식
                </p>

                <div className="mt-6 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm text-slate-800">상품명</label>
                    <input
                      value={productTitle}
                      onChange={(e) => setProductTitle(e.target.value)}
                      placeholder="예: WebKey 공식 후드티"
                      className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-slate-800">상품 설명</label>
                    <textarea
                      value={productDescription}
                      onChange={(e) => setProductDescription(e.target.value)}
                      placeholder="상품 설명, 규격, 배송 정보, 주의사항 등을 입력"
                      rows={5}
                      className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                    />
                  </div>

                  {/* ✨ Patch v9.0: 상품 유형 선택 (4종 탭) */}
                  <div>
                    <label className="mb-2 block text-sm text-slate-800">상품 유형</label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {([
                        { key: 'physical', label: '📦 일반상품', desc: '업·신발·잡화 등' },
                        { key: 'service',  label: '💅 서비스예약', desc: '시술·코칭 등' },
                        { key: 'food',     label: '🍱 음식매장', desc: '식당·카페 등' },
                        { key: 'digital',  label: '💻 디지털',   desc: '쿠폰·코드 등' },
                      ] as const).map((t) => (
                        <button
                          type="button"
                          key={t.key}
                          onClick={() => {
                            setProductType(t.key)
                            // 선택한 유형에 속하는 카테고리가 아니면 초기화
                            const firstCat = categoriesByType[t.key]?.[0]
                            if (firstCat) setCategory(firstCat.code)
                            else setCategory('')
                          }}
                          className={`rounded-2xl border px-3 py-3 text-left transition ${
                            productType === t.key
                              ? 'border-violet-400 bg-gradient-to-br from-violet-100 via-fuchsia-100 to-pink-100 shadow-lg shadow-fuchsia-200/60'
                              : 'border-purple-200 bg-white/80 hover:border-purple-300'
                          }`}
                        >
                          <div className="text-sm font-black text-slate-900">{t.label}</div>
                          <div className="mt-1 text-[11px] text-slate-600">{t.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* ✨ Patch v11.1: 카테고리 드롭다운 + 진단 메시지 */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm text-slate-800">카테고리</label>
                      <button
                        type="button"
                        onClick={() => loadCategories()}
                        className="rounded-md bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 hover:bg-violet-200"
                        title="카테고리 다시 불러오기"
                      >
                        🔄 새로고침
                      </button>
                    </div>
                    {!categoriesLoaded ? (
                      <div className="pp-skeleton h-12 w-full" />
                    ) : (
                      <>
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                        >
                          <option value="">카테고리 선택 ({(categoriesByType[productType] || []).length}개 가능)</option>
                          {(categoriesByType[productType] || []).map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.emoji ? `${c.emoji} ` : ''}{c.name_ko}
                            </option>
                          ))}
                        </select>
                        {(categoriesByType[productType] || []).length === 0 && (
                          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                            ⚠️ 선택한 유형(<b>{productType}</b>)에 등록된 카테고리가 없습니다. 다른 유형으로 바꾸거나 관리자에게 카테고리 추가를 요청하세요.
                          </div>
                        )}
                      </>
                    )}
                    <p className="mt-2 text-[11px] text-slate-500">
                      카테고리 목록은 관리자가 Supabase에서 관리합니다.
                    </p>
                    {categoriesDebug && (
                      <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                        🔎 진단: {categoriesDebug}
                      </div>
                    )}
                  </div>

                  {/* ✨ Patch v9.0: 유형별 추가 필드 */}
                  {productType === 'physical' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">사이즈</label>
                        <input
                          value={extraSize}
                          onChange={(e) => setExtraSize(e.target.value)}
                          placeholder="예: M / L / 270mm / Free"
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">색상</label>
                        <input
                          value={extraColor}
                          onChange={(e) => setExtraColor(e.target.value)}
                          placeholder="예: 백색 / 검정 / 베이지"
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {productType === 'service' && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">소요 시간 (분)</label>
                        <input
                          type="number"
                          value={extraDurationMinutes}
                          onChange={(e) => setExtraDurationMinutes(e.target.value)}
                          placeholder="예: 60"
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">예약 필요 여부</label>
                        <div className="flex items-center gap-2 rounded-xl border border-purple-200/80 bg-white/90 px-4 py-3">
                          <input
                            id="reservationRequired"
                            type="checkbox"
                            checked={extraReservationRequired}
                            onChange={(e) => setExtraReservationRequired(e.target.checked)}
                            className="h-4 w-4 accent-fuchsia-500"
                          />
                          <label htmlFor="reservationRequired" className="text-sm text-slate-800 cursor-pointer">
                            예약이 필요한 서비스입니다
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {productType === 'food' && (
                    <div className="grid gap-4">
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">매장 주소</label>
                        <input
                          value={extraShopAddress}
                          onChange={(e) => setExtraShopAddress(e.target.value)}
                          placeholder="예: 서울시 강남구 논현로 12"
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">영업시간</label>
                        <input
                          value={extraOpenHours}
                          onChange={(e) => setExtraOpenHours(e.target.value)}
                          placeholder="예: 평일 11:00 - 22:00 / 주말 휴무"
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                        />
                      </div>
                    </div>
                  )}

                  {productType === 'digital' && (
                    <div>
                      <label className="mb-2 block text-sm text-slate-800">전달 방식</label>
                      <select
                        value={extraDeliveryMethod}
                        onChange={(e) => setExtraDeliveryMethod(e.target.value)}
                        className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                      >
                        <option value="email">이메일로 전달</option>
                        <option value="messenger">카카오톡/매센저</option>
                        <option value="download">다운로드 링크</option>
                        <option value="code">코드 직접 발급</option>
                      </select>
                    </div>
                  )}

                  {/* ✨ Patch v11.0: 옵션 조합 에디터 */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-sm text-slate-800">
                        옵션 조합 (선택) <span className="text-xs text-slate-600">– 각 조합별 재고 관리</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          // 유형별 기본 옵션 키
                          const defaultKeys: Record<string, string[]> = {
                            physical: ['size', 'color'],
                            service: ['date', 'time'],
                            food: ['method', 'time_slot'],
                            digital: ['delivery', 'target'],
                          }
                          const keys = defaultKeys[productType] || ['option1']
                          const emptyOpts: Record<string, string> = {}
                          keys.forEach((k) => (emptyOpts[k] = ''))
                          setDraftVariants((prev) => [
                            ...prev,
                            {
                              key: `v-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                              options: emptyOpts,
                              stock: '0',
                              price_delta: '0',
                              sku: '',
                            },
                          ])
                        }}
                        className="rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-500 px-3 py-1 text-xs font-bold text-white shadow"
                      >
                        ➕ 옵션 추가
                      </button>
                    </div>

                    {draftVariants.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-purple-300 bg-purple-50/40 p-4 text-center text-xs text-slate-600">
                        옵션 조합이 없으면 단일 상품으로 등록됩니다.<br />
                        사이즈/색상/날짜 등을 구분하려면 &ldquo;옵션 추가&rdquo; 클릭.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {draftVariants.map((dv, idx) => {
                          const keys = Object.keys(dv.options)
                          return (
                            <div key={dv.key} className="rounded-xl border border-purple-200 bg-white/90 p-3">
                              <div className="mb-2 flex items-center justify-between">
                                <span className="text-xs font-bold text-violet-600">조합 #{idx + 1}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDraftVariants((prev) => prev.filter((_, i) => i !== idx))
                                  }
                                  className="rounded-md bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 hover:bg-rose-200"
                                >
                                  삭제
                                </button>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {keys.map((k) => (
                                  <div key={k}>
                                    <label className="mb-1 block text-[11px] font-bold text-slate-600">{k}</label>
                                    <input
                                      value={dv.options[k]}
                                      onChange={(e) => {
                                        const val = e.target.value
                                        setDraftVariants((prev) => {
                                          const next = [...prev]
                                          next[idx] = {
                                            ...next[idx],
                                            options: { ...next[idx].options, [k]: val },
                                          }
                                          return next
                                        })
                                      }}
                                      placeholder={
                                        k === 'size' ? '예: M / L / 270mm'
                                        : k === 'color' ? '예: 검정 / 흰색'
                                        : k === 'date' ? 'YYYY-MM-DD'
                                        : k === 'time' ? 'HH:MM'
                                        : k === 'method' ? 'pickup / delivery'
                                        : k === 'time_slot' ? '예: 12:00-13:00'
                                        : k === 'delivery' ? 'email / messenger'
                                        : k === 'target' ? '수신장소'
                                        : ''
                                      }
                                      className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs text-slate-800"
                                    />
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                                <div>
                                  <label className="mb-1 block text-[11px] font-bold text-slate-600">재고</label>
                                  <input
                                    type="number"
                                    min={0}
                                    value={dv.stock}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      setDraftVariants((prev) => {
                                        const next = [...prev]
                                        next[idx] = { ...next[idx], stock: val }
                                        return next
                                      })
                                    }}
                                    className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs text-slate-800"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[11px] font-bold text-slate-600">가격 차이 (USDT)</label>
                                  <input
                                    type="number"
                                    value={dv.price_delta}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      setDraftVariants((prev) => {
                                        const next = [...prev]
                                        next[idx] = { ...next[idx], price_delta: val }
                                        return next
                                      })
                                    }}
                                    placeholder="0 또는 +3.5"
                                    className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs text-slate-800"
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[11px] font-bold text-slate-600">SKU (선택)</label>
                                  <input
                                    value={dv.sku}
                                    onChange={(e) => {
                                      const val = e.target.value
                                      setDraftVariants((prev) => {
                                        const next = [...prev]
                                        next[idx] = { ...next[idx], sku: val }
                                        return next
                                      })
                                    }}
                                    placeholder="선택"
                                    className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs text-slate-800"
                                  />
                                </div>
                              </div>
                            </div>
                          )
                        })}
                        <div className="rounded-lg bg-violet-50 p-2 text-[11px] text-violet-700">
                          ▸ 총 재고: <b>{draftVariants.reduce((s, v) => s + Number(v.stock || 0), 0)}</b>개 (아래 ‘재고 수량’ 필드를 자동으로 덮어씁니다)
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-slate-800">Metadata URI</label>
                    <input
                      value={metadataUri}
                      onChange={(e) => setMetadataUri(e.target.value)}
                      placeholder="IPFS 또는 외부 메타데이터 주소"
                      className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-sm text-slate-800">USDT 기준 가격</label>
                      <input
                        value={priceUsdt}
                        onChange={(e) => setPriceUsdt(e.target.value)}
                        placeholder="예: 25"
                        className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                      />
                    </div>

                    <div>
                      <label className="mb-2 block text-sm text-slate-800">재고 수량</label>
                      <input
                        value={stock}
                        onChange={(e) => setStock(e.target.value)}
                        placeholder="예: 100"
                        className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                      />
                    </div>
                  </div>

                  {/* ✨ Patch v2.2: 이미지 업로드 영역 */}
                  <div>
                    <label className="mb-2 block text-sm text-slate-800">
                      상품 대표 이미지 <span className="text-xs text-slate-600">(선택, 최대 5MB)</span>
                    </label>
                    {productImageUrl ? (
                      <div className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={productImageUrl}
                          alt="preview"
                          className="h-48 w-full rounded-xl border border-white/10 object-cover"
                        />
                        <button
                          onClick={() => setProductImageUrl('')}
                          className="absolute right-2 top-2 rounded-full bg-gradient-to-r from-pink-600 to-rose-500 shadow-md shadow-pink-500/40 px-3 py-1 text-xs font-bold text-white hover:bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-500/40"
                        >
                          × 지우기
                        </button>
                      </div>
                    ) : (
                      <label className="flex h-32 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-purple-300 bg-purple-50/50 text-sm text-slate-700 transition hover:border-purple-500 hover:bg-purple-100/50 hover:text-purple-700">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleImageUpload(file, 'register')
                          }}
                          disabled={uploadingImage}
                          className="hidden"
                        />
                        {uploadingImage ? (
                          <span>업로드 중...</span>
                        ) : (
                          <div className="text-center">
                            <div className="text-2xl">📸</div>
                            <div className="mt-2">클릭하여 이미지 선택</div>
                            <div className="mt-1 text-xs text-slate-600">JPG, PNG, WebP, GIF</div>
                          </div>
                        )}
                      </label>
                    )}
                  </div>
                </div>

                {!isConnected ? (
                  <div className="mt-6 rounded-2xl inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-300 text-amber-700 shadow-sm p-4 text-sm">
                    지갑 연결 후 등록 요청 작성이 가능하다.
                  </div>
                ) : !canSubmitRequest ? (
                  <div className="mt-6 rounded-2xl inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-100 to-orange-100 border border-amber-300 text-amber-700 shadow-sm p-4 text-sm">
                    필수 항목을 모두 입력하고 판매 가능 조건을 만족해야 등록 요청 제출이 가능하다.
                  </div>
                ) : promotionActive ? (
                  <div className="mt-6 rounded-2xl border border-green-500/30 bg-gradient-to-r from-green-500/10 to-emerald-500/10 p-4 text-sm text-green-200">
                    🎉 프로모션 모드: 누구나 등록할 수 있습니다. 관리자 심사 후 공개됩니다.
                  </div>
                ) : (
                  <div className="mt-6 rounded-2xl inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-100 to-green-100 border border-emerald-300 text-emerald-700 shadow-sm p-4 text-sm">
                    등록 요청 제출이 가능한 상태다.
                  </div>
                )}

                <div className="mt-6">
                  <button
                    onClick={handleSubmitRequest}
                    disabled={!canSubmitRequest || actionLoading}
                    className="rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 text-white shadow-lg shadow-fuchsia-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-fuchsia-300/70 transition-all duration-300 px-5 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {actionLoading ? '처리 중...' : '등록 요청 제출'}
                  </button>
                </div>
              </div>
            </div>

            {/* ✨ Patch v1: 관리자 영역 - 관리자 지갑만 볼 수 있음 */}
            {isAdmin && (
              <div className={`${sellTab === 'admin' ? 'block' : 'hidden'} space-y-6`}>
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8 border-l-4 border-purple-500">
                  <div className="mb-4 inline-block rounded-full border border-purple-500/40 bg-gradient-to-r from-purple-500 to-pink-400 shadow-md shadow-purple-500/40/20 px-3 py-1 text-xs font-bold text-purple-200">
                    👑 ADMIN ONLY
                  </div>
                  <h2 className="text-2xl font-semibold">관리자 검토 목록</h2>
                  <p className="mt-3 text-sm text-slate-700">
                    판매자가 올린 요청을 상태별로 검토/승인/거절/일시정지 처리
                  </p>

                  {/* ✨ Patch v1: 상태 필터 탭 */}
                  <div className="mt-6 flex flex-wrap gap-2">
                    {(['Pending', 'Approved', 'Rejected', 'Paused', 'All'] as const).map((filter) => (
                      <button
                        key={filter}
                        onClick={() => setAdminStatusFilter(filter)}
                        className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                          adminStatusFilter === filter
                            ? filter === 'Pending'
                              ? 'bg-yellow-600 text-white'
                              : filter === 'Approved'
                              ? 'bg-gradient-to-r from-cyan-500 to-blue-500 shadow-md shadow-cyan-500/40 text-white'
                              : filter === 'Rejected'
                              ? 'bg-gradient-to-r from-pink-600 to-rose-500 shadow-md shadow-pink-500/40 text-white'
                              : filter === 'Paused'
                              ? 'bg-zinc-600 text-white'
                              : 'bg-gradient-to-r from-purple-600 to-pink-500 shadow-lg shadow-purple-500/50 text-white'
                            : 'inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-100 to-fuchsia-100 border border-violet-300 text-violet-700 shadow-sm hover:shadow-md'
                        }`}
                      >
                        {filter} ({adminStatusCounts[filter] || 0})
                      </button>
                    ))}
                  </div>

                  <div className="mt-6 space-y-4">
                    {loading ? (
                      <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-4 text-sm text-slate-700">
                        요청 목록을 불러오는 중이다.
                      </div>
                    ) : filteredAdminRequests.length === 0 ? (
                      <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-4 text-sm text-slate-700">
                        해당 상태의 요청이 없다.
                      </div>
                    ) : (
                      filteredAdminRequests.map((request) => (
                        <div
                          key={request.id}
                          className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="text-sm text-slate-700">{request.category}</div>
                              <div className="mt-1 text-lg font-bold text-slate-900">
                                {request.title}
                              </div>
                            </div>
                            <div
                              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                                request.status === 'Rejected'
                                  ? 'border-red-500/40 bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-500/40/10 text-red-300'
                                  : request.status === 'Approved'
                                  ? 'border-green-500/30 bg-gradient-to-r from-cyan-400 to-blue-400 shadow-md shadow-cyan-500/40/10 text-emerald-300'
                                  : request.status === 'Pending'
                                  ? 'border-yellow-500/30 bg-yellow-500/10 text-amber-300'
                                  : 'border-white/10 text-slate-800'
                              }`}
                            >
                              {request.status}
                            </div>
                          </div>

                          <div className="mt-4 space-y-2 text-sm text-slate-700">
                            <div className="truncate">판매자: {request.seller || '-'}</div>
                            <div>가격: {request.priceUsdt} USDT</div>
                            <div>재고: {request.stock}개</div>
                            <div>요청 시각: {request.createdAt || '-'}</div>
                          </div>

                          <div className="mt-4 rounded-xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-4 text-sm text-slate-800">
                            {request.description}
                          </div>

                          {/* ✨ Patch v1: 거절 상품이면 사유 표시 */}
                          {request.status === 'Rejected' && request.rejectionReason && (
                            <div className="mt-4 rounded-xl border border-red-500/30 bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-500/40/10 p-4">
                              <div className="mb-1 text-xs font-bold text-red-300">거절 사유</div>
                              <div className="text-sm text-red-100">{request.rejectionReason}</div>
                            </div>
                          )}

                          <div className="mt-4 flex flex-wrap gap-2">
                            <button
                              onClick={() => loadRequestIntoEditor(request)}
                              disabled={actionLoading}
                              className="rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg shadow-sky-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-sky-300/70 transition-all duration-300 px-3 py-2 text-xs font-semibold disabled:opacity-50"
                            >
                              편집
                            </button>
                            <button
                              onClick={() =>
                                handleUpdateRequestStatus(request.id, 'Approved', request.status)
                              }
                              disabled={actionLoading}
                              className="rounded-xl bg-gradient-to-r from-green-500 to-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:from-green-600 hover:to-emerald-600 disabled:opacity-50 transition"
                            >
                              승인
                            </button>

                            {/* ✨ Patch v1: 거절 버튼 - 모달 오픈 */}
                            <button
                              onClick={() => openRejectModal(request.id, request.status)}
                              disabled={actionLoading}
                              className="rounded-xl bg-gradient-to-r from-red-500 to-pink-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-600 hover:to-pink-600 disabled:opacity-50 transition"
                            >
                              거절
                            </button>

                            <button
                              onClick={() =>
                                handleUpdateRequestStatus(request.id, 'Paused', request.status)
                              }
                              disabled={actionLoading}
                              className="rounded-xl bg-white/50 backdrop-blur-sm0 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-500/90 disabled:opacity-50 transition"
                            >
                              일시정지
                            </button>

                            <button
                              onClick={() =>
                                handleUpdateRequestStatus(request.id, 'Pending', request.status)
                              }
                              disabled={actionLoading}
                              className="rounded-xl bg-gradient-to-r from-yellow-500 to-orange-500 px-3 py-2 text-xs font-semibold text-white hover:from-yellow-600 hover:to-orange-600 disabled:opacity-50 transition"
                            >
                              Pending
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 관리자 상품 수정 / 삭제 */}
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                  <h2 className="text-2xl font-semibold">관리자 상품 수정 / 삭제</h2>
                  <p className="mt-3 text-sm text-slate-700">검토 목록에서 불러온 상품을 수정하거나 삭제하는 영역</p>
                  <div className="mt-6 space-y-4">
                    <input value={editProductId} onChange={(e) => setEditProductId(e.target.value)} placeholder="Product ID" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="상품명" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="설명" rows={3} className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} placeholder="카테고리" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={editPriceUsdt} onChange={(e) => setEditPriceUsdt(e.target.value)} placeholder="USDT 가격" className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600" />
                      <input value={editStock} onChange={(e) => setEditStock(e.target.value)} placeholder="재고" className="rounded-xl border border-white/10 bg-zinc-950 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600" />
                    </div>
                    <input value={editImageUrl} onChange={(e) => setEditImageUrl(e.target.value)} placeholder="이미지 URL" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={deleteStoragePath} onChange={(e) => setDeleteStoragePath(e.target.value)} placeholder="Storage Path (삭제용)" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={handleSaveProduct} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg shadow-sky-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-sky-300/70 transition-all duration-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">수정 저장</button>
                    <button onClick={handleDeleteProductImage} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white hover:from-orange-600 hover:to-pink-600 disabled:opacity-50 transition shadow-md">대표 이미지 삭제</button>
                    <button onClick={handleDeleteProduct} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-red-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white hover:from-red-600 hover:to-pink-600 disabled:opacity-50 transition shadow-md">상품 삭제</button>
                  </div>
                </div>

                {/* Prime 정책 저장 */}
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                  <h2 className="text-2xl font-semibold">Prime 정책 저장</h2>
                  <p className="mt-3 text-sm text-slate-700">운영용 Prime 정책을 DB에 저장하는 영역</p>
                  <div className="mt-6 space-y-3">
                    <input value={primePlanName} onChange={(e) => setPrimePlanName(e.target.value)} placeholder="플랜 이름" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={primeMonthlyPriceUsdt} onChange={(e) => setPrimeMonthlyPriceUsdt(e.target.value)} placeholder="월 요금 USDT" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={primeDao2PassRequirement} onChange={(e) => setPrimeDao2PassRequirement(e.target.value)} placeholder="DAO2 Pass 요건" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <textarea value={primeBenefitSummary} onChange={(e) => setPrimeBenefitSummary(e.target.value)} placeholder="혜택 요약" rows={3} className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <textarea value={primePolicyMemo} onChange={(e) => setPrimePolicyMemo(e.target.value)} placeholder="정책 메모" rows={4} className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={handleSavePrimeSettings} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-lg shadow-pink-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-pink-300/70 transition-all duration-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Prime 정책 저장</button>
                  </div>
                </div>

                {/* Marketplace 설정 저장 */}
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                  <h2 className="text-2xl font-semibold">Marketplace 설정 저장</h2>
                  <p className="mt-3 text-sm text-slate-700">컨트랙트 주소, 수수료, 운영 지갑 등 설정 저장</p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <input value={marketplaceAddressInput} onChange={(e) => setMarketplaceAddressInput(e.target.value)} placeholder="Marketplace 주소" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={dao2TokenAddress} onChange={(e) => setDao2TokenAddress(e.target.value)} placeholder="DAO2 토큰 주소" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={configAdminWallet} onChange={(e) => setConfigAdminWallet(e.target.value)} placeholder="관리자 지갑" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={treasuryWallet} onChange={(e) => setTreasuryWallet(e.target.value)} placeholder="Treasury 지갑" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={configFeeBps} onChange={(e) => setConfigFeeBps(e.target.value)} placeholder="수수료 bps" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={dao2PriceUsdt6} onChange={(e) => setDao2PriceUsdt6(e.target.value)} placeholder="DAO2 가격(usdt6)" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={storageMode} onChange={(e) => setStorageMode(e.target.value)} placeholder="storage mode" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={settingsNotes} onChange={(e) => setSettingsNotes(e.target.value)} placeholder="운영 메모" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={handleSaveMarketplaceSettings} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 transition shadow-md">Marketplace 설정 저장</button>
                  </div>
                </div>

                {/* 판매자 프로필 동기화 */}
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                  <h2 className="text-2xl font-semibold">판매자 프로필 동기화 / 운영 로그</h2>
                  <p className="mt-3 text-sm text-slate-700">JSON 배열을 붙여넣어 seller_profiles에 upsert</p>
                  <div className="mt-6 space-y-4">
                    <textarea value={sellerProfilesJson} onChange={(e) => setSellerProfilesJson(e.target.value)} rows={10} className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={handleSyncSellerProfiles} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white hover:from-orange-600 hover:to-pink-600 disabled:opacity-50 transition shadow-md">판매자 프로필 동기화</button>
                    <button onClick={() => handleMaintenanceAction('operation_health_check')} disabled={actionLoading} className="rounded-xl bg-white/50 backdrop-blur-sm0 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500/90 disabled:opacity-50 transition shadow-sm">운영 상태 점검 로그</button>
                    <button onClick={() => handleMaintenanceAction('backup_snapshot_create')} disabled={actionLoading} className="rounded-xl bg-white/50 backdrop-blur-sm0 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-500/90 disabled:opacity-50 transition shadow-sm">DB 백업 스냅샷 로그</button>
                  </div>
                </div>
              </div>
            )}

            {/* ✨ Patch v1: 관리자가 아닐 경우, 빈 공간 채우기 - 판매자 가이드 */}
            {!isAdmin && (
              <div className="space-y-6 xl:col-span-1">
                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-blue-900/20 to-zinc-900/70 p-8 backdrop-blur">
                  <h2 className="text-2xl font-semibold">판매자 가이드</h2>
                  <p className="mt-3 text-sm text-slate-700">
                    WebKey DAO2 Marketplace에서 상품을 판매하는 전체 플로우
                  </p>

                  <ol className="mt-6 space-y-4">
                    <li className="flex gap-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-pink-400 shadow-md shadow-purple-500/40/20 text-sm font-bold text-cyan-300">
                        1
                      </span>
                      <div>
                        <div className="font-semibold text-white">지갑 연결 & 자격 확인</div>
                        <div className="mt-1 text-sm text-slate-700">
                          TokenPocket / MetaMask로 BSC Mainnet에 연결. canSell() 자격 확인
                        </div>
                      </div>
                    </li>

                    <li className="flex gap-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-pink-400 shadow-md shadow-purple-500/40/20 text-sm font-bold text-cyan-300">
                        2
                      </span>
                      <div>
                        <div className="font-semibold text-white">상품 등록 요청</div>
                        <div className="mt-1 text-sm text-slate-700">
                          좌측 등록 양식에 상품 정보 입력 후 "등록 요청 제출"
                        </div>
                      </div>
                    </li>

                    <li className="flex gap-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-sm font-bold text-amber-300">
                        3
                      </span>
                      <div>
                        <div className="font-semibold text-white">관리자 승인 대기</div>
                        <div className="mt-1 text-sm text-slate-700">
                          관리자가 요청을 검토하고 Approved / Rejected 결정
                        </div>
                      </div>
                    </li>

                    <li className="flex gap-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-cyan-400 to-blue-400 shadow-md shadow-cyan-500/40/20 text-sm font-bold text-emerald-300">
                        4
                      </span>
                      <div>
                        <div className="font-semibold text-white">판매 & 정산</div>
                        <div className="mt-1 text-sm text-slate-700">
                          승인 시 구매하기 목록에 노출. 구매 즉시 DAO2 자동 지급 (7% 수수료 차감)
                        </div>
                      </div>
                    </li>
                  </ol>

                  <div className="mt-8 rounded-2xl border border-yellow-500/30 bg-yellow-500/10 p-4 text-xs text-yellow-200">
                    💡 거절된 경우 왼쪽 "내 등록 요청 현황"에서 거절 사유를 확인할 수 있습니다.
                    사유 반영 후 재등록 요청하세요.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
        
        <style jsx global>{`
          .sky-glass {
            background: rgba(255, 255, 255, 0.78);
            backdrop-filter: blur(16px) saturate(180%);
            -webkit-backdrop-filter: blur(16px) saturate(180%);
            border: 1px solid rgba(196, 181, 253, 0.8);
            box-shadow: 0 16px 40px rgba(168, 85, 247, 0.16), inset 0 1px 0 rgba(255,255,255,0.7);
          }
          .sky-glass-strong {
            background: rgba(255, 255, 255, 0.86);
            backdrop-filter: blur(20px) saturate(190%);
            -webkit-backdrop-filter: blur(20px) saturate(190%);
            border: 1px solid rgba(167, 139, 250, 0.75);
            box-shadow: 0 20px 55px rgba(168, 85, 247, 0.2), inset 0 1px 0 rgba(255,255,255,0.75);
          }
          .sky-hover-glow:hover {
            border-color: rgba(217, 70, 239, 0.75) !important;
            box-shadow: 0 24px 60px rgba(168, 85, 247, 0.24), 0 0 40px rgba(244, 114, 182, 0.18) !important;
            transform: translateY(-4px);
          }
          .sky-card-lift:hover { transform: translateY(-4px); }
          .sky-text-gradient {
            background: linear-gradient(90deg, #0284c7 0%, #7c3aed 52%, #d946ef 100%);
            -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent;
          }
          .sky-text-gradient-purple {
            background: linear-gradient(90deg, #6d28d9 0%, #c026d3 55%, #ec4899 100%);
            -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent;
          }
          .sky-hero-title {
            background: linear-gradient(90deg, #5b21b6 0%, #9333ea 55%, #db2777 100%);
            -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent;
            filter: drop-shadow(0 6px 14px rgba(168,85,247,0.18));
          }
          .sky-btn-primary {
            background: linear-gradient(90deg, #7c3aed 0%, #c026d3 55%, #ec4899 100%); color: #fff;
            box-shadow: 0 12px 28px rgba(192,38,211,0.28);
          }
          .sky-btn-sky {
            background: linear-gradient(90deg, #0ea5e9 0%, #06b6d4 100%); color: #fff;
            box-shadow: 0 12px 28px rgba(14,165,233,0.28);
          }
          .sky-btn-pink {
            background: linear-gradient(90deg, #ec4899 0%, #f43f5e 100%); color: #fff;
            box-shadow: 0 12px 28px rgba(236,72,153,0.28);
          }
          .sky-badge-purple {
            background: linear-gradient(90deg, rgba(237,233,254,0.95), rgba(250,232,255,0.95));
            border: 1px solid rgba(167,139,250,0.7); color: #6d28d9;
          }
          .sky-badge-sky {
            background: linear-gradient(90deg, rgba(224,242,254,0.95), rgba(236,254,255,0.95));
            border: 1px solid rgba(125,211,252,0.8); color: #0369a1;
          }
          .sky-badge-success {
            background: linear-gradient(90deg, rgba(220,252,231,0.95), rgba(240,253,244,0.95));
            border: 1px solid rgba(110,231,183,0.8); color: #047857;
          }
          .sky-badge-warning {
            background: linear-gradient(90deg, rgba(254,243,199,0.95), rgba(255,237,213,0.95));
            border: 1px solid rgba(252,211,77,0.85); color: #b45309;
          }
          .sky-input {
            background: rgba(255,255,255,0.9); border: 1px solid rgba(196,181,253,0.85); color: #1e293b;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
          }
          .sky-input:focus {
            border-color: #d946ef !important;
            box-shadow: 0 0 0 4px rgba(217,70,239,0.14), 0 8px 24px rgba(168,85,247,0.16);
          }
          .sky-promo-banner {
            background: linear-gradient(90deg, rgba(254,243,199,0.92), rgba(255,237,213,0.88), rgba(252,231,243,0.92));
            border: 1px solid rgba(252,211,77,0.65);
            box-shadow: 0 10px 30px rgba(251,191,36,0.14);
          }
          .sky-fade-in { animation: skyFadeIn .45s ease-out both; }
          @keyframes skyFadeIn { from { opacity: 0; transform: translateY(10px);} to { opacity: 1; transform: translateY(0);} }
        `}</style>
          </div>

      {/* ✨ Patch v8: 구매 모달 */}
      {buyingItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(8px)' }}
          onClick={closeBuyModal}
        >
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-[32px] border border-purple-300/70 bg-white/95 p-7 shadow-2xl shadow-purple-300/50"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pointer-events-none absolute -right-14 -top-14 h-48 w-48 rounded-full bg-fuchsia-300/30 blur-3xl" />
            <div className="pointer-events-none absolute -left-12 bottom-0 h-44 w-44 rounded-full bg-sky-300/25 blur-3xl" />

            <div className="relative z-10">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-500">Purchase</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{buyingItem.title}</div>
                  <div className="mt-1 text-sm text-slate-600">{buyingItem.category || '기타'}</div>
                </div>
                <button
                  onClick={closeBuyModal}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-slate-200"
                >
                  ✕
                </button>
              </div>

              {/* ✨ Patch v11.0: 옵션 선택 (variant) */}
              {buyingVariantsLoading ? (
                <div className="mt-5 pp-skeleton h-16 w-full" />
              ) : buyingVariants.length > 0 ? (
                <div className="mt-5 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-4">
                  <div className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-violet-600">옵션 선택</div>
                  <div className="grid gap-2">
                    {buyingVariants.map((v) => {
                      const optionLabel = Object.entries(v.options || {})
                        .map(([k, val]) => `${k}: ${String(val)}`)
                        .join(' / ')
                      const available = v.available
                      const disabled = available <= 0
                      const active = selectedVariantId === v.id
                      const deltaPositive = v.price_usdt_delta > 0
                      const deltaNegative = v.price_usdt_delta < 0
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => !disabled && setSelectedVariantId(v.id)}
                          disabled={disabled}
                          className={`rounded-xl border px-4 py-3 text-left transition ${
                            disabled
                              ? 'border-slate-200 bg-slate-100 opacity-60 cursor-not-allowed'
                              : active
                              ? 'border-violet-500 bg-gradient-to-br from-violet-100 via-fuchsia-100 to-pink-100 shadow-md'
                              : 'border-purple-200 bg-white hover:border-purple-400'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-slate-900">{optionLabel}</span>
                            <span className={`text-xs font-black ${disabled ? 'text-slate-500' : 'text-violet-700'}`}>
                              {disabled ? '품절' : `재고 ${available}`}
                            </span>
                          </div>
                          {(deltaPositive || deltaNegative) && (
                            <div className="mt-1 text-[11px] font-semibold text-slate-600">
                              기본가 {deltaPositive ? '+' : ''}{v.price_usdt_delta} USDT
                            </div>
                          )}
                          {v.sku && <div className="mt-0.5 text-[10px] text-slate-500">SKU: {v.sku}</div>}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 rounded-2xl border border-purple-200/80 bg-white/80 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-600">개당 가격</span>
                  <span className="font-black text-slate-900">
                    {(() => {
                      const sel = buyingVariants.find((v) => v.id === selectedVariantId)
                      const base = Number(buyingItem.priceUsdt) || 0
                      const delta = sel ? Number(sel.price_usdt_delta) : 0
                      return `${(base + delta).toFixed(2)} USDT`
                    })()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-600">재고</span>
                  <span className="font-bold text-slate-800">
                    {(() => {
                      const sel = buyingVariants.find((v) => v.id === selectedVariantId)
                      if (buyingVariants.length > 0 && !sel) return '옵션 선택 필요'
                      const qtyMax = sel ? sel.available : (Number(buyingItem.stock) || 0)
                      return `${qtyMax}개`
                    })()}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-600">수량</span>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const sel = buyingVariants.find((v) => v.id === selectedVariantId)
                      const qtyMax = sel ? sel.available : (Number(buyingItem.stock) || 1)
                      return (
                        <>
                          <button
                            onClick={() => setBuyQuantity((q) => Math.max(1, q - 1))}
                            className="h-9 w-9 rounded-xl bg-slate-100 text-lg font-bold hover:bg-slate-200"
                          >-</button>
                          <input
                            type="number"
                            min={1}
                            max={qtyMax}
                            value={buyQuantity}
                            onChange={(e) => setBuyQuantity(Math.max(1, Math.min(Number(e.target.value) || 1, qtyMax)))}
                            className="w-20 rounded-xl border border-purple-200 bg-white px-3 py-2 text-center text-sm font-bold text-slate-800"
                          />
                          <button
                            onClick={() => setBuyQuantity((q) => Math.min(qtyMax, q + 1))}
                            className="h-9 w-9 rounded-xl bg-slate-100 text-lg font-bold hover:bg-slate-200"
                          >+</button>
                        </>
                      )
                    })()}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-3 text-xs text-slate-700">
                두 번의 지갑 승인이 필요합니다:
                <br />
                <span className="font-bold text-violet-700">1)</span> DAO2 토큰 approve (spender = marketplace)
                <br />
                <span className="font-bold text-fuchsia-700">2)</span> buyListing 트랜잭션 실행
                <br />
                실제 차감 DAO2 수량은 머켓플레이스의 <code>quoteDao2Amount</code> 기준으로 계산됩니다.
              </div>

              {buyMsg && (
                <div className="mt-4 rounded-2xl border border-sky-200/80 bg-sky-50/80 p-3 text-xs font-semibold text-slate-700">
                  {buyMsg}
                </div>
              )}

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  onClick={handleApproveDao2}
                  disabled={buyStep === 'approving' || approvePending || approveConfirming || buyStep === 'buying' || buyStep === 'done'}
                  className={`rounded-2xl px-4 py-3 text-sm font-black text-white shadow-lg transition ${
                    (buyStep === 'approving' || approvePending || approveConfirming || buyStep === 'buying' || buyStep === 'done')
                      ? 'bg-slate-400 cursor-not-allowed opacity-70'
                      : 'bg-gradient-to-r from-sky-500 to-indigo-500 shadow-indigo-300/60 hover:-translate-y-0.5'
                  }`}
                >
                  {approvePending || buyStep === 'approving' || approveConfirming
                    ? '1단계 승인 중...'
                    : approveConfirmed
                    ? '✅ DAO2 승인 완료'
                    : '1단계: DAO2 approve'}
                </button>
                <button
                  onClick={handleConfirmBuy}
                  disabled={!approveConfirmed || buyPending || buyConfirming || buyStep === 'buying' || buyStep === 'done'}
                  className={`rounded-2xl px-4 py-3 text-sm font-black text-white shadow-lg transition ${
                    (!approveConfirmed || buyPending || buyConfirming || buyStep === 'buying' || buyStep === 'done')
                      ? 'bg-slate-400 cursor-not-allowed opacity-70'
                      : 'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 shadow-fuchsia-300/60 hover:-translate-y-0.5'
                  }`}
                >
                  {buyPending || buyStep === 'buying' || buyConfirming
                    ? '2단계 구매 중...'
                    : buyStep === 'done'
                    ? '🎉 구매 완료'
                    : '2단계: 구매 확정'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// ✨ Patch v8: 구매 버튼 포함 ProductCard
function ProductCard({ item, onBuy }: { item: SellerRequest; onBuy?: (item: SellerRequest) => void }) {
  const soldOut = Number(item.stock) <= 0 || item.status === 'SoldOut' || item.status === 'Paused' || item.status === 'Rejected'

  // ✨ Patch v9.2: 유형 배지
  const productType = item.productType || 'physical'
  const typeMeta: Record<string, { label: string; color: string }> = {
    physical: { label: '📦 일반상품', color: 'bg-sky-100 text-sky-700 border-sky-200' },
    service:  { label: '💅 서비스',    color: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' },
    food:     { label: '🍱 음식',      color: 'bg-amber-100 text-amber-700 border-amber-200' },
    digital:  { label: '💻 디지털',    color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  }
  const tm = typeMeta[productType] || typeMeta.physical

  const extra = (item.metadataExtra || {}) as Record<string, unknown>

  return (
    <div className="group overflow-hidden rounded-[28px] bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 hover:-translate-y-1 hover:shadow-fuchsia-200/70 transition-all duration-300">
      {item.imageUrl ? (
        <div className="relative aspect-square w-full overflow-hidden bg-gradient-to-br from-purple-50 to-pink-50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.imageUrl}
            alt={item.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-110"
          />
          <span className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-black ${tm.color}`}>
            {tm.label}
          </span>
        </div>
      ) : (
        <div className="relative flex aspect-square w-full items-center justify-center bg-gradient-to-br from-purple-100 via-pink-100 to-blue-100 text-6xl">
          📦
          <span className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[11px] font-black ${tm.color}`}>
            {tm.label}
          </span>
        </div>
      )}

      <div className="p-5">
        <div className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-violet-100 to-fuchsia-100 border border-violet-300 text-violet-700 shadow-sm px-3 py-1 text-xs font-bold">
          {item.category || '기타'}
        </div>
        <div className="mt-3 line-clamp-2 text-lg font-bold text-slate-900">{item.title}</div>

        {/* ✨ Patch v9.2: 유형별 메타 표시 */}
        {productType === 'physical' && (extra.size || extra.color) && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {extra.size  ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">📏 {String(extra.size)}</span>  : null}
            {extra.color ? <span className="rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">🎨 {String(extra.color)}</span> : null}
          </div>
        )}
        {productType === 'service' && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            {extra.duration_minutes ? <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 font-semibold text-fuchsia-700">⏱ {String(extra.duration_minutes)}분</span> : null}
            {extra.reservation_required ? <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 font-semibold text-fuchsia-700">📅 예약필요</span> : null}
          </div>
        )}
        {productType === 'food' && (
          <div className="mt-2 space-y-1 text-[11px] text-slate-600">
            {extra.shop_address ? <div className="truncate">📍 {String(extra.shop_address)}</div> : null}
            {extra.open_hours   ? <div className="truncate">🕓 {String(extra.open_hours)}</div>   : null}
          </div>
        )}
        {productType === 'digital' && extra.delivery_method && (
          <div className="mt-2 text-[11px]">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
              📨 전달: {String(extra.delivery_method)}
            </span>
          </div>
        )}

        <div className="mt-4 flex items-end justify-between">
          <div>
            <div className="text-xs text-slate-600 font-medium">💰 가격</div>
            <div className="text-xl font-black bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 bg-clip-text text-transparent">{item.priceUsdt} USDT</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-600 font-medium">📦 재고</div>
            <div className="text-sm font-bold text-slate-800">{item.stock}개</div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between text-xs">
          <span className="text-slate-600">🔥 판매 {item.soldCount}건</span>
          <span className="rounded-full inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-emerald-100 to-green-100 border border-emerald-300 text-emerald-700 shadow-sm px-3 py-1 font-bold">
            ✓ {item.status}
          </span>
        </div>

        {/* ✨ Patch v8: 구매하기 버튼 */}
        {onBuy && (
          <button
            onClick={() => !soldOut && onBuy(item)}
            disabled={soldOut}
            className={`mt-5 w-full rounded-2xl px-5 py-3 text-sm font-black text-white shadow-lg transition ${
              soldOut
                ? 'bg-slate-400 cursor-not-allowed opacity-70'
                : 'bg-gradient-to-r from-violet-600 via-fuchsia-500 to-pink-500 shadow-fuchsia-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-fuchsia-300/70'
            }`}
          >
            {soldOut ? '구매 불가' : '🛒 구매하기'}
          </button>
        )}
      </div>
    </div>
  )
}
