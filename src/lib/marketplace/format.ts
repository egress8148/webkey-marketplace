export const getProductOptionList = (value: string) =>
  value
    .split(',')
    .map((option) => option.trim())
    .filter((option) => option.length > 0)

export const formatDao2From9Decimals = (value?: bigint) => {
  if (value === undefined) return '-'

  const raw = value.toString()
  const padded = raw.padStart(10, '0')
  const wholePart = padded.slice(0, -9) || '0'
  const decimalPart = padded.slice(-9).replace(/0+$/, '')

  return decimalPart ? `${wholePart}.${decimalPart}` : wholePart
}

export const parseDao2To9Decimals = (value: number | null) => {
  if (value === null || !Number.isFinite(value) || value <= 0) return null

  const fixed = value.toFixed(9)
  const [wholePartRaw, decimalPartRaw = ''] = fixed.split('.')
  const wholePart = wholePartRaw.replace(/[^0-9]/g, '')
  const decimalPart = decimalPartRaw.replace(/[^0-9]/g, '').slice(0, 9)
  const paddedDecimalPart = decimalPart.padEnd(9, '0')
  const combined = `${wholePart || '0'}${paddedDecimalPart}`

  return BigInt(combined)
}

export const parseUsdtTo6Decimals = (value: string) => {
  const trimmed = value.trim()

  if (!trimmed) return null

  const [wholePartRaw, decimalPartRaw = ''] = trimmed.split('.')

  const wholePart = wholePartRaw.replace(/[^0-9]/g, '')
  const decimalPart = decimalPartRaw.replace(/[^0-9]/g, '').slice(0, 6)

  if (!wholePart && !decimalPart) return null

  const paddedDecimalPart = decimalPart.padEnd(6, '0')
  const combined = `${wholePart || '0'}${paddedDecimalPart}`

  return BigInt(combined)
}

export const formatUsdt6FromUnknown = (value: unknown) => {
  if (value === undefined || value === null) return '0'

  const raw = String(value)
  if (!/^\d+$/.test(raw)) return '0'

  const padded = raw.padStart(7, '0')
  const wholePart = padded.slice(0, -6) || '0'
  const decimalPart = padded.slice(-6).replace(/0+$/, '')

  return decimalPart ? `${wholePart}.${decimalPart}` : wholePart
}

export const getBscScanTxUrl = (txHash: string) => `https://bscscan.com/tx/${txHash}`
