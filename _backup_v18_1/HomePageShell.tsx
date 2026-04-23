'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
  // ✨ Patch v16.1: 사이즈 가이드 (physical)
  const [extraSizeGuide, setExtraSizeGuide] = useState('')
  // service
  const [extraDurationMinutes, setExtraDurationMinutes] = useState('')
  const [extraReservationRequired, setExtraReservationRequired] = useState(true)
  // ✨ Patch v16.1: 서비스 운영 정보
  const [extraServiceAddress, setExtraServiceAddress] = useState('')
  const [extraServiceOpenHours, setExtraServiceOpenHours] = useState('')
  const [extraServiceHolidays, setExtraServiceHolidays] = useState('')
  // food
  const [extraShopAddress, setExtraShopAddress] = useState('')
  const [extraOpenHours, setExtraOpenHours] = useState('')
  // ✨ Patch v16.1: 음식 휴무일
  const [extraFoodHolidays, setExtraFoodHolidays] = useState('')
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

  // ✨ Patch v1: 반려 사유 입력 모달 상태
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

  // ✨ Patch v15.1: 구매자 영역 탭 (상품 구매 | 내 주문)
  const [buyerTab, setBuyerTab] = useState<'shop' | 'orders'>('shop')

  // ✨ Patch v15.1: 판매자 주문 상태 변경용 로컬 state (주문 id → 입력값)
  const [orderTrackingInputs, setOrderTrackingInputs] = useState<Record<string, { company: string; no: string }>>({})

  // ✨ v15: 관리자 부탭 (심사 | 카테고리 | 설정 | 매일큐)
  const [adminSubTab, setAdminSubTab] = useState<'review' | 'rejected' | 'categories' | 'settings' | 'mail'>('review')

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
  // ✨ Patch v17.0: 구매자가 선택한 사이즈/색상
  const [buyOptionSize, setBuyOptionSize] = useState('')
  const [buyOptionColor, setBuyOptionColor] = useState('')
  const [buyDeliveryNote, setBuyDeliveryNote] = useState('')
  const [buyServiceDate, setBuyServiceDate] = useState('')
  const [buyServiceTime, setBuyServiceTime] = useState('')
  // ✨ Patch v16.2: 예약 슬롯 상태
  const [reservedSlots, setReservedSlots] = useState<string[]>([]) // 이미 예약된 시간들 (HH:MM)
  const [reservedSlotsLoading, setReservedSlotsLoading] = useState(false)
  const [pendingSlotId, setPendingSlotId] = useState<string | null>(null) // 점유한 슬롯 ID (tx 성공 시 확정, 실패 시 해제)
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

  // ✨ Patch v16.0 (이동): DAO2 실시간 환산 — buyingItem/buyQuantity 선언 이후에 배치 (TDZ 방지)
  const quotePriceUsdt6 = useMemo(() => {
    if (!buyingItem) return 0n
    const sel = buyingVariants.find((v) => v.id === selectedVariantId)
    const base = Number(buyingItem.priceUsdt) || 0
    const delta = sel ? Number(sel.price_usdt_delta) : 0
    const totalUsdt = base + delta
    return BigInt(Math.round(totalUsdt * 1_000_000))
  }, [buyingItem, buyingVariants, selectedVariantId])
  const quoteQty = useMemo(() => BigInt(Math.max(1, buyQuantity)), [buyQuantity])
  const { data: quoteDao2Data, isLoading: quoteDao2Loading, error: quoteDao2Error } = useReadContract({
    address: MARKETPLACE_ADDRESS as `0x${string}` | undefined,
    abi: webkeyDao2MarketplaceAbi,
    functionName: 'quoteDao2Amount',
    args: buyingItem && quotePriceUsdt6 > 0n ? [quotePriceUsdt6, quoteQty] : undefined,
    query: { enabled: Boolean(buyingItem) && hasMarketplaceAddress && quotePriceUsdt6 > 0n },
  })
  // ✨ Patch v17.0: 폴백 환산 (컬트랙트 실패 또는 캐슱 대기 시)
  //   runtime_config.prime.dao2_per_usdt 가 있으면 사용, 없으면 1:1 기본분석
  // ✨ Patch v18.0: 환율 폴백 로직 보강 — 항상 값을 반환하도록 (1:1 기본)
  const quoteDao2Fallback = useMemo(() => {
    if (!buyingItem || quotePriceUsdt6 <= 0n) return null
    // runtime_config.prime.dao2_per_usdt 우선, 없으면 env NEXT_PUBLIC_DAO2_PER_USDT, 그리고 기본 1:1
    const fromConfig = (runtimeConfig?.prime as { dao2_per_usdt?: number | string } | undefined)?.dao2_per_usdt
      || (runtimeConfig?.marketplace as { dao2_per_usdt?: number | string } | undefined)?.dao2_per_usdt
    const fromEnv = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_DAO2_PER_USDT : undefined
    const rawRatio = fromConfig ?? fromEnv ?? 1
    const ratio = Number(rawRatio)
    if (!isFinite(ratio) || ratio <= 0) return null
    const usdt = Number(quotePriceUsdt6) / 1_000_000
    const dao2 = usdt * ratio
    return BigInt(Math.round(dao2 * 1e18))
  }, [buyingItem, quotePriceUsdt6, runtimeConfig])

  // ✨ Patch v18.0: 컬트랙트 값 우선, 실패 시 폴백 사용
  const quoteDao2Amount: bigint | null = (quoteDao2Data as bigint | undefined) ?? quoteDao2Fallback
  const quoteIsFallback = (quoteDao2Data == null) && (quoteDao2Fallback != null)
  const quoteHasError = quoteDao2Error != null

  // ✨ Patch v18.0: DAO2 조회 실패 시 규체적 원인 콘솔 로그
  useEffect(() => {
    if (quoteDao2Error && buyingItem) {
      console.warn('[DAO2 환산 조회 실패]', {
        reason: (quoteDao2Error as Error).message,
        marketplace: MARKETPLACE_ADDRESS,
        productId: buyingItem.id,
        priceUsdt6: quotePriceUsdt6.toString(),
        qty: quoteQty.toString(),
        hint: '1) quoteDao2Amount 함수가 컬트랙트 ABI에 없거나 들어오는 인자가 다름 2) MARKETPLACE_ADDRESS 오타 3) RPC 네트워크 문제',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteDao2Error])

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
    // ✨ Patch v15.1: 배송 정보 초기화
    setBuyDeliveryAddress('')
    // ✨ Patch v17.0: 사이즈/색상 초기화
    setBuyOptionSize('')
    setBuyOptionColor('')
    setBuyDeliveryPhone('')
    setBuyDeliveryEmail('')
    setBuyDeliveryNote('')
    setBuyServiceDate('')
    setBuyServiceTime('')
    setBuyFoodMethod('pickup')
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
      setBuyMsg('지갑을 먼저 연결해 주세요.')
      return
    }
    if (!hasMarketplaceAddress) {
      setBuyMsg('스토어 연결이 아직 설정되지 않았어요.')
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
      setBuyMsg('지갑을 먼저 연결해 주세요.')
      return
    }
    if (!hasMarketplaceAddress) {
      setBuyMsg('스토어 연결이 아직 설정되지 않았어요.')
      return
    }

    // ✨ Patch v11.0: variant 검증
    if (buyingVariants.length > 0 && !selectedVariantId) {
      setBuyMsg('옵션을 먼저 선택해 주세요.')
      return
    }

    // ✨ Patch v15.1: 유형별 배송 정보 필수값 검증
    {
      const pt = (buyingItem.productType || 'physical') as string
      if (pt === 'physical' && !buyDeliveryAddress.trim()) {
        setBuyMsg('❌ 받으실 주소를 입력하세요.')
        toast.error('배송 정보 부족', '받으실 주소를 입력하세요.')
        return
      }
      // ✨ Patch v17.0: physical - 판매자가 사이즈 제공했는데 선택 안 하면 차단
      if (pt === 'physical') {
        const metaP = (buyingItem.metadataExtra || {}) as Record<string, unknown>
        const sellerSizes = metaP.size ? String(metaP.size).split('/').map((s) => s.trim()).filter(Boolean) : []
        if (sellerSizes.length > 0 && !buyOptionSize) {
          setBuyMsg('❌ 사이즈를 선택하세요.')
          toast.error('사이즈 미선택', '구매할 사이즈를 선택해주세요.')
          return
        }
        if (pt === 'physical' && !buyDeliveryPhone.trim()) {
          setBuyMsg('❌ 연락처를 입력하세요.')
          toast.error('연락처 필요', '배송 안내를 위해 연락처가 필요합니다.')
          return
        }
      }
      if (pt === 'service' && (!buyServiceDate || !buyServiceTime || !buyDeliveryEmail.trim())) {
        setBuyMsg('❌ 예약 날짜·시간·이메일을 입력하세요.')
        toast.error('예약 정보 부족', '날짜 / 시간 / 이메일을 입력하세요.')
        return
      }
      // ✨ Patch v16.2: 서비스 시간 중복 검증
      if (pt === 'service' && reservedSlots.includes(buyServiceTime)) {
        setBuyMsg('❌ 선택한 시간은 이미 예약되었습니다.')
        toast.error('예약 시간 중복', `${buyServiceTime} 은 다른 사람이 이미 예약했습니다.`)
        return
      }
      if (pt === 'food') {
        if (!buyServiceTime) {
          setBuyMsg('❌ 픽업/배달 희망 시간을 선택하세요.')
          toast.error('수령 시간 부족')
          return
        }
        if (buyFoodMethod === 'delivery' && !buyDeliveryAddress.trim()) {
          setBuyMsg('❌ 배달 주소를 입력하세요.')
          toast.error('배달 주소 부족')
          return
        }
      }
      if (pt === 'digital' && !buyDeliveryEmail.trim()) {
        setBuyMsg('❌ 수령할 이메일을 입력하세요.')
        toast.error('이메일 주소 부족')
        return
      }
    }

    const selectedVariant = buyingVariants.find((v) => v.id === selectedVariantId)
    const qtyMax = selectedVariant
      ? selectedVariant.available
      : (Number(buyingItem.stock) || 1)
    const qty = Math.max(1, Math.min(buyQuantity, qtyMax))
    if (qty <= 0) {
      setBuyMsg('재고가 없어요.')
      return
    }

    try {
      setBuyStep('buying')
      setBuyMsg('주문 접수 중...')

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
            // ✨ Patch v15.1: 유형별 배송 정보 전달
            delivery_info: (() => {
              const pt = (buyingItem.productType || 'physical') as string
              if (pt === 'physical') {
                return {
                  type: 'physical',
                  address: buyDeliveryAddress,
                  phone: buyDeliveryPhone,
                  note: buyDeliveryNote,
                  email: buyDeliveryEmail,
                  // ✨ Patch v17.0: 선택한 사이즈/색상
                  size: buyOptionSize,
                  color: buyOptionColor,
                }
              }
              if (pt === 'service') {
                return { type: 'service', date: buyServiceDate, time: buyServiceTime, email: buyDeliveryEmail, phone: buyDeliveryPhone }
              }
              if (pt === 'food') {
                return { type: 'food', method: buyFoodMethod, time: buyServiceTime, address: buyDeliveryAddress, email: buyDeliveryEmail, phone: buyDeliveryPhone }
              }
              return { type: 'digital', email: buyDeliveryEmail }
            })(),
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
        setBuyMsg('❌ 주문 접수 실패: ' + (orderErr instanceof Error ? orderErr.message : String(orderErr)))
        return
      }

      // ✨ Patch v16.2: 서비스인 경우 슬롯 점유 시도
      if (pt === 'service' && buyServiceDate && buyServiceTime) {
        try {
          const slotRes = await fetch('/api/public/service-slots', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-wallet-address': address! },
            body: JSON.stringify({
              productId: buyingItem.id,
              date: buyServiceDate,
              time: buyServiceTime,
              email: buyDeliveryEmail,
              phone: buyDeliveryPhone,
              orderId: createdOrderId,
            }),
          })
          const slotJson = await slotRes.json()
          if (!slotRes.ok || !slotJson?.ok) {
            // 슬롯 점유 실패 → 주문 로드렝 후 중단
            if (createdOrderId) {
              await fetch(`/api/buyer/product-orders?id=${createdOrderId}`, {
                method: 'DELETE',
                headers: { 'x-wallet-address': address! },
              }).catch(() => undefined)
            }
            setBuyStep('idle')
            setBuyMsg('❌ 시간 예약 실두: ' + (slotJson?.message || '해당 시간은 이미 선점되었습니다'))
            toast.error('예약 실패', slotJson?.message || '다른 구매자가 먼저 예약했습니다. 다른 시간을 선택하세요.')
            // 예약 상태 재로드
            if (buyingItem) loadReservedSlots(buyingItem.id, buyServiceDate)
            return
          }
          // 슬롯 ID 기억 (tx 성공 시 확정)
          if (slotJson?.slotId) setPendingSlotId(slotJson.slotId)
        } catch (slotErr) {
          console.warn('슬롯 점유 오류:', slotErr)
        }
      }

      // 2) 온체인 buyListing 호출
      setBuyMsg('주문 확정 중... 지갑에서 승인해 주세요.')
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
        // ✨ Patch v16.2: 서비스 슬롯 확정
        if (pendingSlotId && address) {
          try {
            await fetch(`/api/public/service-slots?slotId=${pendingSlotId}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-wallet-address': address,
              },
              body: JSON.stringify({ confirm: true, orderId: pendingOrderId }),
            })
          } catch {
            /* ignore */
          }
          setPendingSlotId(null)
        }
        setPendingOrderId(null)
        setBuyStep('done')
        setBuyMsg('🎉 주문이 완료되었습니다.')
      })()
      const t = setTimeout(() => {
        closeBuyModal()
      }, 5000)
      return () => clearTimeout(t)
    }
  }, [buyConfirmed, buyStep, pendingOrderId, pendingSlotId, buyTxHash, address])

  // 에러 감지
  useEffect(() => {
    if (approveError && buyStep === 'approving') {
      setBuyStep('idle')
      setBuyMsg('❌ 결제 승인 실패: ' + (approveError as Error).message)
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
        // ✨ Patch v16.2: tx 실패 시 슬롯 동시 해제
        if (pendingSlotId && address) {
          try {
            await fetch(`/api/public/service-slots?slotId=${pendingSlotId}`, {
              method: 'DELETE',
              headers: { 'x-wallet-address': address },
            })
          } catch {
            /* ignore */
          }
          setPendingSlotId(null)
        }
      })()
      setBuyStep('idle')
      setBuyMsg('❌ 주문 확정 실패: ' + (buyError as Error).message)
    }
  }, [buyError, buyStep, pendingOrderId, pendingSlotId, address])

  // ✨ Patch v15.1: 구매자 내 주문 로더
  const loadMyBuyOrders = useCallback(async () => {
    if (!address) return
    setMyBuyOrdersLoading(true)
    try {
      const res = await fetch(`/api/buyer/product-orders?wallet=${address}`, {
        headers: { 'x-wallet-address': address },
        cache: 'no-store',
      })
      const json = await res.json()
      if (res.ok && json?.ok && Array.isArray(json.items)) {
        setMyBuyOrders(json.items)
      } else {
        setMyBuyOrders([])
      }
    } catch {
      setMyBuyOrders([])
    } finally {
      setMyBuyOrdersLoading(false)
    }
  }, [address])

  // ✨ Patch v15.1: 판매자 들어온 주문 로더
  const loadMySellOrders = useCallback(async () => {
    if (!address) return
    setMySellOrdersLoading(true)
    try {
      const res = await fetch(`/api/seller/product-orders?wallet=${address}`, {
        headers: { 'x-wallet-address': address },
        cache: 'no-store',
      })
      const json = await res.json()
      if (res.ok && json?.ok && Array.isArray(json.items)) {
        setMySellOrders(json.items)
      } else {
        setMySellOrders([])
      }
    } catch {
      setMySellOrders([])
    } finally {
      setMySellOrdersLoading(false)
    }
  }, [address])

  // ✨ Patch v15.1: 구매자 탭 진입/지갑 변경 시 자동 로드
  useEffect(() => {
    if (buyerTab === 'orders' && address) {
      loadMyBuyOrders()
    }
  }, [buyerTab, address, loadMyBuyOrders])

  // ✨ Patch v15.1: 판매 관리 부탭 진입 시 자동 로드
  useEffect(() => {
    if (sellTab === 'mine' && mineSubTab === 'incoming_orders' && address) {
      loadMySellOrders()
    }
  }, [sellTab, mineSubTab, address, loadMySellOrders])

  // ✨ Patch v15.1: 주문 완료 시 토스트 ("내 주문" 탭 바로가기 추가)
  useEffect(() => {
    if (buyStep === 'done') {
      toast.custom({
        kind: 'success',
        title: '주문 완료 🎉',
        description: '"내 주문" 탭에서 진행 상태를 확인하세요.',
        actionLabel: '내 주문 내역 보기',
        onAction: () => { setBuyerTab('orders'); loadMyBuyOrders() },
        ttlMs: 8000,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyStep])

  // ✨ Patch v15.1: 구매 실패 토스트
  useEffect(() => {
    if (buyError && buyStep === 'buying') {
      toast.error('구매 실패', (buyError as Error).message)
    }
    if (approveError && buyStep === 'approving') {
      toast.error('DAO2 승인 실패', (approveError as Error).message)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyError, approveError])

  // ✨ Patch v15.1: 판매자 주문 상태 변경 핸들러
  async function handleUpdateOrderStatus(
    orderId: string,
    nextStatus: string,
    extra?: { tracking_company?: string; tracking_no?: string },
  ) {
    if (!address) {
      toast.error('아직 연결되지 않았습니다')
      return
    }
    try {
      const res = await fetch('/api/seller/order-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
        },
        body: JSON.stringify({ orderId, status: nextStatus, ...extra }),
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.success('주문 상태 변경', `→ ${nextStatus}`)
        loadMySellOrders()
      } else {
        toast.error('상태 변경 실패', json?.message || '서버 오류')
      }
    } catch (e) {
      toast.error('상태 변경 실패', e instanceof Error ? e.message : String(e))
    }
  }

  // ✨ Patch v15.1: 구매자 주문 취소하기
  async function handleCancelMyOrder(orderId: string) {
    if (!address) return
    if (!window.confirm('이 주문을 취소하겠습니까? 온체인 도달 전의 주문만 취소 가능합니다.')) return
    try {
      const res = await fetch(`/api/buyer/product-orders?id=${orderId}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': address },
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.success('주문 취소하기 완료')
        loadMyBuyOrders()
      } else {
        toast.error('취소 실패', json?.message || '')
      }
    } catch (e) {
      toast.error('취소 실패', e instanceof Error ? e.message : String(e))
    }
  }

  // ✨ Patch v16.2: 특정 상품/날짜의 예약된 슬롯 로드
  const loadReservedSlots = useCallback(async (productId: string, date: string) => {
    if (!productId || !date) {
      setReservedSlots([])
      return
    }
    setReservedSlotsLoading(true)
    try {
      const res = await fetch(`/api/public/service-slots?productId=${productId}&date=${date}`, {
        cache: 'no-store',
      })
      const json = await res.json()
      if (res.ok && json?.ok && Array.isArray(json.slots)) {
        // reserved_time: "14:00:00" → "14:00"
        const times = json.slots.map((s: { reserved_time: string }) => s.reserved_time.slice(0, 5))
        setReservedSlots(times)
      } else {
        setReservedSlots([])
      }
    } catch {
      setReservedSlots([])
    } finally {
      setReservedSlotsLoading(false)
    }
  }, [])

  // ✨ Patch v16.2: 서비스 상품에서 예약 날짜 변경 시 자동으로 로드
  useEffect(() => {
    if (!buyingItem) return
    if (buyingItem.productType !== 'service') return
    if (!buyServiceDate) {
      setReservedSlots([])
      return
    }
    loadReservedSlots(buyingItem.id, buyServiceDate)
  }, [buyingItem, buyServiceDate, loadReservedSlots])

  // ✨ Patch v16.2: 판매자 예약 캠린더 로더
  type SellerReservationSlot = {
    id: string
    product_id: string
    order_id: string | null
    reserved_date: string
    reserved_time: string
    duration_minutes: number
    status: string
    buyer_wallet: string
    buyer_email: string | null
    buyer_phone: string | null
    note: string | null
    product_title: string
  }
  const [sellerSlots, setSellerSlots] = useState<SellerReservationSlot[]>([])
  const [sellerSlotsLoading, setSellerSlotsLoading] = useState(false)

  const loadSellerSlots = useCallback(async () => {
    if (!address) return
    setSellerSlotsLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const toDate = new Date()
      toDate.setDate(toDate.getDate() + 60)
      const to = toDate.toISOString().slice(0, 10)
      const res = await fetch(`/api/seller/service-slots?wallet=${address}&from=${today}&to=${to}`, {
        headers: { 'x-wallet-address': address },
        cache: 'no-store',
      })
      const json = await res.json()
      if (res.ok && json?.ok && Array.isArray(json.slots)) {
        setSellerSlots(json.slots)
      } else {
        setSellerSlots([])
      }
    } catch {
      setSellerSlots([])
    } finally {
      setSellerSlotsLoading(false)
    }
  }, [address])

  // 판매 관리 “들어온 주문” 탭 진입 시 자동 로드
  useEffect(() => {
    if (sellTab === 'mine' && mineSubTab === 'incoming_orders' && address) {
      loadSellerSlots()
    }
  }, [sellTab, mineSubTab, address, loadSellerSlots])

  // ✨ Patch v15.2: 관리자 카테고리 로더
  const loadAdminCategories = useCallback(async () => {
    if (!address || !isAdmin) return
    setAdminCategoriesLoading(true)
    try {
      const res = await fetch('/api/admin/categories', {
        headers: { 'x-wallet-address': address },
        cache: 'no-store',
      })
      const json = await res.json()
      if (res.ok && json?.ok && Array.isArray(json.items)) {
        setAdminCategories(json.items)
      } else {
        setAdminCategories([])
        if (json?.message) toast.error('카테고리 로드 실패', json.message)
      }
    } catch (e) {
      setAdminCategories([])
      toast.error('카테고리 로드 실패', e instanceof Error ? e.message : String(e))
    } finally {
      setAdminCategoriesLoading(false)
    }
  }, [address, isAdmin, toast])

  // ✨ Patch v15.2: 카테고리 추가
  async function handleAddCategory() {
    if (!address || !isAdmin) return
    if (!newCategoryCode.trim() || !newCategoryName.trim()) {
      toast.error('입력 부족', '코드와 이름은 필수입니다.')
      return
    }
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': address },
        body: JSON.stringify({
          code: newCategoryCode.trim(),
          name_ko: newCategoryName.trim(),
          emoji: newCategoryEmoji || '🏷️',
          product_type: newCategoryType,
        }),
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.success('카테고리 추가 완료', `${newCategoryEmoji} ${newCategoryName}`)
        setNewCategoryCode('')
        setNewCategoryName('')
        setNewCategoryEmoji('🏷️')
        loadAdminCategories()
      } else {
        toast.error('추가 실패', json?.message || '')
      }
    } catch (e) {
      toast.error('추가 실패', e instanceof Error ? e.message : String(e))
    }
  }

  // ✨ Patch v15.2: 카테고리 수정 (활성/비활성 토글)
  async function handleToggleCategoryActive(code: string, nextActive: boolean) {
    if (!address || !isAdmin) return
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': address },
        body: JSON.stringify({ code, is_active: nextActive }),
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.success(nextActive ? '카테고리 활성화' : '카테고리 비활성화', code)
        loadAdminCategories()
      } else {
        toast.error('수정 실패', json?.message || '')
      }
    } catch (e) {
      toast.error('수정 실패', e instanceof Error ? e.message : String(e))
    }
  }

  // ✨ Patch v15.2: 카테고리 삭제
  async function handleDeleteCategory(code: string, name: string) {
    if (!address || !isAdmin) return
    if (!window.confirm(`카테고리 "${name}" 을(를) 삭제하겠습니까?\n이미 사용 중인 상품이 있다면 실패할 수 있습니다.`)) return
    try {
      const res = await fetch(`/api/admin/categories?code=${encodeURIComponent(code)}`, {
        method: 'DELETE',
        headers: { 'x-wallet-address': address },
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.success('카테고리 삭제 완료', name)
        loadAdminCategories()
      } else {
        toast.error('삭제 실패', json?.message || '사용 중인 상품이 있을 수 있습니다.')
      }
    } catch (e) {
      toast.error('삭제 실패', e instanceof Error ? e.message : String(e))
    }
  }

  // ✨ Patch v15.2: 관리자 부탭 진입 시 자동 로드
  useEffect(() => {
    if (sellTab === 'admin' && adminSubTab === 'categories' && isAdmin && address) {
      loadAdminCategories()
    }
  }, [sellTab, adminSubTab, isAdmin, address, loadAdminCategories])

  // ✨ Patch v15.2: 이메일 큐 수동 처리
  async function handleProcessEmailQueue() {
    if (!address || !isAdmin) return
    try {
      toast.info('이메일 큐 처리 중...')
      const res = await fetch('/api/admin/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wallet-address': address },
        body: JSON.stringify({ action: 'process_queue' }),
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.success('이메일 전송 완료', `${json.sent || 0}건 전송, ${json.failed || 0}건 실패`)
      } else {
        toast.error('전송 실패', json?.message || '')
      }
    } catch (e) {
      toast.error('전송 실패', e instanceof Error ? e.message : String(e))
    }
  }

  // ✨ Patch v15.2: pg_cron 수동 트리거 (만료 주문 정리)
  async function handleManualCleanup() {
    if (!address || !isAdmin) return
    try {
      toast.info('만료 주문 정리 중...')
      const res = await fetch('/api/admin/cron-cleanup', {
        method: 'POST',
        headers: { 'x-wallet-address': address },
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.success('정리 완료', `${json.cleaned || 0}건 취소처리`)
      } else {
        toast.error('정리 실패', json?.message || '')
      }
    } catch (e) {
      toast.error('정리 실패', e instanceof Error ? e.message : String(e))
    }
  }

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
        // ✨ Patch v16.1: 사이즈 가이드
        if (extraSizeGuide) metadataExtra.size_guide = extraSizeGuide
      } else if (productType === 'service') {
        if (extraDurationMinutes) metadataExtra.duration_minutes = Number(extraDurationMinutes)
        metadataExtra.reservation_required = extraReservationRequired
        // ✨ Patch v16.1: 서비스 운영 정보
        if (extraServiceAddress) metadataExtra.service_address = extraServiceAddress
        if (extraServiceOpenHours) metadataExtra.open_hours = extraServiceOpenHours
        if (extraServiceHolidays) metadataExtra.holidays = extraServiceHolidays
      } else if (productType === 'food') {
        if (extraShopAddress) metadataExtra.shop_address = extraShopAddress
        if (extraOpenHours)  metadataExtra.open_hours = extraOpenHours
        // ✨ Patch v16.1: 휴무일
        if (extraFoodHolidays) metadataExtra.holidays = extraFoodHolidays
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
      // ✨ v15: 등록 완료 토스트 + 내 등록 상품 보기 버튼
      toast.custom({
        kind: 'success',
        title: '상품 등록 신청 완료',
        description: '변경사항은 “내 판매 관리” 탭에서 확인할 수 있습니다. 관리자 심사 후 공개됩니다.',
        actionLabel: '내 등록 상품 보기',
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
    setMessage('사진 업로드 중...')

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
          '❌ 사진 업로드 실패.\n' +
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
    setMessage('✅ 사진 업로드 완료.')
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
    if (!address) {
      toast.error('아직 연결되지 않았습니다')
      return
    }
    if (!confirm(`'${title}' 상품을 정말 삭제할까?`)) return

    setActionLoading(true)
    setMessage('')

    try {
      // ✨ Patch v18.0: 서버는 ?id= 쿼리스트링으로 productId를 받음
      const res = await fetch(`/api/seller/product-manage?id=${encodeURIComponent(productId)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet-address': address,
        },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) {
        throw new Error(json?.message || `HTTP ${res.status}`)
      }

      setMessage('✅ 상품 삭제 완료.')
      toast.success('상품 삭제 완료', title)
      await fetchSellData()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '삭제 실패'
      setMessage(msg)
      toast.error('삭제 실패', msg)
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
      // ✨ Patch v15.1: 승인/거절 토스트
      if (nextStatus === 'Approved') toast.success('판매 승인 완료', '구매 목록에 바로 노출돼요.')
      else if (nextStatus === 'Rejected') toast.custom({ kind: 'error', title: '판매 반려', description: rejectionReason || '사유 없음' })
      else toast.success('상태 변경 완료', `→ ${nextStatus}`)
      await fetchSellData()
      await fetchApprovedProducts()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '상태 변경에 실패했다.')
      toast.error('상태 변경 실패', error instanceof Error ? error.message : '서버 오류')
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
      setMessage('반려 사유를 입력해야 한다.')
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
    if (!address || !isAdmin || !editProductId) {
      toast.error('권한 없음')
      return
    }

    setActionLoading(true)
    setMessage('')

    try {
      // ✨ Patch v17.0: 명시적 HTTP 실패 검증 + 토스트
      const res = await fetch('/api/admin/product-manage', {
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
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) throw new Error(json?.message || `HTTP ${res.status}`)

      setMessage('상품 수정 저장이 완료되었다.')
      toast.success('상품 수정 완료')
      await fetchSellData()
      await fetchApprovedProducts()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '수정 실패'
      setMessage(msg)
      toast.error('수정 실패', msg)
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteProduct = async () => {
    if (!address || !isAdmin || !editProductId) {
      toast.error('권한 없음')
      return
    }
    if (!confirm('정말 이 상품을 삭제할까?')) return

    setActionLoading(true)
    setMessage('')

    try {
      // ✨ Patch v17.0
      const res = await fetch('/api/admin/product-manage', {
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
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) throw new Error(json?.message || `HTTP ${res.status}`)

      setMessage('상품 삭제가 완료되었다.')
      toast.success('🗑️ 상품 삭제 완료', editTitle || '')
      setEditProductId('')
      await fetchSellData()
      await fetchApprovedProducts()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '삭제 실패'
      setMessage(msg)
      toast.error('삭제 실패', msg)
    } finally {
      setActionLoading(false)
    }
  }

  const handleDeleteProductImage = async () => {
    if (!address || !isAdmin || !editProductId) {
      toast.error('권한 없음')
      return
    }
    if (!confirm('대표 사진를 삭제할까?')) return

    setActionLoading(true)
    setMessage('')

    try {
      // ✨ Patch v17.0
      const res = await fetch('/api/admin/product-image-delete', {
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
      const json = await res.json().catch(() => ({}))
      if (!res.ok || json?.ok === false) throw new Error(json?.message || `HTTP ${res.status}`)

      setEditImageUrl('')
      setMessage('대표 사진 삭제가 완료되었다.')
      toast.success('대표 사진 삭제 완료')
      await fetchSellData()
      await fetchApprovedProducts()
    } catch (error) {
      const msg = error instanceof Error ? error.message : '이미지 삭제 실패'
      setMessage(msg)
      toast.error('이미지 삭제 실패', msg)
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
      setMessage('멤버십 정책 저장 완료')
      await fetchRuntime()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '멤버십 정책 저장 실패')
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
      setMessage('스토어 설정 저장 완료')
      await fetchRuntime()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '스토어 설정 저장 실패')
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
                  ✨ WebKey Commerce · Next-Gen Marketplace
                </div>

                <h1 className="text-4xl font-black tracking-[-0.06em] text-slate-900 md:text-6xl xl:text-7xl">
                  <span className="bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 bg-clip-text text-transparent">쇼핑의 미래,</span>
                  <br />
                  <span className="bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">WebKey Commerce</span>
                </h1>

                <p className="mt-6 max-w-2xl text-sm leading-7 text-slate-700 md:text-base xl:text-lg">
                  의류·신발·서비스 예약·음식·디지털 상품을 WebKey DAO2 토큰으로 바로 거래하는 Web3 커머스입니다.
                  내 지갑 하나로 결제·적립·인증까지 — 투명하고 빠른 새로운 쇼핑 경험을 만나보세요.
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="rounded-full border border-sky-200 bg-sky-50/90 px-4 py-2 text-xs font-bold text-sky-700 shadow-sm md:text-sm">🔐 지갑 기반 안전 결제</span>
                  <span className="rounded-full border border-fuchsia-200 bg-fuchsia-50/90 px-4 py-2 text-xs font-bold text-fuchsia-700 shadow-sm md:text-sm">💠 WebKey DAO2 토큰 결제</span>
                  <span className="rounded-full border border-violet-200 bg-violet-50/90 px-4 py-2 text-xs font-bold text-violet-700 shadow-sm md:text-sm">🛡️ 검증된 셀러 · 블록체인 기록</span>
                </div>
              </div>

              <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div className="rounded-[26px] border border-violet-200 bg-white/80 px-4 py-3 shadow-lg shadow-violet-100/70 backdrop-blur-xl">
                  <ConnectButton />
                </div>

                <div className="grid grid-cols-2 gap-3 md:min-w-[340px]">
                  <div className="rounded-2xl border border-white/80 bg-white/72 p-4 shadow-lg shadow-violet-100/60 backdrop-blur-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-500">판매 중</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{displayableProducts.length}</div>
                    <div className="mt-1 text-xs text-slate-600">지금 구매 가능</div>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/72 p-4 shadow-lg shadow-fuchsia-100/60 backdrop-blur-xl">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500">멤버십</div>
                    <div className="mt-2 text-lg font-black text-slate-900 truncate">{runtimeConfig?.prime?.plan_name || 'DAO2 Prime'}</div>
                    <div className="mt-1 text-xs text-slate-600">프리미엄 회원 플랜</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-[32px] border border-violet-200/90 bg-white/78 p-6 shadow-2xl shadow-violet-100/70 backdrop-blur-2xl">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-500">스토어 상태</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{hasMarketplaceAddress ? '정상 운영 중' : '준비 중'}</div>
                  </div>
                  <div className="rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 px-4 py-3 text-white shadow-lg">🚀</div>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-violet-100 bg-white/78 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">수수료</div>
                    <div className="mt-2 text-xl font-black text-slate-900">
                      {!hasMarketplaceAddress
                        ? bpsToPercent(runtimeConfig?.marketplace?.fee_bps)
                        : feeLoading
                        ? '...'
                        : bpsToPercent(feeBps as number | bigint | undefined)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-fuchsia-100 bg-white/78 p-4">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">판매자 권한</div>
                    <div className="mt-2 text-xl font-black text-slate-900">
                      {!isConnected ? '지갑을 먼저 연결해 주세요' : (promotionActive ? '판매 가능 (오픈 이벤트)' : canSellLoading ? '확인 중...' : canSell ? '가능' : '판매자 신청이 필요해요')}
                    </div>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">내 지갑</div>
                  <div className="mt-2 truncate text-sm font-semibold text-slate-800">{address ?? '아직 연결되지 않았습니다'}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {isAdmin && <span className="rounded-full bg-violet-100 px-3 py-1 font-bold text-violet-700">관리자 ✓</span>}
                    {promotionActive && <span className="rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-700">오픈 이벤트</span>}
                  </div>
                </div>
              </div>

              {promotionActive && (
                <div className="rounded-[28px] border border-amber-200/90 bg-gradient-to-r from-amber-100/95 via-orange-100/90 to-pink-100/95 p-5 shadow-xl shadow-amber-100/80">
                  <div className="flex flex-wrap items-center gap-3 text-sm font-black text-slate-800 md:text-base">
                    <span>🚀 오픈 기념 런칭 이벤트 진행 중</span>
                    {promotionDaysRemaining !== null && promotionDaysRemaining > 0 && (
                      <span className="rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-3 py-1.5 text-xs font-black text-white shadow-md">
                        D-{promotionDaysRemaining}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">누구나 판매자 신청 가능 · 승인 후 바로 노출</p>
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
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50/80 px-4 py-1.5 text-xs font-black text-sky-700 shadow-sm">🛍 구매하기</div>
                <div className="mt-5 text-4xl font-black tracking-[-0.04em] text-sky-700 md:text-5xl">쇼핑 둘러보기</div>
                <p className="mt-4 max-w-lg text-sm leading-7 text-slate-700 md:text-base">
                  카테고리별로 신상·인기 상품을 확인하고 원하는 조건으로 검색해 보세요. 마음에 드는 상품을 바로 구매할 수 있어요.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/80 bg-white/78 p-4 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500">카테고리 탐색</div>
                    <div className="mt-2 text-sm font-bold text-slate-800">취향에 맞는 상품을 빠르게</div>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/78 p-4 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-sky-500">간편 결제</div>
                    <div className="mt-2 text-sm font-bold text-slate-800">WebKey DAO2 토큰으로 한 번에 결제</div>
                  </div>
                </div>
              </div>

              <div className="mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-gradient-to-r from-sky-500 to-cyan-500 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-sky-200/90">
                상품 둘러보기 →
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
                <div className="inline-flex items-center gap-2 rounded-full border border-fuchsia-200 bg-fuchsia-50/80 px-4 py-1.5 text-xs font-black text-fuchsia-700 shadow-sm">✨ 판매하기</div>
                <div className="mt-5 text-4xl font-black tracking-[-0.04em] text-violet-700 md:text-5xl">내 상품 올리기</div>
                <p className="mt-4 max-w-lg text-sm leading-7 text-slate-700 md:text-base">
                  상품을 등록하고 검수를 받으면 바로 판매가 시작돼요. 등록부터 주문 관리까지 한 곳에서 편하게 운영하세요.
                </p>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/80 bg-white/78 p-4 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500">간편 등록</div>
                    <div className="mt-2 text-sm font-bold text-slate-800">사진 한 장으로 시작</div>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-white/78 p-4 shadow-sm">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500">빠른 검수</div>
                    <div className="mt-2 text-sm font-bold text-slate-800">검수 결과를 바로 확인</div>
                  </div>
                </div>
              </div>

              <div className="mt-8 inline-flex w-fit items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 px-6 py-3.5 text-sm font-black text-white shadow-xl shadow-fuchsia-200/90">
                판매 시작하기 →
              </div>
            </div>
          </button>
        </section>

        {viewMode === 'home' && (
          <section className="mb-10 grid gap-6 xl:grid-cols-3">
            <div className="rounded-[30px] border border-white/80 bg-white/78 p-6 shadow-2xl shadow-violet-100/60 backdrop-blur-2xl">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-violet-500">이용 안내</div>
              <div className="mt-4 space-y-4">
                <div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-violet-100 font-black text-violet-700">1</span><div><div className="font-bold text-slate-900">상품 등록</div><div className="text-sm text-slate-600">판매하려는 상품의 정보와 사진을 올려주세요.</div></div></div>
                <div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-sky-100 font-black text-sky-700">2</span><div><div className="font-bold text-slate-900">검수 및 공개</div><div className="text-sm text-slate-600">검수가 끝나면 바로 구매 목록에 등록돼요.</div></div></div>
                <div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-fuchsia-100 font-black text-fuchsia-700">3</span><div><div className="font-bold text-slate-900">DAO2 결제</div><div className="text-sm text-slate-600">WebKey DAO2 토큰으로 한 번에 결제할 수 있어요.</div></div></div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/80 bg-white/78 p-6 shadow-2xl shadow-sky-100/60 backdrop-blur-2xl">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-sky-500">스토어 정보</div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                  <div className="text-xs font-bold text-slate-500">스토어 연결 주소</div>
                  <div className="mt-2 break-all font-mono text-xs text-slate-800">{MARKETPLACE_ADDRESS || runtimeConfig?.marketplace?.marketplace_address || '미설정'}</div>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-white/80 p-4">
                  <div className="text-xs font-bold text-slate-500">운영 수수료</div>
                  <div className="mt-2 text-2xl font-black text-slate-900">
                    {!hasMarketplaceAddress ? bpsToPercent(runtimeConfig?.marketplace?.fee_bps) : feeLoading ? '...' : bpsToPercent(feeBps as number | bigint | undefined)}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[30px] border border-white/80 bg-white/78 p-6 shadow-2xl shadow-fuchsia-100/60 backdrop-blur-2xl">
              <div className="text-xs font-black uppercase tracking-[0.18em] text-fuchsia-500">오픈 안내</div>
              <div className="mt-4 space-y-3 text-sm leading-7 text-slate-700">
                <p>• 일반 구매자에게는 관리자 영역이 보이지 않아요</p>
                <p>• 오픈 이벤트 기간 중 누구나 판매자 신청이 가능해요</p>
                <p>• 판매 신청 결과와 반려 사유는 내 판매 관리에서 바로 확인할 수 있어요</p>
                <p>• 원하는 카테고리와 조건으로 상품을 빠르게 찾을 수 있어요</p>
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-3xl font-black bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">🛍 쇼핑하기</h2>
                {/* ✨ Patch v15.1: 구매자 탭 바 */}
                <div className="flex gap-2 rounded-2xl bg-slate-100/80 p-1">
                  <button
                    onClick={() => setBuyerTab('shop')}
                    className={`rounded-xl px-4 py-2 text-sm font-bold transition ${buyerTab === 'shop' ? 'bg-white text-violet-700 shadow-md' : 'text-slate-600 hover:text-slate-900'}`}
                  >🛍 쇼핑 둘러보기</button>
                  <button
                    onClick={() => { setBuyerTab('orders'); if (address) loadMyBuyOrders() }}
                    className={`rounded-xl px-4 py-2 text-sm font-bold transition ${buyerTab === 'orders' ? 'bg-white text-violet-700 shadow-md' : 'text-slate-600 hover:text-slate-900'}`}
                  >📋 내 주문 내역 {myBuyOrders.length > 0 && (<span className="ml-1 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] text-white">{myBuyOrders.length}</span>)}</button>
                </div>
              </div>
              <p className="mt-3 text-sm text-slate-700">
                {buyerTab === 'shop' ? '인기 상품과 신상품을 카테고리별로 둘러보세요.' : '내가 주문한 내역과 진행 상태를 확인할 수 있어요.'}
              </p>

              <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 hover:-translate-y-1 transition-all duration-300">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider">Marketplace 주소</div>
                  <div className="mt-2 break-all text-xs text-slate-800 font-mono">
                    {MARKETPLACE_ADDRESS || runtimeConfig?.marketplace?.marketplace_address || '미설정'}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 hover:-translate-y-1 transition-all duration-300">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider">💰 운영 수수료</div>
                  <div className="mt-2 text-2xl font-bold bg-gradient-to-r from-violet-700 via-fuchsia-600 to-pink-500 bg-clip-text text-transparent">
                    {!hasMarketplaceAddress
                      ? bpsToPercent(runtimeConfig?.marketplace?.fee_bps)
                      : feeLoading
                      ? '...'
                      : bpsToPercent(feeBps as number | bigint | undefined)}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 hover:-translate-y-1 transition-all duration-300">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider">✨ 멤버십</div>
                  <div className="mt-2 text-lg font-bold text-slate-900">
                    {runtimeConfig?.prime?.plan_name || '-'}
                  </div>
                </div>

                <div className="rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 hover:-translate-y-1 transition-all duration-300">
                  <div className="text-xs font-semibold text-purple-600 uppercase tracking-wider">📦 판매 중 상품</div>
                  <div className="mt-2 text-2xl font-bold bg-gradient-to-r from-sky-600 via-violet-600 to-fuchsia-500 bg-clip-text text-transparent">
                    {displayableProducts.length}개
                  </div>
                </div>
              </div>
            </div>

            {/* ✨ Patch v15.1: 'shop' 탭일 때만 검색/카테고리/상품 목록 표시 */}
            {buyerTab === 'shop' && (<>
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
              <div className="mb-3 text-xs font-black uppercase tracking-[0.18em] text-violet-500">카테고리</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {([
                  { key: 'all',      label: '🗂 전체',     color: 'violet' },
                  { key: 'physical', label: '📦 실물 상품', color: 'sky' },
                  { key: 'service',  label: '💅 서비스 예약',    color: 'fuchsia' },
                  { key: 'food',     label: '🍱 음식 주문',      color: 'amber' },
                  { key: 'digital',  label: '💻 디지털 상품',    color: 'emerald' },
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
            </>)}

              {/* ✨ Patch v15.1: 구매자 “내 주문” 탭 UI */}
              {buyerTab === 'orders' && (
                <div className="mt-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black text-slate-800">📋 내가 구매한 주문</h3>
                    <button onClick={() => loadMyBuyOrders()}
                      className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200">🔄 새로고침</button>
                  </div>
                  {!isConnected && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                      지갑을 먼저 연결해 주세요.
                    </div>
                  )}
                  {isConnected && myBuyOrdersLoading && (
                    <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-center text-sm text-slate-500">주문 내역을 불러오는 중...</div>
                  )}
                  {isConnected && !myBuyOrdersLoading && myBuyOrders.length === 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-center text-sm text-slate-500">
                      아직 주문한 상품이 없어요. 마음에 드는 상품을 찾아보세요!
                    </div>
                  )}
                  {isConnected && !myBuyOrdersLoading && myBuyOrders.length > 0 && (
                    <div className="grid gap-4">
                      {myBuyOrders.map((od) => {
                        const statusColor: Record<string,string> = {
                          pending: 'bg-amber-100 text-amber-700',
                          confirmed: 'bg-sky-100 text-sky-700',
                          reserved: 'bg-violet-100 text-violet-700',
                          shipped: 'bg-indigo-100 text-indigo-700',
                          delivered: 'bg-emerald-100 text-emerald-700',
                          completed: 'bg-emerald-100 text-emerald-700',
                          cancelled: 'bg-rose-100 text-rose-700',
                          sent: 'bg-emerald-100 text-emerald-700',
                        }
                        const statusLabel: Record<string,string> = {
                          pending: '결제 대기',
                          confirmed: '결제 완료',
                          reserved: '예약 완료',
                          shipped: '배송 중',
                          delivered: '배송 완료',
                          completed: '주문 완료',
                          cancelled: '주문 취소하기',
                          sent: '전송 완료',
                        }
                        const canCancel = od.status === 'pending' || od.status === 'confirmed'
                        const pt = od.product_type || 'physical'
                        const typeEmoji: Record<string,string> = { physical: '📦', service: '📅', food: '🍽', digital: '💾' }
                        return (
                          <div key={od.order_id} className="rounded-2xl border border-purple-200 bg-white/90 p-4 shadow-sm">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                {od.product_image_url ? (
                                  <img src={od.product_image_url} alt="" className="h-16 w-16 rounded-xl object-cover" />
                                ) : (
                                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-2xl">{typeEmoji[pt]}</div>
                                )}
                                <div>
                                  <div className="text-xs text-slate-500">{new Date(od.ordered_at).toLocaleString('ko-KR')}</div>
                                  <div className="text-base font-black text-slate-800">{od.product_title || '상품명 없음'}</div>
                                  <div className="mt-0.5 text-xs text-slate-600">수량 {od.quantity} {od.variant_sku ? `· ${od.variant_sku}` : ''}</div>
                                  {od.total_usdt6 != null && (
                                    <div className="mt-0.5 text-xs font-semibold text-violet-700">중 {(Number(od.total_usdt6)/1_000_000).toFixed(2)} USDT</div>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusColor[od.status] || 'bg-slate-100 text-slate-700'}`}>
                                  {typeEmoji[pt]} {statusLabel[od.status] || od.status}
                                </span>
                                {od.tracking_no && (
                                  <div className="rounded-lg bg-indigo-50 px-2 py-1 text-[11px] text-indigo-700">
                                    운송장: {od.tracking_company || ''} {od.tracking_no}
                                  </div>
                                )}
                                {od.tx_hash && (
                                  <div className="max-w-[200px] truncate font-mono text-[10px] text-slate-400" title={od.tx_hash}>tx {od.tx_hash}</div>
                                )}
                                {canCancel && (
                                  <button onClick={() => handleCancelMyOrder(od.order_id)}
                                    className="rounded-lg bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700 hover:bg-rose-200">주문 취소하기</button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
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
                  { key: 'register', label: '➕ 상품 등록',       desc: '새 상품을 등록해 판매를 시작하세요' },
                  { key: 'mine',     label: '📋 내 판매 관리',    desc: '등록 현황·주문·지갑 상태 확인' },
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

            {/* 내 판매 관리 탭: 판매 현황 + 지표 + 내 요청 현황 */}
            <div className={`${sellTab === 'mine' ? 'block' : 'hidden'} space-y-6`}>
              {/* ✨ Patch v15.1: 내 판매 관리 서브탭 바 */}
              <div className="flex gap-2 rounded-2xl bg-slate-100/80 p-1">
                <button
                  onClick={() => setMineSubTab('requests')}
                  className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition ${mineSubTab === 'requests' ? 'bg-white text-violet-700 shadow-md' : 'text-slate-600 hover:text-slate-900'}`}
                >📄 내 등록 상품</button>
                <button
                  onClick={() => { setMineSubTab('incoming_orders'); if (address) loadMySellOrders() }}
                  className={`flex-1 rounded-xl px-4 py-2 text-sm font-bold transition ${mineSubTab === 'incoming_orders' ? 'bg-white text-violet-700 shadow-md' : 'text-slate-600 hover:text-slate-900'}`}
                >📦 받은 주문 {mySellOrders.length > 0 && (<span className="ml-1 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] text-white">{mySellOrders.length}</span>)}</button>
              </div>

              {/* ✨ Patch v15.1: 판매자 들어온 주문 관리 UI */}
              {mineSubTab === 'incoming_orders' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-black text-slate-800">📦 받은 주문 관리</h3>
                    <button onClick={() => loadMySellOrders()}
                      className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200">🔄 새로고침</button>
                  </div>
                  {!isConnected && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">지갑을 먼저 연결해 주세요.</div>
                  )}
                  {isConnected && mySellOrdersLoading && (
                    <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-center text-sm text-slate-500">주문 내역을 불러오는 중...</div>
                  )}
                  {isConnected && !mySellOrdersLoading && mySellOrders.length === 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-center text-sm text-slate-500">아직 들어온 주문이 없어요.</div>
                  )}
                  {isConnected && !mySellOrdersLoading && mySellOrders.length > 0 && (
                    <div className="grid gap-4">
                      {mySellOrders.map((od) => {
                        const statusColor: Record<string,string> = {
                          pending: 'bg-amber-100 text-amber-700',
                          confirmed: 'bg-sky-100 text-sky-700',
                          reserved: 'bg-violet-100 text-violet-700',
                          shipped: 'bg-indigo-100 text-indigo-700',
                          delivered: 'bg-emerald-100 text-emerald-700',
                          completed: 'bg-emerald-100 text-emerald-700',
                          cancelled: 'bg-rose-100 text-rose-700',
                          sent: 'bg-emerald-100 text-emerald-700',
                        }
                        const statusLabel: Record<string,string> = {
                          pending: '결제 대기', confirmed: '결제 완료', reserved: '예약 완료',
                          shipped: '배송 중', delivered: '배송 완료', completed: '구매 완료',
                          cancelled: '주문 취소', sent: '전송 완료',
                        }
                        const pt = od.product_type || 'physical'
                        const typeEmoji: Record<string,string> = { physical: '📦', service: '📅', food: '🍽', digital: '💾' }
                        const di = (od.delivery_info || {}) as Record<string, unknown>
                        const trk = orderTrackingInputs[od.order_id] || { company: od.tracking_company || '', no: od.tracking_no || '' }
                        return (
                          <div key={od.order_id} className="rounded-2xl border border-purple-200 bg-white/90 p-4 shadow-sm space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                {od.product_image_url ? (
                                  <img src={od.product_image_url} alt="" className="h-16 w-16 rounded-xl object-cover" />
                                ) : (
                                  <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-2xl">{typeEmoji[pt]}</div>
                                )}
                                <div>
                                  <div className="text-xs text-slate-500">{new Date(od.ordered_at).toLocaleString('ko-KR')}</div>
                                  <div className="text-base font-black text-slate-800">{od.product_title || '상품명 없음'}</div>
                                  <div className="mt-0.5 text-xs text-slate-600">수량 {od.quantity} {od.variant_sku ? `· ${od.variant_sku}` : ''}</div>
                                  <div className="mt-0.5 font-mono text-[10px] text-slate-500" title={od.buyer_wallet}>구매자 {od.buyer_wallet?.slice(0,6)}...{od.buyer_wallet?.slice(-4)}</div>
                                </div>
                              </div>
                              <span className={`rounded-full px-3 py-1 text-xs font-bold ${statusColor[od.status] || 'bg-slate-100 text-slate-700'}`}>
                                {typeEmoji[pt]} {statusLabel[od.status] || od.status}
                              </span>
                            </div>

                            {/* 배송 정보 노출 */}
                            {Object.keys(di).length > 0 && (
                              <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs text-slate-700">
                                <div className="mb-1 font-bold text-sky-700">📍 수령 정보</div>
                                {di.address != null && <div>주소: {String(di.address)}</div>}
                                {di.phone != null && <div>연락처: {String(di.phone)}</div>}
                                {di.email != null && <div>이메일: {String(di.email)}</div>}
                                {di.date != null && <div>예약일: {String(di.date)}</div>}
                                {di.time != null && <div>시간: {String(di.time)}</div>}
                                {di.method != null && <div>방식: {String(di.method)}</div>}
                                {di.note != null && <div>요청: {String(di.note)}</div>}
                              </div>
                            )}

                            {/* 유형별 상태 변경 버튼 */}
                            <div className="flex flex-wrap gap-2 pt-1">
                              {pt === 'physical' && (
                                <>
                                  {od.status === 'confirmed' && (
                                    <>
                                      <input type="text" placeholder="택배사"
                                        value={trk.company}
                                        onChange={(e) => setOrderTrackingInputs((p) => ({ ...p, [od.order_id]: { ...trk, company: e.target.value } }))}
                                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs w-24" />
                                      <input type="text" placeholder="운송장 번호"
                                        value={trk.no}
                                        onChange={(e) => setOrderTrackingInputs((p) => ({ ...p, [od.order_id]: { ...trk, no: e.target.value } }))}
                                        className="rounded-lg border border-slate-200 px-2 py-1 text-xs w-36" />
                                      <button onClick={() => handleUpdateOrderStatus(od.order_id, 'shipped', { tracking_company: trk.company, tracking_no: trk.no })}
                                        disabled={!trk.no}
                                        className="rounded-lg bg-indigo-500 px-3 py-1 text-xs font-bold text-white disabled:opacity-40">배송 시작</button>
                                    </>
                                  )}
                                  {od.status === 'shipped' && (
                                    <button onClick={() => handleUpdateOrderStatus(od.order_id, 'delivered')}
                                      className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-bold text-white">배송 완료</button>
                                  )}
                                  {od.status === 'delivered' && (
                                    <button onClick={() => handleUpdateOrderStatus(od.order_id, 'completed')}
                                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white">거래 완료</button>
                                  )}
                                </>
                              )}
                              {pt === 'service' && od.status === 'confirmed' && (
                                <button onClick={() => handleUpdateOrderStatus(od.order_id, 'reserved')}
                                  className="rounded-lg bg-violet-500 px-3 py-1 text-xs font-bold text-white">예약 확정 + 이메일 안내</button>
                              )}
                              {pt === 'food' && od.status === 'confirmed' && (
                                <button onClick={() => handleUpdateOrderStatus(od.order_id, 'reserved')}
                                  className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-white">수령 확정 + 이메일 안내</button>
                              )}
                              {pt === 'digital' && od.status === 'confirmed' && (
                                <button onClick={() => handleUpdateOrderStatus(od.order_id, 'sent')}
                                  className="rounded-lg bg-emerald-500 px-3 py-1 text-xs font-bold text-white">전송 완료</button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {/* ✨ Patch v16.2: 판매자 예약 캠린더 */}
                  <div className="mt-6 rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-lg font-black text-violet-700">📅 서비스 예약 캠린더 (향후 60일)</h3>
                      <button onClick={() => loadSellerSlots()}
                        className="rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-violet-700 hover:bg-violet-100">🔄 새로고침</button>
                    </div>
                    {sellerSlotsLoading ? (
                      <div className="text-center text-sm text-slate-500 py-4">로드 중...</div>
                    ) : sellerSlots.length === 0 ? (
                      <div className="text-center text-sm text-slate-500 py-4">예정된 서비스 예약이 없습니다.</div>
                    ) : (
                      <div className="space-y-2">
                        {(() => {
                          // 날짜별 그룹
                          const byDate: Record<string, typeof sellerSlots> = {}
                          for (const s of sellerSlots) {
                            (byDate[s.reserved_date] = byDate[s.reserved_date] || []).push(s)
                          }
                          return Object.entries(byDate).map(([date, slots]) => (
                            <div key={date} className="rounded-xl bg-white/80 p-3">
                              <div className="mb-2 text-sm font-black text-slate-700">📆 {date} <span className="text-slate-400 font-normal">({slots.length}건)</span></div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {slots.map((s) => (
                                  <div key={s.id} className={`rounded-lg border px-3 py-2 text-xs ${s.status === 'confirmed' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                    <div className="flex items-center justify-between">
                                      <span className="font-black text-slate-800">⏰ {s.reserved_time.slice(0,5)}</span>
                                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${s.status === 'confirmed' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-white'}`}>
                                        {s.status === 'confirmed' ? '확정' : '결제 대기'}
                                      </span>
                                    </div>
                                    <div className="mt-1 truncate font-semibold text-slate-600">{s.product_title}</div>
                                    <div className="mt-0.5 font-mono text-[10px] text-slate-500">구매자 {s.buyer_wallet?.slice(0,6)}...{s.buyer_wallet?.slice(-4)}</div>
                                    {s.buyer_email && <div className="text-[10px] text-slate-500">📧 {s.buyer_email}</div>}
                                    {s.buyer_phone && <div className="text-[10px] text-slate-500">📞 {s.buyer_phone}</div>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ✨ Patch v15.1: 기존 '내 등록 상품 현황' 본문은 mineSubTab==='requests'일 때만 노출 */}
              <div className={mineSubTab === 'requests' ? 'block space-y-6' : 'hidden'}>
              <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                <h2 className="text-2xl font-semibold">판매 현황</h2>
                <p className="mt-3 text-sm text-slate-700">
                  지갑 주소 상태와 판매 가능 상태를 한눈에 확인하세요.
                </p>

                <div className="mt-6 space-y-4 rounded-2xl bg-white/78 backdrop-blur-xl border border-purple-300/60 shadow-xl shadow-purple-200/50 p-5 text-sm text-slate-800">
                  <div className="flex justify-between gap-4">
                    <span>지갑 연결</span>
                    <span>{isConnected ? '연결 완료' : '연결 필요'}</span>
                  </div>

                  <div className="flex justify-between gap-4">
                    <span>지갑 주소</span>
                    <span className="max-w-[220px] truncate">{address ?? '-'}</span>
                  </div>

                  {/* ✨ Patch v1: 관리자 권한는 관리자에게만 노출 */}
                  {isAdmin && (
                    <div className="flex justify-between gap-4">
                      <span>관리자 권한</span>
                      <span className="text-purple-300">관리자 ✓</span>
                    </div>
                  )}

                  <div className="flex justify-between gap-4">
                    <span>판매 가능 상태</span>
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
                <h2 className="text-2xl font-semibold">판매 요약</h2>
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

              {/* ✨ Patch v1: 내 등록 상품 현황 - 반려 사유 표시 포함 */}
              <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                <h2 className="text-2xl font-semibold">내 등록 상품 현황</h2>
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
                            {(() => {
                              const labelMap: Record<string,string> = { Pending: '심사 대기', Approved: '판매 중', Rejected: '반려', SoldOut: '품절', Paused: '일시중지' }
                              return labelMap[request.status] || request.status
                            })()}
                          </div>
                        </div>

                        <div className="mt-3 text-sm text-slate-700">
                          가격 {request.priceUsdt} USDT / 재고 {request.stock}개
                        </div>

                        <div className="mt-2 text-xs text-slate-600">
                          요청 시각: {request.createdAt || '-'}
                        </div>

                        {/* ✨ Patch v1: 반려 사유 표시 */}
                        {request.status === 'Rejected' && request.rejectionReason && (
                          <div className="mt-4 rounded-xl border border-red-500/30 bg-gradient-to-r from-pink-500 to-rose-400 shadow-md shadow-pink-500/40/10 p-4">
                            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-red-300">
                              <span>⚠️</span>
                              <span>반려 사유 (관리자 메시지)</span>
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
                              ✏️ 수정하기
                            </button>
                            <button
                              onClick={() => handleSellerDeleteProduct(request.id, request.title)}
                              disabled={actionLoading}
                              className="rounded-xl bg-gradient-to-r from-red-500 to-pink-500 px-3 py-2 text-xs font-semibold text-white hover:from-red-600 hover:to-pink-600 disabled:opacity-50 transition"
                            >
                              🗑 삭제하기
                            </button>
                            {request.status === 'Rejected' && (
                              <span className="self-center text-xs text-slate-600">
                                수정하면 다시 심사 대기로 돌아가요
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
            </div>

            {/* 상품 등록 탭 */}
            <div className={`${sellTab === 'register' ? 'block' : 'hidden'} space-y-6`}>
              <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                <h2 className="text-2xl font-semibold">상품 등록</h2>
                <p className="mt-3 text-sm text-slate-700">
                  판매자가 관리자 승인을 요청하기 전에 작성하는 등록 양식
                </p>

                <div className="mt-6 space-y-4">
                  <div>
                    <label className="mb-2 block text-sm text-slate-800">상품명</label>
                    <input
                      value={productTitle}
                      onChange={(e) => setProductTitle(e.target.value)}
                      placeholder="예) 오버사이즈 면 후드티"
                      className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-slate-800">상품 설명</label>
                    <textarea
                      value={productDescription}
                      onChange={(e) => setProductDescription(e.target.value)}
                      placeholder="소재, 사이즈, 배송 정보, 주의사항 등을 자세히 적어주세요."
                      rows={5}
                      className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                    />
                  </div>

                  {/* ✨ Patch v9.0: 상품 유형 선택 (4종 탭) */}
                  <div>
                    <label className="mb-2 block text-sm text-slate-800">상품 유형</label>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {([
                        { key: 'physical', label: '📦 실물 상품', desc: '의류·신발·액세서리' },
                        { key: 'service',  label: '💅 서비스 예약', desc: '네일·마사지·피부 관리 등' },
                        { key: 'food',     label: '🍱 음식 주문', desc: '매장 방문·픽업·배달' },
                        { key: 'digital',  label: '💻 디지털 상품',   desc: '이메일로 바로 전송' },
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
                            ⚠️ 선택한 유형(<b>{productType}</b>)에 등록된 카테고리가 없어요. 다른 유형으로 바꾸거나 관리자에게 카테고리 추가를 요청하세요.
                          </div>
                        )}
                      </>
                    )}
                    <p className="mt-2 text-[11px] text-slate-500">
                      카테고리 목록은 관리자가 직접 관리합니다.
                    </p>
                    {categoriesDebug && (
                      <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                        🔎 진단: {categoriesDebug}
                      </div>
                    )}
                  </div>

                  {/* ✨ Patch v9.0: 유형별 추가 필드 */}
                  {productType === 'physical' && (
                    <div className="grid gap-4">
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
                      {/* ✨ Patch v16.1: 사이즈 가이드 */}
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">📏 사이즈 가이드 (구매자에게 보여집니다)</label>
                        <textarea
                          value={extraSizeGuide}
                          onChange={(e) => setExtraSizeGuide(e.target.value)}
                          rows={4}
                          placeholder={'예:\nS: 가슴 90-95 / 어깨 42\nM: 가슴 95-100 / 어깨 44\nL: 가슴 100-105 / 어깨 46\n\n읊 경우 치수표, 신발은 mm 단위 길이, 모자는 머리 둘레 등 상세히 상담하세요.'}
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm font-mono"
                        />
                      </div>
                    </div>
                  )}

                  {productType === 'service' && (
                    <div className="grid gap-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm text-slate-800">서비스 시간 (분)</label>
                          <input
                            type="number"
                            value={extraDurationMinutes}
                            onChange={(e) => setExtraDurationMinutes(e.target.value)}
                            placeholder="예: 60"
                            className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm text-slate-800">예약 여부</label>
                          <div className="flex items-center gap-2 rounded-xl border border-purple-200/80 bg-white/90 px-4 py-3">
                            <input
                              id="reservationRequired"
                              type="checkbox"
                              checked={extraReservationRequired}
                              onChange={(e) => setExtraReservationRequired(e.target.checked)}
                              className="h-4 w-4 accent-fuchsia-500"
                            />
                            <label htmlFor="reservationRequired" className="text-sm text-slate-800 cursor-pointer">
                              예약제로 운영합니다
                            </label>
                          </div>
                        </div>
                      </div>
                      {/* ✨ Patch v16.1: 서비스 운영 정보 */}
                      <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/40 p-4 space-y-3">
                        <div className="text-sm font-black text-violet-700">📝 운영 정보 (구매자에게 보여집니다)</div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">📍 서비스 장소 주소 <span className="text-red-500">*</span></label>
                          <input
                            value={extraServiceAddress}
                            onChange={(e) => setExtraServiceAddress(e.target.value)}
                            placeholder="예: 서울시 강남구 논현로 12, 3층"
                            className="w-full rounded-xl bg-white border border-violet-200 px-4 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">⏰ 운영 시간 <span className="text-red-500">*</span></label>
                          <input
                            value={extraServiceOpenHours}
                            onChange={(e) => setExtraServiceOpenHours(e.target.value)}
                            placeholder="예: 평일 09:00 - 18:00 / 토 10:00 - 17:00"
                            className="w-full rounded-xl bg-white border border-violet-200 px-4 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-700">🚫 휴무일 / 공휴일 안내</label>
                          <input
                            value={extraServiceHolidays}
                            onChange={(e) => setExtraServiceHolidays(e.target.value)}
                            placeholder="예: 일요일 휴무 / 모든 공휴일 휴무"
                            className="w-full rounded-xl bg-white border border-violet-200 px-4 py-2 text-sm"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {productType === 'food' && (
                    <div className="grid gap-4">
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">📍 매장 위치 <span className="text-red-500">*</span></label>
                        <input
                          value={extraShopAddress}
                          onChange={(e) => setExtraShopAddress(e.target.value)}
                          placeholder="예: 서울시 강남구 논현로 12"
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">⏰ 영업 시간 <span className="text-red-500">*</span></label>
                        <input
                          value={extraOpenHours}
                          onChange={(e) => setExtraOpenHours(e.target.value)}
                          placeholder="예: 평일 11:00 - 22:00 / 주말 휴무"
                          className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm"
                        />
                      </div>
                      {/* ✨ Patch v16.1: 휴무일 */}
                      <div>
                        <label className="mb-2 block text-sm text-slate-800">🚫 휴무일 / 공휴일 안내</label>
                        <input
                          value={extraFoodHolidays}
                          onChange={(e) => setExtraFoodHolidays(e.target.value)}
                          placeholder="예: 매주 월요일 휴무 / 공휴일 휴무"
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
                      상품 대표 사진 <span className="text-xs text-slate-600">(선택, 최대 5MB)</span>
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
                            <div className="mt-2">클릭하여 사진 올리기</div>
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
                {/* ✨ Patch v15.2: 관리자 서브탭 바 */}
                <div className="flex flex-wrap gap-2 rounded-2xl bg-slate-100/80 p-1">
                  {([
                    { key: 'review',     label: '📝 신청 심사' },
                    { key: 'rejected',   label: '❌ 반려 상품' },
                    { key: 'categories', label: '📂 카테고리' },
                    { key: 'mail',       label: '📨 알림 메일' },
                    { key: 'settings',   label: '⚙️ 스토어 설정' },
                  ] as const).map((t) => (
                    <button key={t.key}
                      onClick={() => setAdminSubTab(t.key as typeof adminSubTab)}
                      className={`flex-1 min-w-[120px] rounded-xl px-4 py-2 text-sm font-bold transition ${adminSubTab === t.key ? 'bg-white text-violet-700 shadow-md' : 'text-slate-600 hover:text-slate-900'}`}
                    >{t.label}</button>
                  ))}
                </div>

                {/* ✨ Patch v16.0: 거절된 상품 전용 부탭 */}
                {adminSubTab === 'rejected' && (
                  <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-rose-300/70 shadow-2xl shadow-rose-200/60 p-8 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-black text-rose-700">❌ 반려 상품 목록</h2>
                      <button onClick={() => fetchSellData()}
                        className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200">🔄 새로고침</button>
                    </div>
                    <p className="text-xs text-slate-500">반려 사유는 판매자에게 자동으로 전달돼요. 판매자는 직접 삭제하거나 수정해 다시 신청할 수 있습니다.</p>
                    {(() => {
                      const rejectedList = requests.filter((r) => r.status === 'Rejected')
                      if (rejectedList.length === 0) {
                        return (
                          <div className="rounded-2xl border border-slate-200 bg-white/70 p-8 text-center text-sm text-slate-500">
                            🎉 현재 반려된 상품이 없습니다.
                          </div>
                        )
                      }
                      return (
                        <div className="grid gap-3">
                          {rejectedList.map((r) => (
                            <div key={r.id} className="rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="flex-1">
                                  <div className="text-xs text-slate-500">{r.category}</div>
                                  <div className="text-lg font-black text-slate-800">{r.title}</div>
                                  <div className="mt-1 font-mono text-[10px] text-slate-500" title={r.seller}>
                                    판매자 {r.seller?.slice(0,6)}...{r.seller?.slice(-4)}
                                  </div>
                                  {r.rejectionReason && (
                                    <div className="mt-2 rounded-xl border border-rose-300 bg-white/80 p-3">
                                      <div className="text-xs font-bold text-rose-700">반려 사유</div>
                                      <div className="mt-1 text-sm text-slate-700 whitespace-pre-wrap">{r.rejectionReason}</div>
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-col gap-2">
                                  <button
                                    onClick={() => handleUpdateRequestStatus(r.id, 'Pending', 'Rejected')}
                                    disabled={actionLoading}
                                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-600 disabled:opacity-40"
                                  >🔄 다시 심사 대기</button>
                                  <button
                                    onClick={() => handleUpdateRequestStatus(r.id, 'Approved', 'Rejected')}
                                    disabled={actionLoading}
                                    className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-40"
                                  >✅ 바로 승인</button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* ✨ Patch v15.2: 카테고리 관리 부탭 */}
                {adminSubTab === 'categories' && (
                  <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8 space-y-5">
                    <div className="flex items-center justify-between">
                      <h2 className="text-2xl font-black">📂 카테고리</h2>
                      <button onClick={() => loadAdminCategories()}
                        className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200">🔄 새로고침</button>
                    </div>
                    <p className="text-xs text-slate-500">판매자가 선택할 수 있는 카테고리입니다. 비활성화하면 새 등록 폼에 나타나지 않아요.</p>

                    {/* 추가 폼 */}
                    <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
                      <div className="text-sm font-black text-violet-700">➕ 카테고리 추가</div>
                      <div className="grid gap-3 md:grid-cols-4">
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">유형 <span className="text-red-500">*</span></span>
                          <select value={newCategoryType} onChange={(e) => setNewCategoryType(e.target.value as typeof newCategoryType)}
                            className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm">
                            <option value="physical">📦 실물 상품</option>
                            <option value="service">📅 서비스예약</option>
                            <option value="food">🍽 음식매장</option>
                            <option value="digital">💾 디지털</option>
                          </select>
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">코드 <span className="text-red-500">*</span></span>
                          <input type="text" value={newCategoryCode} onChange={(e) => setNewCategoryCode(e.target.value)}
                            placeholder="예) jacket" className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">이름 <span className="text-red-500">*</span></span>
                          <input type="text" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)}
                            placeholder="예) 재킷" className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">이모지</span>
                          <input type="text" value={newCategoryEmoji} onChange={(e) => setNewCategoryEmoji(e.target.value)}
                            placeholder="🧥" className="rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm" />
                        </label>
                      </div>
                      <button onClick={handleAddCategory}
                        disabled={!newCategoryCode.trim() || !newCategoryName.trim()}
                        className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-black text-white shadow disabled:opacity-40">추가</button>
                    </div>

                    {/* 목록 */}
                    {adminCategoriesLoading ? (
                      <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-center text-sm text-slate-500">로드 중...</div>
                    ) : adminCategories.length === 0 ? (
                      <div className="rounded-2xl border border-slate-200 bg-white/70 p-6 text-center text-sm text-slate-500">등록된 카테고리가 없어요.</div>
                    ) : (
                      <div className="space-y-2">
                        {(['physical','service','food','digital'] as const).map((pt) => {
                          const items = adminCategories.filter((c) => c.product_type === pt)
                          if (items.length === 0) return null
                          const typeLabel: Record<string,string> = { physical: '📦 실물 상품', service: '📅 서비스예약', food: '🍽 음식매장', digital: '💾 디지털' }
                          return (
                            <div key={pt} className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                              <div className="mb-3 text-sm font-black text-slate-700">{typeLabel[pt]} <span className="text-slate-400">({items.length})</span></div>
                              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                                {items.map((c) => (
                                  <div key={c.code} className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm ${c.is_active ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-slate-50 opacity-70'}`}>
                                    <div className="flex items-center gap-2">
                                      <span className="text-lg">{c.emoji || '🏷️'}</span>
                                      <div>
                                        <div className="font-bold text-slate-800">{c.name_ko}</div>
                                        <div className="text-[10px] font-mono text-slate-400">{c.code}</div>
                                      </div>
                                    </div>
                                    <div className="flex gap-1">
                                      <button onClick={() => handleToggleCategoryActive(c.code, !c.is_active)}
                                        className={`rounded-lg px-2 py-1 text-xs font-bold ${c.is_active ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}>
                                        {c.is_active ? '비활성' : '활성'}
                                      </button>
                                      <button onClick={() => handleDeleteCategory(c.code, c.name_ko)}
                                        className="rounded-lg bg-rose-100 px-2 py-1 text-xs font-bold text-rose-700 hover:bg-rose-200">삭제</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ✨ Patch v15.2: 이메일 큐 부탭 */}
                {adminSubTab === 'mail' && (
                  <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8 space-y-4">
                    <h2 className="text-2xl font-black">📨 알림 메일 수동 처리</h2>
                    <p className="text-sm text-slate-600">
                      판매 승인·주문 확정 시 자동으로 쌓이는 알림 메일을 즉시 발송할 수 있어요.<br/>
                      평소에는 자동으로 보내지지만, 빠른 전송이 필요할 때 사용하세요.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <button onClick={handleProcessEmailQueue}
                        className="rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-2 text-sm font-black text-white shadow-lg">📤 지금 바로 보내기</button>
                      <button onClick={handleManualCleanup}
                        className="rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 px-4 py-2 text-sm font-black text-white shadow-lg">⏰ 만료 주문 정리</button>
                    </div>
                    <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs text-slate-600">
                      💡 Resend API 키가 .env.local에 설정돼 있어야 상신 발송됩니다 (<code>RESEND_API_KEY</code>).
                    </div>
                  </div>
                )}

                {/* ✨ Patch v15.2: 설정 부탭 placeholder */}
                {adminSubTab === 'settings' && (
                  <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8 text-sm text-slate-600">
                    설정 부탭은 아래 기존 관리자 영역에서 이용 가능합니다. (Prime 정책, Marketplace 설정, 프로필 동기화 등)
                  </div>
                )}

                {/* ✨ Patch v15.2: review 부탭일 때만 기존 '검수 및 공개 목록' 노출 */}
                <div className={adminSubTab === 'review' ? 'block space-y-6' : 'hidden'}>
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8 border-l-4 border-purple-500">
                  <div className="mb-4 inline-block rounded-full bg-gradient-to-r from-purple-500 to-pink-400 shadow-md shadow-purple-500/30 px-3 py-1 text-xs font-bold text-white">
                    👑 ADMIN ONLY
                  </div>
                  <h2 className="text-2xl font-semibold">판매 신청 심사</h2>
                  <p className="mt-3 text-sm text-slate-700">
                    새로 등록된 상품을 검토하고 승인·반려할 수 있어요.
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
                            {/* ✨ Patch v18.0: 심사 카드 상품 이미지 썰네일 */}
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              {request.imageUrl ? (
                                <img
                                  src={request.imageUrl}
                                  alt={request.title}
                                  className="h-20 w-20 flex-shrink-0 rounded-xl object-cover border border-slate-200 cursor-pointer hover:scale-105 transition"
                                  onClick={() => window.open(request.imageUrl, '_blank')}
                                  title="클릭하면 원본 사진 보기"
                                />
                              ) : (
                                <div className="h-20 w-20 flex-shrink-0 rounded-xl bg-slate-100 flex items-center justify-center text-3xl">📷</div>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-slate-700">{request.category}</div>
                                <div className="mt-1 text-lg font-bold text-slate-900 truncate">
                                  {request.title}
                                </div>
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
                              {(() => {
                              const labelMap: Record<string,string> = { Pending: '심사 대기', Approved: '판매 중', Rejected: '반려', SoldOut: '품절', Paused: '일시중지' }
                              return labelMap[request.status] || request.status
                            })()}
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
                              <div className="mb-1 text-xs font-bold text-red-300">반려 사유</div>
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
                              반려
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
                              심사대기로
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* 상품 수정 / 삭제 */}
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                  <h2 className="text-2xl font-semibold">상품 수정 / 삭제</h2>
                  <p className="mt-3 text-sm text-slate-700">판매 중인 상품의 정보를 수정하거나 삭제합니다</p>
                  <div className="mt-6 space-y-4">
                    <input value={editProductId} onChange={(e) => setEditProductId(e.target.value)} placeholder="Product ID" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="상품명" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} placeholder="설명" rows={3} className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={editCategory} onChange={(e) => setEditCategory(e.target.value)} placeholder="카테고리" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <div className="grid grid-cols-2 gap-3">
                      <input value={editPriceUsdt} onChange={(e) => setEditPriceUsdt(e.target.value)} placeholder="USDT 가격" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                      <input value={editStock} onChange={(e) => setEditStock(e.target.value)} placeholder="재고" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    </div>
                    <input value={editImageUrl} onChange={(e) => setEditImageUrl(e.target.value)} placeholder="이미지 URL" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={deleteStoragePath} onChange={(e) => setDeleteStoragePath(e.target.value)} placeholder="Storage Path (삭제용)" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={handleSaveProduct} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 text-white shadow-lg shadow-sky-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-sky-300/70 transition-all duration-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">수정 저장</button>
                    <button onClick={handleDeleteProductImage} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-orange-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white hover:from-orange-600 hover:to-pink-600 disabled:opacity-50 transition shadow-md">대표 사진 삭제</button>
                    <button onClick={handleDeleteProduct} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-red-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white hover:from-red-600 hover:to-pink-600 disabled:opacity-50 transition shadow-md">상품 삭제</button>
                  </div>
                </div>

                {/* 멤버십 정책 저장 */}
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                  <h2 className="text-2xl font-semibold">멤버십 정책 저장</h2>
                  <p className="mt-3 text-sm text-slate-700">운영용 Prime 정책을 DB에 저장하는 영역</p>
                  <div className="mt-6 space-y-3">
                    <input value={primePlanName} onChange={(e) => setPrimePlanName(e.target.value)} placeholder="플랜 이름" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={primeMonthlyPriceUsdt} onChange={(e) => setPrimeMonthlyPriceUsdt(e.target.value)} placeholder="월 요금 USDT" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={primeDao2PassRequirement} onChange={(e) => setPrimeDao2PassRequirement(e.target.value)} placeholder="DAO2 Pass 요건" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <textarea value={primeBenefitSummary} onChange={(e) => setPrimeBenefitSummary(e.target.value)} placeholder="혜택 요약" rows={3} className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <textarea value={primePolicyMemo} onChange={(e) => setPrimePolicyMemo(e.target.value)} placeholder="정책 메모" rows={4} className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={handleSavePrimeSettings} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-lg shadow-pink-300/60 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-pink-300/70 transition-all duration-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">멤버십 정책 저장</button>
                  </div>
                </div>

                {/* 스토어 설정 저장 */}
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                  <h2 className="text-2xl font-semibold">스토어 설정 저장</h2>
                  <p className="mt-3 text-sm text-slate-700">컨트랙트 주소, 수수료, 운영 지갑 등 설정 저장</p>
                  <div className="mt-6 grid gap-4 sm:grid-cols-2">
                    <input value={marketplaceAddressInput} onChange={(e) => setMarketplaceAddressInput(e.target.value)} placeholder="스토어 연결 주소 (0x...)" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={dao2TokenAddress} onChange={(e) => setDao2TokenAddress(e.target.value)} placeholder="DAO2 토큰 주소" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={configAdminWallet} onChange={(e) => setConfigAdminWallet(e.target.value)} placeholder="관리자 지갑" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={treasuryWallet} onChange={(e) => setTreasuryWallet(e.target.value)} placeholder="Treasury 지갑" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={configFeeBps} onChange={(e) => setConfigFeeBps(e.target.value)} placeholder="운영 수수료 (bps)" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={dao2PriceUsdt6} onChange={(e) => setDao2PriceUsdt6(e.target.value)} placeholder="DAO2 가격(usdt6)" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={storageMode} onChange={(e) => setStorageMode(e.target.value)} placeholder="storage mode" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                    <input value={settingsNotes} onChange={(e) => setSettingsNotes(e.target.value)} placeholder="운영 메모" className="w-full rounded-xl bg-white/90 border border-purple-200/80 text-slate-800 placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-200/60 px-4 py-3 text-sm" />
                  </div>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <button onClick={handleSaveMarketplaceSettings} disabled={actionLoading} className="rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-2 text-sm font-semibold text-white hover:from-emerald-600 hover:to-teal-600 disabled:opacity-50 transition shadow-md">스토어 설정 저장</button>
                  </div>
                </div>

                {/* 판매자 프로필 동기화 */}
                <div className="rounded-3xl bg-white/85 backdrop-blur-2xl border border-purple-300/70 shadow-2xl shadow-purple-200/60 p-8">
                  <h2 className="text-2xl font-semibold">판매자 프로필 동기화</h2>
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
              </div>
            )}

            {/* ✨ Patch v1: 관리자가 아닐 경우, 빈 공간 채우기 - 판매 시작 가이드 */}
            {!isAdmin && (
              <div className="space-y-6 xl:col-span-1">
                <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-blue-900/20 to-zinc-900/70 p-8 backdrop-blur">
                  <h2 className="text-2xl font-semibold">판매 시작 가이드</h2>
                  <p className="mt-3 text-sm text-slate-700">
                    WebKey Commerce에서 상품을 등록하고 판매하는 순서입니다.
                  </p>

                  <ol className="mt-6 space-y-4">
                    <li className="flex gap-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-purple-500 to-pink-400 shadow-md shadow-purple-500/40/20 text-sm font-bold text-cyan-300">
                        1
                      </span>
                      <div>
                        <div className="font-semibold text-white">지갑 연결 & 자격 확인</div>
                        <div className="mt-1 text-sm text-slate-700">
                          지갑을 연결하고 판매자 권한을 확인합니다.
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
                    💡 거절된 경우 왼쪽 "내 등록 상품 현황"에서 반려 사유를 확인할 수 있습니다.
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

      {/* ✨ Patch v18.0: 반려 사유 입력 모달 */}
      {rejectingId && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(8px)' }}
          onClick={cancelReject}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-200 px-6 py-4">
              <h3 className="text-xl font-black text-rose-700">❌ 판매 반려</h3>
              <p className="mt-1 text-xs text-slate-600">반려 사유는 판매자에게 자동 전달됩니다. 구체적으로 작성해 주세요.</p>
            </div>
            <div className="p-6 space-y-3">
              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">반려 사유 <span className="text-red-500">*</span></span>
                <textarea
                  value={rejectionReasonInput}
                  onChange={(e) => setRejectionReasonInput(e.target.value)}
                  rows={4}
                  placeholder="예) 상품 사진이 실제 상품과 일치하지 않습니다. / 불법 복제품으로 의심됩니다. / 상품 설명이 부족합니다."
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-rose-400 focus:ring-2 focus:ring-rose-200"
                  autoFocus
                />
              </label>
              {!rejectionReasonInput.trim() && (
                <div className="text-xs text-amber-700">⚠️ 사유를 입력해야 반려됩니다.</div>
              )}
            </div>
            <div className="flex gap-2 border-t border-slate-200 px-6 py-4">
              <button
                onClick={cancelReject}
                className="flex-1 rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200"
              >취소</button>
              <button
                onClick={confirmReject}
                disabled={!rejectionReasonInput.trim() || actionLoading}
                className="flex-1 rounded-xl bg-gradient-to-r from-rose-500 to-red-500 px-4 py-2.5 text-sm font-black text-white shadow-lg disabled:opacity-40 disabled:cursor-not-allowed hover:from-rose-600 hover:to-red-600"
              >
                {actionLoading ? '처리 중...' : '반려 확정'}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  <span className="font-semibold text-slate-600">개당 가격 (USDT 기준)</span>
                  <span className="font-bold text-slate-700">
                    {(() => {
                      const sel = buyingVariants.find((v) => v.id === selectedVariantId)
                      const base = Number(buyingItem.priceUsdt) || 0
                      const delta = sel ? Number(sel.price_usdt_delta) : 0
                      return `${(base + delta).toFixed(2)} USDT`
                    })()}
                  </span>
                </div>
                {/* ✨ Patch v16.0 / v17.0 / v18.0: DAO2 환산 실시간 표시 (폴백 포함) */}
                <div className="rounded-xl bg-gradient-to-r from-violet-50 to-fuchsia-50 border border-violet-200 px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-violet-700">💰 결제 금액 (DAO2 토큰)</span>
                    <span className="text-lg font-black bg-gradient-to-r from-violet-600 via-fuchsia-600 to-pink-500 bg-clip-text text-transparent">
                      {quoteDao2Loading && !quoteIsFallback
                        ? '계산 중...'
                        : quoteDao2Amount != null
                        ? `${(Number(quoteDao2Amount) / 1e18).toFixed(4)} DAO2`
                        : '지갑 승인 시 표시'}
                    </span>
                  </div>
                  {quoteIsFallback && (
                    <div className="mt-1 text-[10px] text-amber-700">
                      ⚠️ 추정 가격입니다. 실제 결제 금액은 지갑 승인 시 표시되는 값이 정확합니다.
                    </div>
                  )}
                  {quoteHasError && !quoteIsFallback && (
                    <div className="mt-1 text-[10px] text-rose-700">
                      ⚠️ 미리보기 조회 실패. 구매 진행은 가능하며 지갑에서 정확한 금액을 확인하세요.
                    </div>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 text-right">
                  수량 × {buyQuantity}개 기준
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

              {/* ✨ Patch v16.1: 판매자 운영 정보 / 사이즈 가이드 표시 */}
              {(() => {
                const meta = (buyingItem.metadataExtra || {}) as Record<string, unknown>
                const pt = buyingItem.productType || 'physical'
                const hasSellerInfo =
                  (pt === 'service' && (meta.service_address || meta.open_hours || meta.holidays)) ||
                  (pt === 'food' && (meta.shop_address || meta.open_hours || meta.holidays)) ||
                  (pt === 'physical' && meta.size_guide)
                if (!hasSellerInfo) return null
                return (
                  <div className="mt-5 rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4 space-y-2">
                    {pt === 'physical' && meta.size_guide ? (
                      <>
                        <div className="text-sm font-black text-violet-700">📏 사이즈 가이드</div>
                        <pre className="whitespace-pre-wrap rounded-xl bg-white/80 p-3 text-xs font-mono text-slate-700">{String(meta.size_guide)}</pre>
                      </>
                    ) : (
                      <>
                        <div className="text-sm font-black text-violet-700">👤 판매자 운영 정보</div>
                        {(meta.service_address || meta.shop_address) && (
                          <div className="flex gap-2 text-xs"><span className="font-bold text-slate-600 w-16">📍 주소</span><span className="text-slate-800">{String(meta.service_address || meta.shop_address)}</span></div>
                        )}
                        {meta.open_hours != null && (
                          <div className="flex gap-2 text-xs"><span className="font-bold text-slate-600 w-16">⏰ 운영</span><span className="text-slate-800">{String(meta.open_hours)}</span></div>
                        )}
                        {meta.holidays != null && (
                          <div className="flex gap-2 text-xs"><span className="font-bold text-slate-600 w-16">🚫 휴무</span><span className="text-slate-800">{String(meta.holidays)}</span></div>
                        )}
                      </>
                    )}
                  </div>
                )
              })()}

              {/* ✨ Patch v15.1: 유형별 배송 정보 입력 UI */}
              {(() => {
                const pt = (buyingItem.productType || 'physical') as 'physical'|'service'|'food'|'digital'
                const titleMap: Record<string,string> = {
                  physical: '📦 배송 정보',
                  service: '📅 예약 정보',
                  food: '🍽 음식 수령 정보',
                  digital: '📧 수령 이메일',
                }
                return (
                  <div className="mt-5 rounded-2xl border border-sky-200/80 bg-white/85 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-black text-slate-800">{titleMap[pt]}</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-sky-600">v15.1</span>
                    </div>
                    {pt === 'physical' && (
                      <>
                        {/* ✨ Patch v17.0: 구매자 사이즈/색상 선택 */}
                        {(() => {
                          const metaP = (buyingItem.metadataExtra || {}) as Record<string, unknown>
                          const sellerSizes = metaP.size ? String(metaP.size).split('/').map((s) => s.trim()).filter(Boolean) : []
                          const sellerColors = metaP.color ? String(metaP.color).split('/').map((s) => s.trim()).filter(Boolean) : []
                          return (
                            <>
                              {sellerSizes.length > 0 && (
                                <label className="grid gap-1">
                                  <span className="text-xs font-semibold text-slate-600">사이즈 선택 <span className="text-red-500">*</span></span>
                                  <div className="flex flex-wrap gap-2">
                                    {sellerSizes.map((sz) => (
                                      <button key={sz} type="button"
                                        onClick={() => setBuyOptionSize(sz)}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition ${buyOptionSize === sz ? 'border-sky-500 bg-sky-100 text-sky-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                                        {sz}
                                      </button>
                                    ))}
                                  </div>
                                </label>
                              )}
                              {sellerSizes.length === 0 && (
                                <label className="grid gap-1">
                                  <span className="text-xs font-semibold text-slate-600">사이즈 입력</span>
                                  <input type="text" value={buyOptionSize} onChange={(e) => setBuyOptionSize(e.target.value)}
                                    placeholder="예) M / 270mm / Free"
                                    className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                                </label>
                              )}
                              {sellerColors.length > 0 && (
                                <label className="grid gap-1">
                                  <span className="text-xs font-semibold text-slate-600">색상 선택</span>
                                  <div className="flex flex-wrap gap-2">
                                    {sellerColors.map((co) => (
                                      <button key={co} type="button"
                                        onClick={() => setBuyOptionColor(co)}
                                        className={`rounded-lg px-3 py-1.5 text-xs font-bold border transition ${buyOptionColor === co ? 'border-violet-500 bg-violet-100 text-violet-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                                        {co}
                                      </button>
                                    ))}
                                  </div>
                                </label>
                              )}
                              {sellerColors.length === 0 && (
                                <label className="grid gap-1">
                                  <span className="text-xs font-semibold text-slate-600">색상 (선택)</span>
                                  <input type="text" value={buyOptionColor} onChange={(e) => setBuyOptionColor(e.target.value)}
                                    placeholder="예) 검정 / 화이트"
                                    className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                                </label>
                              )}
                            </>
                          )
                        })()}
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">받으실 주소 <span className="text-red-500">*</span></span>
                          <input type="text" value={buyDeliveryAddress} onChange={(e) => setBuyDeliveryAddress(e.target.value)}
                            placeholder="예) 서울시 강남구 ..."
                            className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">연락처 <span className="text-red-500">*</span></span>
                          <input type="tel" value={buyDeliveryPhone} onChange={(e) => setBuyDeliveryPhone(e.target.value)}
                            placeholder="010-xxxx-xxxx" className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">요청사항</span>
                          <input type="text" value={buyDeliveryNote} onChange={(e) => setBuyDeliveryNote(e.target.value)}
                            placeholder="경비실, 부재 시 문앞 등" className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                        </label>
                      </>
                    )}
                    {pt === 'service' && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="grid gap-1">
                            <span className="text-xs font-semibold text-slate-600">예약 날짜 <span className="text-red-500">*</span></span>
                            <input type="date" value={buyServiceDate} onChange={(e) => setBuyServiceDate(e.target.value)}
                              className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                          </label>
                          <label className="grid gap-1">
                            <span className="text-xs font-semibold text-slate-600">예약 시간 <span className="text-red-500">*</span></span>
                            <input type="time" value={buyServiceTime} onChange={(e) => setBuyServiceTime(e.target.value)}
                              className={`rounded-xl border px-3 py-2 text-sm ${buyServiceTime && reservedSlots.includes(buyServiceTime) ? 'border-red-400 bg-red-50' : 'border-sky-200 bg-white'}`} />
                          </label>
                        </div>
                        {/* ✨ Patch v16.2: 예약된 시간 안내 */}
                        {buyServiceDate && (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                            {reservedSlotsLoading ? (
                              <span className="text-slate-500">예약 현황 확인 중...</span>
                            ) : reservedSlots.length === 0 ? (
                              <span className="text-emerald-700">✅ <b>{buyServiceDate}</b> 예약 가능 현황: 모든 시간 예약 가능</span>
                            ) : (
                              <div>
                                <span className="text-amber-700">⚠️ 해당 날 이미 예약된 시간: </span>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {reservedSlots.map((t) => (
                                    <span key={t} className="rounded-md bg-red-100 px-2 py-0.5 font-bold text-red-700">{t}</span>
                                  ))}
                                </div>
                                <div className="mt-1 text-slate-500">이 시간에는 예약할 수 없습니다.</div>
                              </div>
                            )}
                            {buyServiceTime && reservedSlots.includes(buyServiceTime) && (
                              <div className="mt-2 rounded-lg bg-red-100 p-2 text-xs font-black text-red-700">
                                ❌ 선택한 시간 <b>{buyServiceTime}</b>은 이미 예약되었습니다. 다른 시간을 선택하세요.
                              </div>
                            )}
                          </div>
                        )}
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">확인 이메일 <span className="text-red-500">*</span></span>
                          <input type="email" value={buyDeliveryEmail} onChange={(e) => setBuyDeliveryEmail(e.target.value)}
                            placeholder="you@example.com" className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">연락처</span>
                          <input type="tel" value={buyDeliveryPhone} onChange={(e) => setBuyDeliveryPhone(e.target.value)}
                            placeholder="010-xxxx-xxxx" className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                        </label>
                      </>
                    )}
                    {pt === 'food' && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setBuyFoodMethod('pickup')}
                            className={`rounded-xl px-3 py-2 text-sm font-bold ${buyFoodMethod==='pickup' ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-700'}`}>직접 픽업</button>
                          <button type="button" onClick={() => setBuyFoodMethod('delivery')}
                            className={`rounded-xl px-3 py-2 text-sm font-bold ${buyFoodMethod==='delivery' ? 'bg-sky-500 text-white' : 'bg-slate-100 text-slate-700'}`}>배달</button>
                        </div>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">{buyFoodMethod==='pickup' ? '픽업 희망 시간' : '배달 희망 시간'} <span className="text-red-500">*</span></span>
                          <input type="datetime-local" value={buyServiceTime} onChange={(e) => setBuyServiceTime(e.target.value)}
                            className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                        </label>
                        {buyFoodMethod === 'delivery' && (
                          <label className="grid gap-1">
                            <span className="text-xs font-semibold text-slate-600">배달 주소 <span className="text-red-500">*</span></span>
                            <input type="text" value={buyDeliveryAddress} onChange={(e) => setBuyDeliveryAddress(e.target.value)}
                              placeholder="서울시 ..." className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                          </label>
                        )}
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">확인 이메일</span>
                          <input type="email" value={buyDeliveryEmail} onChange={(e) => setBuyDeliveryEmail(e.target.value)}
                            placeholder="you@example.com" className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="grid gap-1">
                          <span className="text-xs font-semibold text-slate-600">연락처</span>
                          <input type="tel" value={buyDeliveryPhone} onChange={(e) => setBuyDeliveryPhone(e.target.value)}
                            placeholder="010-xxxx-xxxx" className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                        </label>
                      </>
                    )}
                    {pt === 'digital' && (
                      <label className="grid gap-1">
                        <span className="text-xs font-semibold text-slate-600">수령할 이메일 주소 <span className="text-red-500">*</span></span>
                        <input type="email" value={buyDeliveryEmail} onChange={(e) => setBuyDeliveryEmail(e.target.value)}
                          placeholder="you@example.com" className="rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm" />
                      </label>
                    )}
                  </div>
                )
              })()}

              <div className="mt-5 rounded-2xl border border-amber-200/80 bg-amber-50/60 p-3 text-xs text-slate-700">
                결제는 WebKey DAO2 토큰으로 두 단계로 진행돼요:
                <br />
                <span className="font-bold text-violet-700">1)</span> 결제 승인 (지갑에서 한 번 확인)
                <br />
                <span className="font-bold text-fuchsia-700">2)</span> 주문 확정 (지갑에서 한 번 더 확인)
                <br />
                실제 결제 금액은 지갑 승인 시 표시되는 금액이 기준이에요.
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
                    ? '결제 승인 중...'
                    : approveConfirmed
                    ? '✅ 승인 완료'
                    : '1단계: 결제 승인'}
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
                    ? '주문 처리 중...'
                    : buyStep === 'done'
                    ? '🎉 주문 완료'
                    : '2단계: 주문 확정'}
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
    physical: { label: '📦 실물 상품', color: 'bg-sky-100 text-sky-700 border-sky-200' },
    service:  { label: '💅 서비스 예약',    color: 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200' },
    food:     { label: '🍱 음식 주문',      color: 'bg-amber-100 text-amber-700 border-amber-200' },
    digital:  { label: '💻 디지털 상품',    color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
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
