const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'telegram', 'bot.ts');
let s = fs.readFileSync(file, 'utf8');

const openPackOld = `bot.hears('🃏 Open Pack', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const results = await openPackForUser(prisma, user.id);
  await ctx.reply('You opened a pack and pulled:\n' + results.map(r => \`- \${r.card.name} (\${r.card.rarity})\`).join('\n'));

});
`;
const openPackNew = `bot.hears('🃏 Open Pack', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  try {
    const results = await openPackForUser(prisma, user.id);
    await ctx.reply('You opened a pack and pulled:\n' + results.map(r => \`- \${r.card.name} (\${r.card.rarity})\`).join('\n'));
  } catch (e) {
    const msg = (e && e.message) ? e.message : 'Failed to open pack.';
    await ctx.reply(msg);
  }
});
`;

const packCmdOld = `bot.command('pack', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const results = await openPackForUser(prisma, user.id);
  await ctx.reply('Pack result:\n' + results.map(r => \`- \${r.card.name} (\${r.card.rarity})\`).join('\n'));

});
`;
const packCmdNew = `bot.command('pack', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  try {
    const results = await openPackForUser(prisma, user.id);
    await ctx.reply('Pack result:\n' + results.map(r => \`- \${r.card.name} (\${r.card.rarity})\`).join('\n'));
  } catch (e) {
    const msg = (e && e.message) ? e.message : 'Failed to open pack.';
    await ctx.reply(msg);
  }
});
`;

let changed = false;
if (s.includes(openPackOld)) {
  s = s.replace(openPackOld, openPackNew);
  changed = true;
}
if (s.includes(packCmdOld)) {
  s = s.replace(packCmdOld, packCmdNew);
  changed = true;
}
if (changed) {
  fs.writeFileSync(file, s);
  console.log('Patched bot.ts');
} else {
  console.log('No changes applied (patterns not found).');
}
