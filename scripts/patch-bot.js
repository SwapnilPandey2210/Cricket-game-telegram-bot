const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'telegram', 'bot.ts');
let s = fs.readFileSync(file, 'utf8');

// Replace hears Open Pack handler
s = s.replace(/bot\.hears\('🃏 Open Pack',[\s\S]*?\)\;\n\n/, (
  "bot.hears('🃏 Open Pack', async (ctx) => {\n" +
  "  const user = await ensureUser(prisma, ctx.from);\n" +
  "  try {\n" +
  "    const results = await openPackForUser(prisma, user.id);\n" +
  "    await ctx.reply('You opened a pack and pulled:\\n' + results.map(r => `- ${r.card.name} (${r.card.rarity})`).join('\\n'));\n" +
  "  } catch (e) {\n" +
  "    const msg = (e && e.message) ? e.message : 'Failed to open pack.';\n" +
  "    await ctx.reply(msg);\n" +
  "  }\n" +
  "});\n\n"
));

// Replace /pack command handler
s = s.replace(/bot\.command\('pack',[\s\S]*?\)\;\n\n/, (
  "bot.command('pack', async (ctx) => {\n" +
  "  const user = await ensureUser(prisma, ctx.from);\n" +
  "  try {\n" +
  "    const results = await openPackForUser(prisma, user.id);\n" +
  "    await ctx.reply('Pack result:\\n' + results.map(r => `- ${r.card.name} (${r.card.rarity})`).join('\\n'));\n" +
  "  } catch (e) {\n" +
  "    const msg = (e && e.message) ? e.message : 'Failed to open pack.';\n" +
  "    await ctx.reply(msg);\n" +
  "  }\n" +
  "});\n\n"
));

fs.writeFileSync(file, s);
console.log('bot.ts updated');
