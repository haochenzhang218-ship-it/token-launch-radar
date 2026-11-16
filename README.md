# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/haochenzhang218-ship-it/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/haochenzhang218-ship-it/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: 226 pre-token DeFi protocols ranked by an implied value derived from TVL, 7-day growth, age with no token, chain breadth and category — each with a concrete seven-step farm plan with costs and times. The board covers the snapshot's whole 40-protocol watchlist plus every other rankable pre-token protocol below the floor, and keeps protocols whose token already trades in a separate Live view at market value. Snapshot as of 2026-11-14.

## Model (radar-2)

```
implied = TVL × 0.20
        × (1 + clamp(7d change, −50%, +150%) × 0.8)   momentum
        × seasoning(age with no token)                 0.55 + 0.45 × ln(1 + age) / ln(1 + 1460)
        × (1 + 0.06 × extra chains, up to 5)          breadth
        × category factor                              1.15 Dex / Lending / Yield · 1.10 Derivatives
                                                       1.05 RWA / Staking · 0.85 Bridge · 1.00 other
```

Every row is scored by the same function from the snapshot's own figures; no protocol name is
ever special-cased. "Pre-token" means the record carries no token (no market cap, no CoinGecko
id, no symbol) — what the record says, not proof it has none. The implied value is the entry's
own claim, never a prediction of whether or when a token is issued.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=ezvq5wgd&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
