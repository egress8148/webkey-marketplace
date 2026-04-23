import { NextRequest } from 'next/server'
import { supabaseAdmin } from '../../_shared/supabase-admin'
import { jsonError, requireAdminWallet, safeNumber, safeString } from '../../_shared/security'

const getLatestId = async (supabase: ReturnType<typeof supabaseAdmin>, table: string) => {
  const { data } = await supabase
    .from(table)
    .select('id')
    .order('updated_at', { ascending: false })
    .limit(1)
  return Array.isArray(data) && data[0]?.id ? String(data[0].id) : ''
}

export async function POST(request: NextRequest) {
  try {
    const { wallet } = await requireAdminWallet(request)
    const body = await request.json()
    const mode = safeString(body.mode)
    const supabase = supabaseAdmin()

    if (mode === 'prime') {
      const payload = {
        plan_name: safeString(body.planName) || 'DAO2 Prime Pass',
        monthly_price_usdt: safeNumber(body.monthlyPriceUsdt),
        dao2_pass_requirement: safeNumber(body.dao2PassRequirement),
        benefit_summary: safeString(body.benefitSummary),
        policy_memo: safeString(body.policyMemo),
        is_active: true,
        created_by: wallet,
        created_by_wallet: wallet,
        updated_by_wallet: wallet,
        updated_at: new Date().toISOString(),
      }

      const existingId = await getLatestId(supabase, 'prime_settings')
      const query = existingId
        ? supabase.from('prime_settings').update(payload).eq('id', existingId).select('id').single()
        : supabase.from('prime_settings').insert(payload).select('id').single()

      const { data, error } = await query
      if (error) return jsonError(error.message, 500)

      const targetId = data?.id ? String(data.id) : existingId
      const { error: logError } = await supabase.from('admin_logs').insert({
        admin_wallet: wallet,
        action: 'prime_settings_save',
        target_type: 'prime_settings',
        target_id: targetId || null,
        metadata: payload,
        detail: { source: 'api_route', payload },
      })
      if (logError) return jsonError(logError.message, 500)

      return Response.json({ ok: true, id: targetId })
    }

    if (mode === 'marketplace') {
      const payload = {
        marketplace_address: safeString(body.marketplaceAddress) || null,
        dao2_token_address: safeString(body.dao2TokenAddress) || null,
        admin_wallet: safeString(body.adminWallet),
        treasury_wallet: safeString(body.treasuryWallet),
        fee_bps: Math.floor(safeNumber(body.feeBps, 700)),
        dao2_price_usdt6: body.dao2PriceUsdt6 === null || body.dao2PriceUsdt6 === undefined ? null : safeNumber(body.dao2PriceUsdt6),
        storage_mode: safeString(body.storageMode) || 'hybrid',
        notes: safeString(body.notes),
        updated_at: new Date().toISOString(),
      }

      const existingId = await getLatestId(supabase, 'marketplace_settings')
      const query = existingId
        ? supabase.from('marketplace_settings').update(payload).eq('id', existingId).select('id').single()
        : supabase.from('marketplace_settings').insert(payload).select('id').single()

      const { data, error } = await query
      if (error) return jsonError(error.message, 500)

      const targetId = data?.id ? String(data.id) : existingId
      const { error: logError } = await supabase.from('admin_logs').insert({
        admin_wallet: wallet,
        action: 'marketplace_settings_save',
        target_type: 'marketplace_settings',
        target_id: targetId || null,
        metadata: payload,
        detail: { source: 'api_route', payload },
      })
      if (logError) return jsonError(logError.message, 500)

      return Response.json({ ok: true, id: targetId })
    }

    return jsonError('mode must be prime or marketplace.')
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'Unknown error.', 403)
  }
}
