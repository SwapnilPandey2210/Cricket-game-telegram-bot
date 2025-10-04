const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'src', 'telegram', 'bot.ts');
let s = fs.readFileSync(file, 'utf8');
// Remove coin guard middlewares
s = s.replace(/bot\.hears\('🃏 Open Pack', async \(ctx, next\) => \{[\s\S]*?\}\);\n?/m, '');
s = s.replace(/bot\.command\('pack', async \(ctx, next\) => \{[\s\S]*?\}\);\n?/m, '');
// Wrap Open Pack handler with try/catch
s = s.replace(
  /bot\.hears\('🃏 Open Pack', async \(ctx\) => \{[\s\S]*?\}\);/m,
  "bot.hears('🃏 Open Pack', async (ctx) => {\n  const user = await ensureUser(prisma, ctx.from);\n  try {\n    const results = await openPackForUser(prisma, user.id);\n    await ctx.reply('You opened a pack and pulled:\\n' + results.map(r => '- ' + r.card.name + ' (' + r.card.rarity + ')').join('\\n'));\n  } catch (e) {\n    const msg = e && e.message ? e.message : 'Failed to open pack.';\n    await ctx.reply(msg);\n  }\n});"
);
// Wrap /pack handler with try/catch
s = s.replace(
  /bot\.command\('pack', async \(ctx\) => \{[\s\S]*?\}\);/m,
  "bot.command('pack', async (ctx) => {\n  const user = await ensureUser(prisma, ctx.from);\n  try {\n    const results = await openPackForUser(prisma, user.id);\n    await ctx.reply('Pack result:\\n' + results.map(r => '- ' + r.card.name + ' (' + r.card.rarity + ')').join('\\n'));\n  } catch (e) {\n    const msg = e && e.message ? e.message : 'Failed to open pack.';\n    await ctx.reply(msg);\n  }\n});"
);
fs.writeFileSync(file, s);
console.log('Patched pack handlers and removed coin guards.');
