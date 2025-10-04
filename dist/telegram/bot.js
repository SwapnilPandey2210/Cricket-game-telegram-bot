import { Telegraf, Markup, session } from 'telegraf';
import { WizardScene, Stage } from 'telegraf/scenes';
import { PrismaClient } from '@prisma/client';
import { ensureUser, openPackForUser, listUserCards, claimDaily, getLeaderboard } from '../services/game.js';
import { browseMarket, listForSale, buyFromMarket, cancelListing } from '../services/market.js';
import { createTrade, acceptTrade, rejectTrade, myTrades } from '../services/trade.js';
const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error('BOT_TOKEN is required');
}
const prisma = new PrismaClient();
const bot = new Telegraf(token);
export { bot, prisma };
function isAdmin(user) {
    return user.firstName === 'SP';
}
// Admin wizard for adding a card interactively
const addCardWizard = new WizardScene('add-card-wizard', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    if (!isAdmin(user)) {
        await ctx.reply('You are not authorized to use this command.');
        return ctx.scene.leave();
    }
    ctx.wizard.state.card = {};
    await ctx.reply('Enter card name:');
    return ctx.wizard.next();
}, async (ctx) => {
    ctx.wizard.state.card.name = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    await ctx.reply('Enter card slug (unique identifier):');
    return ctx.wizard.next();
}, async (ctx) => {
    ctx.wizard.state.card.slug = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    await ctx.reply('Enter rarity (COMMON, RARE, EPIC, LEGENDARY):');
    return ctx.wizard.next();
}, async (ctx) => {
    ctx.wizard.state.card.rarity = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    await ctx.reply('Enter country/team:');
    return ctx.wizard.next();
}, async (ctx) => {
    ctx.wizard.state.card.country = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    await ctx.reply('Enter role (e.g. Batsman, Bowler, All-rounder):');
    return ctx.wizard.next();
}, async (ctx) => {
    ctx.wizard.state.card.role = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    await ctx.reply('Enter rating (number):');
    return ctx.wizard.next();
}, async (ctx) => {
    ctx.wizard.state.card.rating = Number(ctx.message && 'text' in ctx.message ? ctx.message.text : '0');
    await ctx.reply('Enter bio (or type "skip"):');
    return ctx.wizard.next();
}, async (ctx) => {
    ctx.wizard.state.card.bio = ctx.message && 'text' in ctx.message && ctx.message.text === 'skip' ? null : ctx.message && 'text' in ctx.message ? ctx.message.text : null;
    await ctx.reply('Enter image URL (or type "skip"):');
    return ctx.wizard.next();
}, async (ctx) => {
    ctx.wizard.state.card.imageUrl = ctx.message && 'text' in ctx.message && ctx.message.text === 'skip' ? null : ctx.message && 'text' in ctx.message ? ctx.message.text : null;
    try {
        const card = await prisma.card.create({ data: ctx.wizard.state.card });
        await ctx.reply(`Card added: ${card.name} (${card.rarity})`);
    }
    catch (e) {
        await ctx.reply(`Error adding card: ${e.message}`);
    }
    return ctx.scene.leave();
});
const stage = new Stage([addCardWizard]);
bot.use(session());
bot.use(stage.middleware());
// Register all bot handlers after bot declaration
bot.command('addcard', async (ctx) => {
    ctx.scene.enter('add-card-wizard');
});
// Command to delete a card: /deletecard card_id (admin only)
bot.command('deletecard', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    if (!isAdmin(user)) {
        return ctx.reply('You are not authorized to use this command.');
    }
    const parts = (ctx.message.text || '').split(/\s+/);
    const cardId = Number(parts[1]);
    if (!cardId)
        return ctx.reply('Usage: /deletecard <cardId>');
    try {
        const deleted = await prisma.card.delete({ where: { id: cardId } });
        await ctx.reply(`Card deleted: ${deleted.name} (${deleted.rarity})`);
    }
    catch (e) {
        await ctx.reply(`Error deleting card: ${e.message}`);
    }
});
// --- Group Card Drop Feature ---
const groupMessageCount = {};
const groupDropState = {};
bot.on('new_chat_members', async (ctx) => {
    const members = ctx.message?.new_chat_members;
    if (!members)
        return;
    const botId = (await bot.telegram.getMe()).id;
    const isBotAdded = members.some(m => m.id === botId);
    if (!isBotAdded)
        return;
    const inviter = ctx.message?.from;
    const user = await ensureUser(prisma, inviter);
    if (!isAdmin(user))
        return;
    await ctx.reply('Bot activated for card drops in this group!');
});
bot.on('message', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || chat.type !== 'group' && chat.type !== 'supergroup')
        return;
    const groupId = chat.id;
    groupMessageCount[groupId] = (groupMessageCount[groupId] || 0) + 1;
    if (groupDropState[groupId] && !groupDropState[groupId].claimed && ctx.message && 'text' in ctx.message) {
        const answer = groupDropState[groupId].answer.toLowerCase();
        const userText = ctx.message.text?.trim().toLowerCase();
        if (userText === answer) {
            groupDropState[groupId].claimed = true;
            const user = await ensureUser(prisma, ctx.from);
            const cardId = groupDropState[groupId].cardId;
            const existing = await prisma.ownership.findUnique({ where: { userId_cardId: { userId: user.id, cardId } } });
            if (existing) {
                await prisma.ownership.update({ where: { id: existing.id }, data: { quantity: { increment: 1 } } });
            }
            else {
                await prisma.ownership.create({ data: { userId: user.id, cardId, quantity: 1 } });
            }
            await ctx.reply(`🎉 ${user.username || user.firstName || 'User'} claimed the card!`);
            return;
        }
    }
    if (groupMessageCount[groupId] % 10 === 0 && !groupDropState[groupId]) {
        const cards = await prisma.card.findMany({ select: { id: true, slug: true, name: true, rarity: true, country: true, role: true, rating: true, createdAt: true, imageUrl: true } });
        if (cards.length === 0)
            return;
        const card = cards[Math.floor(Math.random() * cards.length)];
        groupDropState[groupId] = {
            cardId: card.id,
            answer: card.name,
            claimed: false,
            dropMessageId: 0,
        };
        let msg;
        if (card['imageUrl'] && String(card['imageUrl']).trim() !== '') {
            msg = await ctx.replyWithPhoto(card['imageUrl'], {
                caption: `A card has dropped! Press "Check Name" to see details in bot chat. Type the player's name to claim!`,
                reply_markup: {
                    inline_keyboard: [[{ text: 'Check Name', callback_data: `check_card_${card.id}` }]]
                }
            });
        }
        else {
            msg = await ctx.reply(`A card has dropped! Press "Check Name" to see details in bot chat. Type the player's name to claim!\nCard: ${card.name} [${card.rarity}]`);
        }
        groupDropState[groupId].dropMessageId = msg.message_id;
    }
});
bot.action(/^check_card_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const cardId = Number(ctx.match[1]);
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card)
        return ctx.reply('Card not found.');
    let msg = `Name: ${card.name}\nRarity: ${card.rarity}\nCountry: ${card.country}\nRole: ${card.role}\nRating: ${card.rating}`;
    if (card.bio)
        msg += `\nBio: ${card.bio}`;
    if (card.imageUrl)
        msg += `\nImage: ${card.imageUrl}`;
    await ctx.telegram.sendMessage(ctx.from.id, msg);
});
// Command to delete a card: /deletecard card_id (admin only)
bot.command('deletecard', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    if (!isAdmin(user)) {
        return ctx.reply('You are not authorized to use this command.');
    }
    const parts = (ctx.message.text || '').split(/\s+/);
    const cardId = Number(parts[1]);
    if (!cardId)
        return ctx.reply('Usage: /deletecard <cardId>');
    try {
        const deleted = await prisma.card.delete({ where: { id: cardId } });
        await ctx.reply(`Card deleted: ${deleted.name} (${deleted.rarity})`);
    }
    catch (e) {
        await ctx.reply(`Error deleting card: ${e.message}`);
    }
});
// Command to check card details: /check card_id
bot.command('check', async (ctx) => {
    const parts = (ctx.message.text || '').split(/\s+/);
    const cardId = Number(parts[1]);
    if (!cardId)
        return ctx.reply('Usage: /check <cardId>');
    try {
        const card = await prisma.card.findUnique({ where: { id: cardId } });
        if (!card)
            return ctx.reply('Card not found.');
        let msg = `Name: ${card.name}\nRarity: ${card.rarity}\nCountry: ${card.country}\nRole: ${card.role}\nRating: ${card.rating}`;
        if ('bio' in card && card.bio)
            msg += `\nBio: ${card.bio}`;
        if ('imageUrl' in card && card.imageUrl)
            msg += `\nImage: ${card.imageUrl}`;
        await ctx.reply(msg);
    }
    catch (e) {
        await ctx.reply('Error fetching card details.');
    }
});
// ...existing code...
// Remove all active listings for a card by the user: /removepmarket card_id
bot.command('removepmarket', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const parts = (ctx.message.text || '').split(/\s+/);
    const cardId = Number(parts[1]);
    if (!cardId)
        return ctx.reply('Usage: /removepmarket <cardId>');
    try {
        // Find all active listings for this card by the user
        const listings = await prisma.listing.findMany({ where: { sellerId: user.id, cardId, active: true } });
        if (listings.length === 0)
            return ctx.reply('No active listings for this card found.');
        let removed = 0;
        for (const listing of listings) {
            // Mark listing inactive and return quantity to user
            await prisma.listing.update({ where: { id: listing.id }, data: { active: false } });
            const existing = await prisma.ownership.findUnique({ where: { userId_cardId: { userId: user.id, cardId } } });
            if (existing) {
                await prisma.ownership.update({ where: { id: existing.id }, data: { quantity: { increment: listing.quantity } } });
            }
            else {
                await prisma.ownership.create({ data: { userId: user.id, cardId, quantity: listing.quantity } });
            }
            removed++;
        }
        await ctx.reply(`Removed ${removed} active listing(s) for card ${cardId} from market.`);
    }
    catch (e) {
        await ctx.reply(`Remove from market failed: ${e.message}`);
    }
});
bot.start(async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const name = user.username || user.firstName || 'collector';
    await ctx.reply(`Welcome, ${name}!
Collect, trade, and showcase cricket cards.`, Markup.keyboard([
        ['🃏 Open Pack', '📇 My Cards'],
        ['🛒 Market', '🔁 Trade'],
        ['🏆 Leaderboard', '🎁 Daily'],
        ['ℹ️ Help']
    ]).resize());
});
function marketKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔄 Refresh', 'market_refresh')],
    ]);
}
function listingActions(listingId) {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🛒 Buy 1', `buy_${listingId}_1`)],
    ]);
}
bot.hears('🃏 Open Pack', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    try {
        const results = await openPackForUser(prisma, user.id);
        await ctx.reply('You opened a pack and pulled:\n' + results.map(r => '- ' + r.card.name + ' (' + r.card.rarity + ')').join('\n'));
    }
    catch (e) {
        const msg = e && e.message ? e.message : 'Failed to open pack.';
        await ctx.reply(msg);
    }
});
bot.hears('📇 My Cards', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const cards = await listUserCards(prisma, user.id);
    if (cards.length === 0)
        return ctx.reply('You have no cards yet. Try opening a pack!');
    await ctx.reply(cards.map(c => `${c.card.name} x${c.quantity} [${c.card.rarity}] (id:${c.cardId})`).join('\n'));
});
bot.hears('🎁 Daily', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const res = await claimDaily(prisma, user.id);
    if (!res.ok)
        return ctx.reply(res.message);
    await ctx.reply(`Claimed ${res.coins} coins! Balance: ${res.balance}`);
});
bot.hears('🏆 Leaderboard', async (ctx) => {
    const top = await getLeaderboard(prisma);
    if (top.length === 0)
        return ctx.reply('No players yet. Be the first!');
    const msg = top.map((u, i) => `${i + 1}. ${u.username ?? 'anon'} — ${u.coins} coins`).join('\n');
    await ctx.reply(msg);
});
bot.hears('🛒 Market', async (ctx) => {
    const listings = await browseMarket(prisma);
    if (listings.length === 0)
        return ctx.reply('No active listings.');
    let msg = 'Market Listings:\n';
    msg += listings.map(l => `${l.card.name} (id:${l.cardId}) — ${l.price} coins`).join('\n');
    await ctx.reply(msg);
});
bot.action(/^market_refresh$/, async (ctx) => {
    await ctx.answerCbQuery();
    const listings = await browseMarket(prisma);
    if (listings.length === 0)
        return ctx.reply('No active listings.', marketKeyboard());
    for (const l of listings) {
        await ctx.reply(`${l.card.name} [${l.card.rarity}] — ${l.price} coins (qty ${l.quantity}) — by @${l.seller.username ?? 'anon'}`, listingActions(l.id));
    }
});
bot.action(/^buy_(\d+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const [, listingStr, qtyStr] = ctx.match;
    const listingId = Number(listingStr);
    const qty = Number(qtyStr);
    const user = await ensureUser(prisma, ctx.from);
    try {
        const res = await buyFromMarket(prisma, user.id, listingId, qty);
        await ctx.reply(`Purchased x${qty}. Spent ${res.spent} coins.`);
    }
    catch (e) {
        await ctx.reply(`Buy failed: ${e.message}`);
    }
});
bot.command('list', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const parts = (ctx.message.text || '').split(/\s+/);
    const cardId = Number(parts[1]);
    const qty = Number(parts[2]);
    const price = Number(parts[3]);
    if (!cardId || !qty || !price)
        return ctx.reply('Usage: /list <cardId> <qty> <price>');
    try {
        const listing = await listForSale(prisma, user.id, cardId, qty, price);
        await ctx.reply(`Listed ${qty} of card ${cardId} for ${price} coins each (listing ${listing.id}).`);
    }
    catch (e) {
        await ctx.reply(`List failed: ${e.message}`);
    }
});
bot.command('cancel', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const parts = (ctx.message.text || '').split(/\s+/);
    const listingId = Number(parts[1]);
    if (!listingId)
        return ctx.reply('Usage: /cancel <listingId>');
    try {
        const res = await cancelListing(prisma, user.id, listingId);
        if (res.ok)
            await ctx.reply('Listing cancelled.');
        else
            await ctx.reply(res.message);
    }
    catch (e) {
        await ctx.reply(`Cancel failed: ${e.message}`);
    }
});
bot.hears('🔁 Trade', async (ctx) => {
    await ctx.reply('Use: /trade <toUserId> <offeredCardId> <requestedCardId>');
});
bot.command('trade', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const parts = (ctx.message.text || '').split(/\s+/);
    const toUserId = Number(parts[1]);
    const offeredCardId = Number(parts[2]);
    const requestedCardId = Number(parts[3]);
    if (!toUserId || !offeredCardId || !requestedCardId)
        return ctx.reply('Usage: /trade <toUserId> <offeredCardId> <requestedCardId>');
    try {
        const t = await createTrade(prisma, user.id, toUserId, offeredCardId, requestedCardId);
        await ctx.reply(`Trade proposed (id ${t.id}). Recipient can /accept ${t.id} or /reject ${t.id}.`);
    }
    catch (e) {
        await ctx.reply(`Trade failed: ${e.message}`);
    }
});
bot.command('accept', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const parts = (ctx.message.text || '').split(/\s+/);
    const tradeId = Number(parts[1]);
    if (!tradeId)
        return ctx.reply('Usage: /accept <tradeId>');
    try {
        const res = await acceptTrade(prisma, tradeId, user.id);
        if (res.ok)
            await ctx.reply('Trade accepted.');
    }
    catch (e) {
        await ctx.reply(`Accept failed: ${e.message}`);
    }
});
bot.command('reject', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const parts = (ctx.message.text || '').split(/\s+/);
    const tradeId = Number(parts[1]);
    if (!tradeId)
        return ctx.reply('Usage: /reject <tradeId>');
    try {
        const res = await rejectTrade(prisma, tradeId, user.id);
        if (res.ok)
            await ctx.reply('Trade rejected.');
    }
    catch (e) {
        await ctx.reply(`Reject failed: ${e.message}`);
    }
});
bot.command('trades', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const trades = await myTrades(prisma, user.id);
    if (trades.length === 0)
        return ctx.reply('No trades.');
    await ctx.reply(trades.map(t => `#${t.id} from ${t.fromUserId} to ${t.toUserId} | offered ${t.offeredCardId} for ${t.requestedCardId} [${t.status}]`).join('\n'));
});
bot.command('help', async (ctx) => {
    await ctx.reply('/start, /help, /profile, /pack, /cards, /daily, /leaderboard, /list, /cancel, /trade, /accept, /reject, /trades');
});
bot.command('pack', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    try {
        const results = await openPackForUser(prisma, user.id);
        await ctx.reply('Pack result:\n' + results.map(r => '- ' + r.card.name + ' (' + r.card.rarity + ')').join('\n'));
    }
    catch (e) {
        const msg = e && e.message ? e.message : 'Failed to open pack.';
        await ctx.reply(msg);
    }
});
bot.command('cards', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const cards = await listUserCards(prisma, user.id);
    if (cards.length === 0)
        return ctx.reply('You have no cards yet. Try /pack');
    await ctx.reply(cards.map(c => `${c.card.name} x${c.quantity} [${c.card.rarity}] (id:${c.cardId})`).join('\n'));
});
bot.command('profile', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    await ctx.reply(`User: @${user.username ?? 'anon'}\nCoins: ${user.coins}`);
});
// Add player to market: /addpmarket card_id price
bot.command('addpmarket', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const parts = (ctx.message.text || '').split(/\s+/);
    const cardId = Number(parts[1]);
    const price = Number(parts[2]);
    if (!cardId || !price)
        return ctx.reply('Usage: /addpmarket <cardId> <price>');
    try {
        const listing = await listForSale(prisma, user.id, cardId, 1, price);
        await ctx.reply(`Listed 1 of card ${cardId} for ${price} coins (listing ${listing.id}).`);
    }
    catch (e) {
        await ctx.reply(`Add to market failed: ${e.message}`);
    }
});
// Buy player from market: /buypmarket card_id
bot.command('buypmarket', async (ctx) => {
    const user = await ensureUser(prisma, ctx.from);
    const parts = (ctx.message.text || '').split(/\s+/);
    const cardId = Number(parts[1]);
    if (!cardId)
        return ctx.reply('Usage: /buypmarket <cardId>');
    try {
        // Find active listing for this card
        const listings = await browseMarket(prisma);
        const listing = listings.find(l => l.cardId === cardId && l.active && l.quantity > 0);
        if (!listing)
            return ctx.reply('No active listing for this card.');
        const res = await buyFromMarket(prisma, user.id, listing.id, 1);
        await ctx.reply(`Purchased 1 of card ${cardId} for ${listing.price} coins. Seller @${listing.seller.username ?? 'anon'} received ${listing.price} coins.`);
    }
    catch (e) {
        await ctx.reply(`Buy from market failed: ${e.message}`);
    }
});
//# sourceMappingURL=bot.js.map