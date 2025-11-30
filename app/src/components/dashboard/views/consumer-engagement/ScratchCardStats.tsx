'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Users, Trophy, Gift, PlayCircle } from 'lucide-react'
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

interface ScratchCardStatsProps {
    campaignId: string
    onBack: () => void
}

export default function ScratchCardStats({ campaignId, onBack }: ScratchCardStatsProps) {
    const [stats, setStats] = useState({
        total_plays: 0,
        unique_players: 0,
        total_winners: 0,
        claim_rate: 0
    })
    const [rewardsStats, setRewardsStats] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const supabase = createClient()

    useEffect(() => {
        fetchStats()
    }, [campaignId])

    const fetchStats = async () => {
        setLoading(true)
        
        // Fetch plays
        const { data: plays, error } = await supabase
            .from('scratch_card_plays')
            .select('id, is_win, consumer_phone, reward_id')
            .eq('campaign_id', campaignId)

        if (plays) {
            const totalPlays = plays.length
            const uniquePlayers = new Set(plays.map(p => p.consumer_phone)).size
            const totalWinners = plays.filter(p => p.is_win).length
            
            setStats({
                total_plays: totalPlays,
                unique_players: uniquePlayers,
                total_winners: totalWinners,
                claim_rate: totalPlays > 0 ? Math.round((totalWinners / totalPlays) * 100) : 0
            })

            // Fetch rewards to map names
            const { data: rewards } = await supabase
                .from('scratch_card_rewards')
                .select('id, name, probability, type')
                .eq('campaign_id', campaignId)

            if (rewards) {
                const statsByReward = rewards.map(reward => {
                    const wins = plays.filter(p => p.reward_id === reward.id).length
                    const winRate = totalPlays > 0 ? (wins / totalPlays) * 100 : 0
                    return {
                        ...reward,
                        wins,
                        winRate
                    }
                })
                setRewardsStats(statsByReward)
            }
        }
        setLoading(false)
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={onBack}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <h2 className="text-2xl font-bold tracking-tight">Campaign Statistics</h2>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Plays</CardTitle>
                        <PlayCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.total_plays}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Unique Players</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.unique_players}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Winners</CardTitle>
                        <Trophy className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.total_winners}</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
                        <Gift className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats.claim_rate}%</div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Rewards Breakdown</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Reward Name</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Configured Probability</TableHead>
                                <TableHead>Actual Win Rate</TableHead>
                                <TableHead>Winners Count</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rewardsStats.map((reward) => (
                                <TableRow key={reward.id}>
                                    <TableCell className="font-medium">{reward.name}</TableCell>
                                    <TableCell className="capitalize">{reward.type.replace('_', ' ')}</TableCell>
                                    <TableCell>{reward.probability}%</TableCell>
                                    <TableCell>{reward.winRate.toFixed(1)}%</TableCell>
                                    <TableCell>{reward.wins}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
