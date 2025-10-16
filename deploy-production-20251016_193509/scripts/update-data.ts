import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const cards = [
    { slug: 'ab-de-villiers', name: 'AB de Villiers', rarity: 'EPIC', country: 'South Africa', role: 'Batsman', rating: 95 },
    { slug: 'mitchell-starc', name: 'Mitchell Starc', rarity: 'RARE', country: 'Australia', role: 'Bowler', rating: 92 },
    { slug: 'shubman-gill', name: 'Shubman Gill', rarity: 'RARE', country: 'India', role: 'Batsman', rating: 90 },
    { slug: 'adam-zampa', name: 'Adam Zampa', rarity: 'COMMON', country: 'Australia', role: 'Bowler', rating: 86 },
    { slug: 'shaheen-afridi', name: 'Shaheen Afridi', rarity: 'BHIKHARI', country: 'Pakistan', role: 'Bowler', rating: 94 },
  ];

  for (const c of cards) {
    await prisma.card.upsert({ where: { slug: c.slug }, update: {}, create: c });
  }

  const res = await prisma.user.updateMany({ where: { firstName: 'SP' }, data: { coins: 1000 } });
  console.log(`Updated coins for ${res.count} user(s) named SP.`);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
