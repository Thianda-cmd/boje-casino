/*
  The Rewards hub: everything that pays free play-money coins, top to bottom in the order a player meets it.
    - the header: what's been earned today and this week, what's ready now, and Claim all
    - today: the three daily missions beside the Lucky Wheel they unlock, then the daily bonus streak beside the history
    - VIP & perks: level, level-up rewards and the tiers' perks, then rakeback and tier bonuses
    - more free coins: Vault Heist and the emergency refill
    - the challenges
  The pieces live in ./rewards/. The page loads on demand (see App.tsx), so the wheel's art ships only with it. The
  coin sprays every claim throws are drawn in one layer over the page (CoinLayer), so they outlive the buttons.
*/
import { useWallet } from '../store/wallet'
import { IconBolt } from '../components/icons'
import { RewardsHeader } from './rewards/Header'
import { DailyMissions } from './rewards/DailyMissions'
import { DailyBonus } from './rewards/DailyBonus'
import { RewardLog } from './rewards/RewardLog'
import { RakebackCard, TierBonusCard, VipCard } from './rewards/Vip'
import { HeistCard, RefillCard, TycoonCard } from './rewards/FreeCoins'
import { Challenges } from './rewards/Challenges'
import { CoinLayer, IconCrown, SectionTitle } from './rewards/kit'

// dev only: the wallet store on window.__wallet, for seeding and reading states in the page checks (tools/rewards-*)
if (import.meta.env.DEV) (window as unknown as { __wallet?: typeof useWallet }).__wallet = useWallet

export default function Rewards() {
  return (
    <div className="flex flex-col gap-4">
      <RewardsHeader />
      <DailyMissions />
      {/* a little taller than the daily bonus needs, so the history beside it has room for a handful of rows */}
      <div className="grid gap-4 lg:min-h-[400px] lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DailyBonus />
        <RewardLog />
      </div>

      <SectionTitle icon={<IconCrown size={21} className="text-[#7fe3ff]" />}>VIP &amp; perks</SectionTitle>
      <VipCard />
      <div className="grid gap-4 md:grid-cols-2">
        <RakebackCard />
        <TierBonusCard />
      </div>

      <SectionTitle icon={<IconBolt size={21} className="text-sky" />}>More free coins</SectionTitle>
      <TycoonCard />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <HeistCard />
        <RefillCard />
      </div>

      <div className="mt-3">
        <Challenges />
      </div>
      <CoinLayer />
    </div>
  )
}
