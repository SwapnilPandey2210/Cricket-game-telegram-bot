import { PrismaClient } from '@prisma/client';

export const ACH = {
  FIRST_PACK: { code: 'FIRST_PACK', title: 'First Pack!', description: 'Opened your first pack.' },
  FIRST_TRADE: { code: 'FIRST_TRADE', title: 'First Trade!', description: 'Completed your first trade.' },
} as const;

export async function ensureAchievementsSeeded(prisma: PrismaClient) {
  for (const v of Object.values(ACH)) {
    await prisma.achievement.upsert({ where: { code: v.code }, update: {}, create: v });
  }
}

export async function awardAchievement(prisma: PrismaClient, userId: number, code: string) {
  const ach = await prisma.achievement.findUnique({ where: { code } });
  if (!ach) return;
  try {
    await prisma.userAchievement.create({ data: { userId, achievementId: ach.id } });
  } catch {
    // ignore unique violation
  }
}

export async function listUserAchievements(prisma: PrismaClient, userId: number) {
  return prisma.userAchievement.findMany({ where: { userId }, include: { achievement: true }, orderBy: { createdAt: 'desc' } });
}
