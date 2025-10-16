import { PrismaClient, Rarity } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cards = [
    { slug: 'sachin-tendulkar', name: 'Sachin Tendulkar', rarity: 'LEGENDARY', country: 'India', role: 'Batsman', rating: 99 },
    { slug: 'virat-kohli', name: 'Virat Kohli', rarity: 'EPIC', country: 'India', role: 'Batsman', rating: 96 },
    { slug: 'ms-dhoni', name: 'MS Dhoni', rarity: 'EPIC', country: 'India', role: 'Wicket-keeper', rating: 95 },
    { slug: 'jasprit-bumrah', name: 'Jasprit Bumrah', rarity: 'RARE', country: 'India', role: 'Bowler', rating: 92 },
    { slug: 'ben-stokes', name: 'Ben Stokes', rarity: 'RARE', country: 'England', role: 'All-rounder', rating: 91 },
    { slug: 'babar-azam', name: 'Babar Azam', rarity: 'RARE', country: 'Pakistan', role: 'Batsman', rating: 91 },
    { slug: 'rashid-khan', name: 'Rashid Khan', rarity: 'RARE', country: 'Afghanistan', role: 'Bowler', rating: 90 },
    { slug: 'trent-boult', name: 'Trent Boult', rarity: 'COMMON', country: 'New Zealand', role: 'Bowler', rating: 88 },
    { slug: 'joe-root', name: 'Joe Root', rarity: 'COMMON', country: 'England', role: 'Batsman', rating: 88 },
    { slug: 'kane-williamson', name: 'Kane Williamson', rarity: 'COMMON', country: 'New Zealand', role: 'Batsman', rating: 89 }
  ] as const;

  for (const c of cards) {
    await prisma.card.upsert({
      where: { slug: c.slug },
      update: {},
      create: { ...c, rarity: c.rarity as any },
    });
  }

  // Create a demo user
  await prisma.user.upsert({
    where: { telegramId: 'demo' },
    update: {},
    create: { telegramId: 'demo', username: 'demo', firstName: 'Demo', coins: 200 },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
