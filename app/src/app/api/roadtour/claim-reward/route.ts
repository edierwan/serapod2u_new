import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const { token, shop_id, consumer_phone, consumer_name, survey_answers } = body

        if (!token) {
            return NextResponse.json({ message: 'Missing QR token.' }, { status: 400 })
        }

        const supabase = createAdminClient()

        // 1. Validate QR token (function created by migration, cast to bypass type generation lag)
        const { data: validation, error: valError } = await (supabase as any).rpc('validate_roadtour_qr_token', { p_token: token })
        if (valError || !validation || validation.status === 'error') {
            const msg = validation?.message || valError?.message || 'Invalid QR code.'
            const code = validation?.reason === 'expired' ? 'EXPIRED' : 'INVALID'
            return NextResponse.json({ message: msg, code }, { status: 400 })
        }

        const { qr_id, campaign_id, am_user_id, default_points, reward_mode, survey_template_id, org_id } = validation as any

        // 2. Record scan event
        const { data: scanEvent, error: scanError } = await (supabase as any)
            .from('roadtour_scan_events')
            .insert({
                qr_id,
                consumer_phone: consumer_phone || null,
                shop_id: shop_id || null,
                reward_status: 'pending',
            })
            .select('id')
            .single()

        if (scanError) {
            return NextResponse.json({ message: 'Failed to record scan.', detail: scanError.message }, { status: 500 })
        }

        // 3. If survey mode, save survey response
        let surveyResponseId: string | null = null
        if (reward_mode === 'survey_submit' && survey_template_id && survey_answers) {
            const { data: surveyResp, error: surveyErr } = await (supabase as any)
                .from('roadtour_survey_responses')
                .insert({
                    scan_event_id: scanEvent.id,
                    template_id: survey_template_id,
                })
                .select('id')
                .single()

            if (surveyErr) {
                return NextResponse.json({ message: 'Failed to save survey.', detail: surveyErr.message }, { status: 500 })
            }

            surveyResponseId = surveyResp.id

            // Save individual answers
            const items = Object.entries(survey_answers).map(([field_key, value]) => ({
                response_id: surveyResp.id,
                field_key,
                value: String(value),
            }))

            if (items.length > 0) {
                const { error: itemsErr } = await (supabase as any).from('roadtour_survey_response_items').insert(items)
                if (itemsErr) {
                    console.error('Failed to save survey items:', itemsErr)
                }
            }
        }

        // 4. Record reward using the DB function (cast to bypass type generation lag)
        const { data: rewardResult, error: rewardError } = await (supabase as any).rpc('record_roadtour_reward', {
            p_scan_event_id: scanEvent.id,
            p_qr_id: qr_id,
            p_campaign_id: campaign_id,
            p_am_user_id: am_user_id,
            p_consumer_user_id: null, // TODO: if logged in, pass user id
            p_consumer_phone: consumer_phone || null,
            p_shop_id: shop_id || null,
            p_points: default_points,
            p_org_id: org_id,
            p_point_type: reward_mode === 'survey_submit' ? 'roadtour_survey' : 'roadtour',
        })

        if (rewardError) {
            // Check for duplicate
            if (rewardError.message?.includes('duplicate') || rewardError.code === '23505') {
                // Update scan event status
                await (supabase as any).from('roadtour_scan_events').update({ reward_status: 'duplicate' }).eq('id', scanEvent.id)
                return NextResponse.json({ message: 'You have already claimed this reward.', code: 'DUPLICATE' }, { status: 409 })
            }
            return NextResponse.json({ message: rewardError.message || 'Reward processing failed.', code: 'ERROR' }, { status: 500 })
        }

        return NextResponse.json({
            message: 'Reward claimed successfully.',
            points_awarded: default_points,
            scan_event_id: scanEvent.id,
            survey_response_id: surveyResponseId,
        })
    } catch (err: any) {
        console.error('RoadTour claim-reward error:', err)
        return NextResponse.json({ message: 'Internal server error.' }, { status: 500 })
    }
}
