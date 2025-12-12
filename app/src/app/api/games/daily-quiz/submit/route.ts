import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    const supabase = await createClient()
    
    try {
        const body = await request.json()
        let { campaign_id, qr_code_id, qr_code, consumer_phone, consumer_name, answers } = body

        if (!campaign_id || !answers) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
        }

        // Resolve QR Code ID if only code string is provided
        if (!qr_code_id && qr_code) {
            const { data: qrData } = await supabase
                .from('qr_codes')
                .select('id')
                .eq('code', qr_code)
                .single()
            
            if (qrData) {
                qr_code_id = qrData.id
            }
        }

        // 1. Fetch Campaign
        const { data: campaign, error: campaignError } = await supabase
            .from('daily_quiz_campaigns')
            .select('*')
            .eq('id', campaign_id)
            .single()

        if (campaignError || !campaign) {
            return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
        }

        // 2. Fetch Questions
        const { data: questions, error: questionsError } = await supabase
            .from('daily_quiz_questions')
            .select('id, correct_option_index')
            .eq('campaign_id', campaign_id)

        if (questionsError || !questions) {
            return NextResponse.json({ error: 'Questions not found' }, { status: 500 })
        }

        // 3. Calculate Score
        let score = 0
        const totalQuestions = questions.length
        
        // answers is expected to be { question_id: selected_index }
        for (const q of questions) {
            if (answers[q.id] === q.correct_option_index) {
                score++
            }
        }

        // 4. Record Play
        const { data: play, error: playError } = await supabase
            .from('daily_quiz_plays')
            .insert({
                campaign_id,
                qr_code_id: qr_code_id || null,
                consumer_phone: consumer_phone || null,
                consumer_name: consumer_name || null,
                score,
                answers
            })
            .select()
            .single()

        if (playError) {
            console.error('Play record error:', playError)
            return NextResponse.json({ error: 'Failed to record play' }, { status: 500 })
        }

        // 5. Calculate Points
        const pointsEarned = score * (campaign.points_per_correct_answer || 0)

        return NextResponse.json({
            success: true,
            score,
            totalQuestions,
            pointsEarned,
            play_id: play.id
        })

    } catch (error: any) {
        console.error('Quiz Submit API Error:', error)
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
