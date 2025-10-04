## Cricket Heritage Bot

Collect, trade, and showcase cricket player cards via Telegram.

### Features
- Packs, card collection, marketplace, trades
- Leaderboard and daily rewards

### Setup
1. Create `.env` from `.env.example` and set `BOT_TOKEN`.
2. Install deps:
```bash
pnpm i
```
3. Generate DB and migrate:
```bash
pnpm prisma:generate && pnpm prisma:migrate && pnpm seed
```
4. Run dev:
```bash
pnpm dev
```

### Commands
- /start, /help, /profile
- /pack, /cards
- /trade, /market
- /leaderboard, /daily

### Deployment
- Set `DATABASE_URL` and `BOT_TOKEN`.
- Optional webhook: set `WEBHOOK_DOMAIN` and `PORT`.
