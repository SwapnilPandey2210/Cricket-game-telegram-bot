import { PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

export async function ensureUser(prisma: PrismaClient, from: { id: number; username?: string | undefined; first_name?: string | undefined }) {
  const telegramId = String(from.id);
  let user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) {
    user = await prisma.user.create({ data: { telegramId, username: from.username ?? null, firstName: from.first_name ?? null } });
  } else if (user.username !== from.username || user.firstName !== from.first_name) {
    user = await prisma.user.update({ where: { id: user.id }, data: { username: from.username ?? null, firstName: from.first_name ?? null } });
  }
  return user;
}

const PACK_SIZE = 1;

const rarityWeights: Record<string, number> = {
  COMMON: 70,
  RARE: 22,
  EPIC: 7,
  LEGENDARY: 1,
};

function pickRarity(): string {
  const total = Object.values(rarityWeights).reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (const [rarity, weight] of Object.entries(rarityWeights)) {
    if (roll < weight) return rarity;
    roll -= weight;
  }
  return 'COMMON';
}

export async function openPackForUser(prisma: PrismaClient, userId: number) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const now = dayjs();
  if (user.lastPackAt && dayjs(user.lastPackAt).isAfter(now.subtract(3, 'minute'))) {
    const next = dayjs(user.lastPackAt).add(3, 'minute');
    const seconds = Math.max(1, Math.ceil(next.diff(now) / 1000));
    throw new Error(`Pack on cooldown. Try again in ${seconds} seconds.`);
  }

  // Pick rarity by probability
  const rarity = pickRarity();
  // Pick a random card of that rarity
  const cardsOfRarity = await prisma.card.findMany({ where: { rarity } });
  if (!cardsOfRarity.length) throw new Error('No cards of this rarity in catalog yet. Seed the database.');
  const chosen = cardsOfRarity[Math.floor(Math.random() * cardsOfRarity.length)];
  if (!chosen) throw new Error('No cards in catalog yet. Seed the database.');

  const updated = await prisma.$transaction(async (tx) => {
    await tx.user.update({ 
      where: { id: user.id }, 
      data: { 
        lastPackAt: new Date(),
        totalCardsCollected: { increment: 1 }
      } 
    });
    const existing = await tx.ownership.findUnique({ where: { userId_cardId: { userId: user.id, cardId: chosen.id } } });
    if (existing) {
      await tx.ownership.update({ where: { id: existing.id }, data: { quantity: { increment: 1 } } });
    } else {
      await tx.ownership.create({ data: { userId: user.id, cardId: chosen.id, quantity: 1 } });
    }
    return { card: chosen };
  });

  return [{ card: updated.card }];
}

export async function listUserCards(prisma: PrismaClient, userId: number) {
  return prisma.ownership.findMany({ where: { userId }, include: { card: true }, orderBy: { cardId: 'asc' } });
}

export async function claimDaily(prisma: PrismaClient, userId: number) {
  const now = dayjs();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.lastDailyAt && dayjs(user.lastDailyAt).isAfter(now.subtract(22, 'hour'))) {
    return { ok: false, message: 'Already claimed daily reward. Try again later.' } as const;
  }
  const reward = 40;
  const u = await prisma.user.update({ where: { id: userId }, data: { coins: { increment: reward }, lastDailyAt: now.toDate() } });
  return { ok: true, coins: reward, balance: u.coins } as const;
}

export async function getLeaderboard(prisma: PrismaClient) {
  return prisma.user.findMany({ orderBy: { totalCardsCollected: 'desc' }, take: 10 });
}
