import { Telegraf, Markup, Scenes, session } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
type MyWizardContext = Scenes.WizardContext;
import { PrismaClient } from '@prisma/client';
import { ensureUser, openPackForUser, listUserCards, claimDaily, getLeaderboard } from '../services/game.js';

function isAdmin(user: {
  firstName?: string | null;
}) {
  return user.firstName === 'SP';
}

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is required');
}

const prisma = new PrismaClient();
const bot = new Telegraf(token);
export { bot, prisma }

// Do not need separate action handlers as we'll handle them in the wizard

// Command handlers that work in both private and group chats
bot.command('openpack', async (ctx) => {
  try {
    const user = await ensureUser(prisma, ctx.from);
    const results = await openPackForUser(prisma, user.id);
    // Format each card with the new template
    for (const result of results) {
      const message = `✪ You Collected A ${result.card.rarity} !!\n\n${result.card.name}\n➥ ${result.card.country}\n\nTake A Look At Your Collection Using /cards`;
      await ctx.reply(message, { ...getReplyParams(ctx) });
    }
  } catch (e: any) {
    const msg = e && e.message ? e.message : 'Failed to open pack.';
    await ctx.reply(msg, { ...getReplyParams(ctx) });
  }
});

// Helper function to send card details with image
const addCardWizard = new Scenes.WizardScene<MyWizardContext>(
  'add-card-wizard',
  // Step 1: Enter card name
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card = {}; // Initialize the card object
    await ctx.reply('Enter card name:', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    return ctx.wizard.next();
  },
  // Step 2: Enter card slug
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.name = ctx.message.text;
    
    await ctx.reply('Enter card slug (unique identifier):', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    return ctx.wizard.next();
  },
  // Step 3: Show rarity options
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.slug = ctx.message.text;
    (ctx.wizard.state as any).userId = ctx.from?.id; // Store user ID
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🥉 Common', callback_data: 'rarity_COMMON' },
          { text: '🥈 Medium', callback_data: 'rarity_MEDIUM' }
        ],
        [
          { text: '🥇 Rare', callback_data: 'rarity_RARE' },
          { text: '🟡 Legendary', callback_data: 'rarity_LEGENDARY' }
        ],
        [
          { text: '💮 Exclusive', callback_data: 'rarity_EXCLUSIVE' },
          { text: '🔮 Limited Edition', callback_data: 'rarity_LIMITED' }
        ],
        [
          { text: '💠 Cosmic', callback_data: 'rarity_COSMIC' },
          { text: '♠️ Prime', callback_data: 'rarity_PRIME' }
        ],
        [
          { text: '🧿 Premium', callback_data: 'rarity_PREMIUM' }
        ]
      ]
    };
    
    await ctx.reply('Select card rarity:', {
      reply_markup: keyboard,
      ...(reply_parameters ? { reply_parameters } : {})
    });
    return ctx.wizard.next();
  },
  // Step 4: Handle rarity selection and ask for country
  async (ctx) => {
    // Handle both message and callback_query updates
    if (ctx.callbackQuery) {
      const callbackQuery = ctx.callbackQuery as any;
      if (!callbackQuery.data?.startsWith('rarity_')) {
        await ctx.answerCbQuery('Invalid selection');
        return;
      }

      // Check if this is the user who started the wizard
      if (!ctx.from || ctx.from.id !== (ctx.wizard.state as any).userId) {
        await ctx.answerCbQuery('Only the user who started the command can select options');
        return;
      }

      const rarity = callbackQuery.data.replace('rarity_', '');
      (ctx.wizard.state as any).card.rarity = rarity;

      // Remove the inline keyboard and show selection
      await ctx.editMessageText(`Selected rarity: ${rarity}`);
      await ctx.answerCbQuery();

      // Move to country input
      await ctx.reply('Enter country/team:', { ...getReplyParams(ctx) });
      return ctx.wizard.next();
    }

    // If we get a message instead of a callback, remind to use buttons
    if (ctx.message) {
      await ctx.reply('Please use the buttons above to select a rarity');
      return;
    }
  },
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.country = ctx.message && 'text' in ctx.message ? (ctx.message as any).text : '';
    await ctx.reply('Enter role (e.g. Batsman, Bowler, All-rounder):', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.role = ctx.message && 'text' in ctx.message ? (ctx.message as any).text : '';
    await ctx.reply('Enter rating (number):', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.rating = Number(ctx.message && 'text' in ctx.message ? (ctx.message as any).text : '0');
    await ctx.reply('Enter bio (or type "skip"):', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.bio = ctx.message && 'text' in ctx.message && (ctx.message as any).text === 'skip' ? null : ctx.message && 'text' in ctx.message ? (ctx.message as any).text : null;
    await ctx.reply('Enter image URL (or type "skip"):', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    return ctx.wizard.next();
  },
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.imageUrl = ctx.message && 'text' in ctx.message && (ctx.message as any).text === 'skip' ? null : ctx.message && 'text' in ctx.message ? (ctx.message as any).text : null;
    try {
      const card = await prisma.card.create({ data: (ctx.wizard.state as any).card });
      await ctx.reply(`Card added: ${card.name} (${card.rarity})`, {
        ...(reply_parameters ? { reply_parameters } : {})
      });
    } catch (e: any) {
      await ctx.reply(`Error adding card: ${e.message}`, {
        ...(reply_parameters ? { reply_parameters } : {})
      });
    }
    return ctx.scene.leave();
  }
);

const stage = new Scenes.Stage<MyWizardContext>([addCardWizard]);
bot.use(session() as any);
bot.use(stage.middleware() as any);

bot.command('addcard', async (ctx) => {
  (ctx as any).scene.enter('add-card-wizard');
});

// Command to delete a card: /deletecard card_id (admin only)
bot.command('deletecard', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!isAdmin(user)) {
    return ctx.reply('You are not authorized to use this command.', { ...getReplyParams(ctx) });
  }
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) return ctx.reply('Usage: /deletecard <cardId>', { ...getReplyParams(ctx) });
  try {
    const deleted = await prisma.card.delete({ where: { id: cardId } });
    await ctx.reply(`Card deleted: ${deleted.name} (${deleted.rarity})`, { ...getReplyParams(ctx) });
  } catch (e: any) {
    await ctx.reply(`Error deleting card: ${e.message}`, { ...getReplyParams(ctx) });
  }
});
// Command to check card details: /check card_id
bot.command('check', async (ctx) => {
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) return ctx.reply('Usage: /check <cardId>', { ...getReplyParams(ctx) });
  try {
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return ctx.reply('Card not found.', { ...getReplyParams(ctx) });
    await sendCardDetails(ctx, card);
  } catch (e: any) {
    await ctx.reply('Error fetching card details.', { ...getReplyParams(ctx) });
  }
});

// Remove all active listings for a card by the user: /removepmarket card_id
bot.command('removepmarket', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) return ctx.reply('Usage: /removepmarket <cardId>', { ...getReplyParams(ctx) });
  try {
    // Find all active listings for this card by the user
    const listings = await prisma.listing.findMany({ where: { sellerId: user.id, cardId, active: true } });
    if (listings.length === 0) return ctx.reply('No active listings for this card found.', { ...getReplyParams(ctx) });
    let removed = 0;
    for (const listing of listings) {
      // Mark listing inactive and return quantity to user
      await prisma.listing.update({ where: { id: listing.id }, data: { active: false } });
      const existing = await prisma.ownership.findUnique({ where: { userId_cardId: { userId: user.id, cardId } } });
      if (existing) {
        await prisma.ownership.update({ where: { id: existing.id }, data: { quantity: { increment: listing.quantity } } });
      } else {
        await prisma.ownership.create({ data: { userId: user.id, cardId, quantity: listing.quantity } });
      }
      removed++;
    }
    await ctx.reply(`Removed ${removed} active listing(s) for card ${cardId} from market.`, { ...getReplyParams(ctx) });
  } catch (e: any) {
    await ctx.reply(`Remove from market failed: ${e.message}`, { ...getReplyParams(ctx) });
  }
});

bot.start(async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const name = user.username || user.firstName || 'collector';
  // Check for deep link start parameter (for card details)
  const startParam = ctx.startPayload;
  if (startParam && /^card\d+$/.test(startParam)) {
    const cardId = Number(startParam.replace('card', ''));
    if (cardId) {
      const card = await prisma.card.findUnique({ where: { id: cardId } });
      if (card) {
        await sendCardDetails(ctx, card);
        return;
      }
    }
  }
  await ctx.reply(
    `Welcome, ${name}!\nCollect, trade, and showcase cricket cards.`,
    {
      reply_markup: Markup.keyboard([
        ['🃏 Open Pack', '📇 My Cards'],
        ['🛒 Market', '🔁 Trade'],
        ['🏆 Leaderboard', '🎁 Daily'],
        ['ℹ️ Help']
      ]).resize(),
      ...getReplyParams(ctx)
    }
  );
});

function marketKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh', 'market_refresh')],
  ]);
}

function listingActions(listingId: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛒 Buy 1', `buy_${listingId}_1`)],
  ]);
}

bot.hears('🃏 Open Pack', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  try {
    const results = await openPackForUser(prisma, user.id);
    await ctx.reply('You opened a pack and pulled:\n' + results.map(r => '- ' + r.card.name + ' (' + r.card.rarity + ')').join('\n'), { ...getReplyParams(ctx) });
  } catch (e: any) {
    const msg = e && e.message ? e.message : 'Failed to open pack.';
    await ctx.reply(msg, { ...getReplyParams(ctx) });
  }
});

bot.hears('📇 My Cards', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const cards = await listUserCards(prisma, user.id);
  if (cards.length === 0) return ctx.reply('You have no cards yet. Try opening a pack!', { ...getReplyParams(ctx) });
  await ctx.reply(cards.map(c => `${c.card.name} x${c.quantity} [${c.card.rarity}] (id:${c.cardId})`).join('\n'), { ...getReplyParams(ctx) });
});

bot.hears('🎁 Daily', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const res = await claimDaily(prisma, user.id);
  if (!res.ok) return ctx.reply(res.message, { ...getReplyParams(ctx) });
  await ctx.reply(`Claimed ${res.coins} coins! Balance: ${res.balance}`, { ...getReplyParams(ctx) });
});

bot.hears('🏆 Leaderboard', async (ctx) => {
  const top = await getLeaderboard(prisma);
  if (top.length === 0) return ctx.reply('No players yet. Be the first!', { ...getReplyParams(ctx) });
  const msg = top.map((u, i) => `${i + 1}. ${u.username ?? 'anon'} — ${u.coins} coins`).join('\n');
  await ctx.reply(msg, { ...getReplyParams(ctx) });
});

bot.hears('🛒 Market', async (ctx) => {
  const listings = await browseMarket(prisma);
  if (listings.length === 0) return ctx.reply('No active listings.');
  let msg = 'Market Listings:\n';
  msg += listings.map(l => `${l.card.name} (id:${l.cardId}) — ${l.price} coins`).join('\n');
  await ctx.reply(msg);
});

bot.action(/^market_refresh$/, async (ctx) => {
  await ctx.answerCbQuery();
  const listings = await browseMarket(prisma);
  if (listings.length === 0) return ctx.reply('No active listings.', marketKeyboard());
  for (const l of listings) {
    await ctx.reply(`${l.card.name} [${l.card.rarity}] — ${l.price} coins (qty ${l.quantity}) — by @${l.seller.username ?? 'anon'}`, listingActions(l.id));
  }
});

bot.action(/^buy_(\d+)_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const [, listingStr, qtyStr] = ctx.match as unknown as string[];
  const listingId = Number(listingStr);
  const qty = Number(qtyStr);
  const user = await ensureUser(prisma, ctx.from);
  try {
    const res = await buyFromMarket(prisma, user.id, listingId, qty);
    await ctx.reply(`Purchased x${qty}. Spent ${res.spent} coins.`);
  } catch (e: any) {
    await ctx.reply(`Buy failed: ${e.message}`);
  }
});

bot.command('list', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  const qty = Number(parts[2]);
  const price = Number(parts[3]);
  if (!cardId || !qty || !price) return ctx.reply('Usage: /list <cardId> <qty> <price>');
  try {
    const listing = await listForSale(prisma, user.id, cardId, qty, price);
    await ctx.reply(`Listed ${qty} of card ${cardId} for ${price} coins each (listing ${listing.id}).`);
  } catch (e: any) {
    await ctx.reply(`List failed: ${e.message}`);
  }
});

bot.command('cancel', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const listingId = Number(parts[1]);
  if (!listingId) return ctx.reply('Usage: /cancel <listingId>');
  try {
    const res = await cancelListing(prisma, user.id, listingId);
    if (res.ok) await ctx.reply('Listing cancelled.');
    else await ctx.reply(res.message);
  } catch (e: any) {
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
  if (!toUserId || !offeredCardId || !requestedCardId) return ctx.reply('Usage: /trade <toUserId> <offeredCardId> <requestedCardId>');
  try {
    const t = await createTrade(prisma, user.id, toUserId, offeredCardId, requestedCardId);
    await ctx.reply(`Trade proposed (id ${t.id}). Recipient can /accept ${t.id} or /reject ${t.id}.`);
  } catch (e: any) {
    await ctx.reply(`Trade failed: ${e.message}`);
  }
});

bot.command('accept', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const tradeId = Number(parts[1]);
  if (!tradeId) return ctx.reply('Usage: /accept <tradeId>');
  try {
    const res = await acceptTrade(prisma, tradeId, user.id);
    if (res.ok) await ctx.reply('Trade accepted.');
  } catch (e: any) {
    await ctx.reply(`Accept failed: ${e.message}`);
  }
});

bot.command('reject', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const tradeId = Number(parts[1]);
  if (!tradeId) return ctx.reply('Usage: /reject <tradeId>');
  try {
    const res = await rejectTrade(prisma, tradeId, user.id);
    if (res.ok) await ctx.reply('Trade rejected.');
  } catch (e: any) {
    await ctx.reply(`Reject failed: ${e.message}`);
  }
});

bot.command('trades', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const trades = await myTrades(prisma, user.id);
  if (trades.length === 0) return ctx.reply('No trades.');
  await ctx.reply(trades.map(t => `#${t.id} from ${t.fromUserId} to ${t.toUserId} | offered ${t.offeredCardId} for ${t.requestedCardId} [${t.status}]`).join('\n'));
});

bot.command('help', async (ctx) => {
  await ctx.reply('/start, /help, /profile, /pack, /cards, /daily, /leaderboard, /list, /cancel, /trade, /accept, /reject, /trades');
});

bot.command('pack', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  try {
    const results = await openPackForUser(prisma, user.id);
    await ctx.reply('Pack result:\n' + results.map(r => '- ' + r.card.name + ' (' + r.card.rarity + ')').join('\n'), { ...getReplyParams(ctx) });
  } catch (e: any) {
    const msg = e && e.message ? e.message : 'Failed to open pack.';
    await ctx.reply(msg, { ...getReplyParams(ctx) });
  }
});

bot.command('cards', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const cards = await listUserCards(prisma, user.id);
  if (cards.length === 0) return ctx.reply('You have no cards yet. Try /pack', { ...getReplyParams(ctx) });
  await ctx.reply(cards.map(c => `${c.card.name} x${c.quantity} [${c.card.rarity}] (id:${c.cardId})`).join('\n'), { ...getReplyParams(ctx) });
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
  if (!cardId || !price) return ctx.reply('Usage: /addpmarket <cardId> <price>');
  try {
    const listing = await listForSale(prisma, user.id, cardId, 1, price);
    await ctx.reply(`Listed 1 of card ${cardId} for ${price} coins (listing ${listing.id}).`);
  } catch (e: any) {
    await ctx.reply(`Add to market failed: ${e.message}`);
  }
});

// Buy player from market: /buypmarket card_id
bot.command('buypmarket', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) return ctx.reply('Usage: /buypmarket <cardId>');
  try {
    // Find active listing for this card
    const listings = await browseMarket(prisma);
    const listing = listings.find(l => l.cardId === cardId && l.active && l.quantity > 0);
    if (!listing) return ctx.reply('No active listing for this card.');
    const res = await buyFromMarket(prisma, user.id, listing.id, 1);
    await ctx.reply(`Purchased 1 of card ${cardId} for ${listing.price} coins. Seller @${listing.seller.username ?? 'anon'} received ${listing.price} coins.`);
  } catch (e: any) {
    await ctx.reply(`Buy from market failed: ${e.message}`);
  }
});

// Command to change or add image for a card: /changeimage card_id image_link
bot.command('changeimage', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  const imageUrl = parts[2];
  if (!cardId || !imageUrl) {
    return ctx.reply('Usage: /changeimage <cardId> <imageUrl>');
  }
  try {
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return ctx.reply('Card not found.');
    const prevImage = (card as any).imageUrl;
    await prisma.card.update({ where: { id: cardId }, data: { imageUrl } as any });
    if (prevImage) {
      await ctx.reply('Image updated for card: ' + card.name);
    } else {
      await ctx.reply('Image added for card: ' + card.name);
    }
  } catch (e: any) {
    await ctx.reply('Failed to update image: ' + (e.message || e));
  }
});

// --- Group card drop feature ---

// In-memory maps to track group message counts and active card drops
const groupMessageCount: Map<number, number> = new Map();
const activeCardDrops: Map<number, {
  id: number;
  name: string;
  rarity: string;
  country: string;
  role: string;
  rating: number;
  bio?: string | null;
  imageUrl?: string | null;
  collected: boolean;
}> = new Map();

// Rarity emojis mapping
const RARITY_EMOJIS: {
  [key: string]: string;
} = {
  'COMMON': '🥉',
  'MEDIUM': '🥈',
  'RARE': '🥇',
  'LEGENDARY': '🟡',
  'EXCLUSIVE': '💮',
  'LIMITED_EDITION': '🔮',
  'COSMIC': '💠',
  'PRIME': '♠️',
  'PREMIUM': '🧿'
};

// Function to get emoji for a rarity
function getRarityWithEmoji(rarity: string): string {
  return `${RARITY_EMOJIS[rarity] || ''} ${rarity}`;
}

// Utility function to get a random card with weighted probabilities
async function getRandomCard(prisma: PrismaClient) {
  const rarityWeights = {
    'COMMON': 35,
    'MEDIUM': 25,
    'RARE': 15,
    'LEGENDARY': 10,
    'EXCLUSIVE': 6,
    'LIMITED_EDITION': 4,
    'COSMIC': 2.5,
    'PRIME': 1.5,
    'PREMIUM': 1
  };

  // Calculate total weight
  const totalWeight = Object.values(rarityWeights).reduce((sum, weight) => sum + weight, 0);
  let random = Math.random() * totalWeight;

  // Select rarity based on weights
  let selectedRarity = 'COMMON';
  for (const [rarity, weight] of Object.entries(rarityWeights)) {
    if (random <= weight) {
      selectedRarity = rarity;
      break;
    }
    random -= weight;
  }

  // Get all cards of selected rarity
  const cards = await prisma.card.findMany({
    where: { rarity: selectedRarity }
  });

  if (!cards.length) {
    // Fallback to any card if no cards of selected rarity exist
    const allCards = await prisma.card.findMany();
    if (!allCards.length) return null;
    return allCards[Math.floor(Math.random() * allCards.length)];
  }

  return cards[Math.floor(Math.random() * cards.length)];
}

// Middleware to count messages in groups and trigger card drop every 10 messages
bot.on("message", async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== 'private') { // only in groups
    const chatId = ctx.chat.id;
    let count = groupMessageCount.get(chatId) || 0;
    count += 1;
    groupMessageCount.set(chatId, count);

    // If an active card drop exists and it has been already collected, remove it to allow new drops
    const activeDrop = activeCardDrops.get(chatId);
    if (activeDrop && activeDrop.collected) {
      activeCardDrops.delete(chatId);
    }

    // If no active card drop exists and message count is a multiple of 10
    if (!activeCardDrops.has(chatId) && count % 10 === 0) {
      const card = await getRandomCard(prisma);
      if (card) {
  // Ensure card.imageUrl is present for drop (cast as any for type safety)
  const imageUrl = (card as any).imageUrl || null;
  activeCardDrops.set(chatId, { ...card, imageUrl, collected: false });

        // Send a single message (photo or text) with the 'Check details' button
        const botUsername = ctx.botInfo?.username || '';
        const startParam = encodeURIComponent(`card${card.id}`);
        const url = `https://t.me/${botUsername}?start=${startParam}`;
        const caption = `🌟ᴀ ɴᴇᴡ ᴏʀ ᴊᴜꜱᴛ ᴜɴʟᴏᴄᴋᴇᴅ! ᴄᴏʟʟᴇᴄᴛ ʜɪᴍ/ʜᴇʀ 🌟\n\nᴀᴄQᴜɪʀᴇ by typing the player name.`;
        const reply_markup = {
          inline_keyboard: [
            [{ text: 'Check details', url }]
          ]
        };
        const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
        if (imageUrl) {
          try {
            await ctx.telegram.sendPhoto(
              chatId,
              imageUrl,
              {
                caption,
                reply_markup,
                ...(reply_parameters ? { reply_parameters } : {})
              }
            );
          } catch (e) {
            await ctx.telegram.sendMessage(
              chatId,
              caption,
              { reply_markup, ...(reply_parameters ? { reply_parameters } : {}) }
            );
          }
        } else {
          await ctx.telegram.sendMessage(
            chatId,
            caption,
            { reply_markup, ...(reply_parameters ? { reply_parameters } : {}) }
          );
        }
      }
    }
  }
  return next();
});

// Helper function to get direct download URL from Google Drive link
function getGoogleDriveDirectUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'drive.google.com') {
      const idMatch = url.match(/\/d\/([^/]+)/);
      if (idMatch && idMatch[1]) {
        return `https://drive.google.com/uc?export=download&id=${idMatch[1]}`;
      }

      // Check for different format of drive URL
      const idParam = parsed.searchParams.get('id');
      if (idParam) {
        return `https://drive.google.com/uc?export=download&id=${idParam}`;
      }
    }
    return url;
  } catch {
    return url;
  }
}

// Helper function to validate image URL
function isValidImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'drive.google.com') {
      return true; // Accept Google Drive URLs
    }
    // Check if it's a direct image URL with common image extensions
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    return validExtensions.some(ext => parsed.pathname.toLowerCase().endsWith(ext));
  } catch {
    return false;
  }
}

// Helper function to send card details with image
async function sendCardDetails(ctx: any, card: any, chatId?: number) {
  // Always use ctx.telegram.sendPhoto for sending images, to avoid argument confusion

  // Debug log to verify arguments
  console.log('sendCardDetails called with:', {
    chatId: chatId || ctx.chat.id,
    imageUrl: card.imageUrl,
    card
  });

  if (typeof card.imageUrl !== 'string' || !card.imageUrl.startsWith('http')) {
    console.error('Invalid imageUrl:', card.imageUrl);
    // Fallback: If no image or image sending failed, send text-only message
    const cardDetails = `<b>Card details:</b>\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}\n<b>Rating:</b> ${card.rating}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
    await ctx.telegram.sendMessage(
      chatId || ctx.chat.id,
      cardDetails,
      { parse_mode: 'HTML', ...getReplyParams(ctx) }
    );
    return true;
  }

  try {
    const cardDetails = `<b>Card details:</b>\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}\n<b>Rating:</b> ${card.rating}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
    console.log('Calling sendPhoto with:', chatId || ctx.chat.id, card.imageUrl);
    await ctx.telegram.sendPhoto(
      chatId || ctx.chat.id,
      card.imageUrl,
      {
        caption: cardDetails,
        parse_mode: 'HTML',
        ...getReplyParams(ctx)
      }
    );
    return true;
  } catch (error) {
    console.error('Failed to send photo:', error);
    console.error('Image URL:', card.imageUrl);
    // Try to fetch the image and send as a buffer
    try {
      const response = await axios.get(card.imageUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data, 'binary');
      const cardDetails = `<b>Card details:</b>\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}\n<b>Rating:</b> ${card.rating}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
      try {
        await ctx.telegram.sendPhoto(
          chatId || ctx.chat.id,
          { source: buffer, filename: 'card.jpg' },
          {
            caption: cardDetails,
            parse_mode: 'HTML',
            ...getReplyParams(ctx)
          }
        );
        return true;
      } catch (bufferError) {
        console.error('Failed to send photo as buffer:', bufferError);
        // Fallback: Write buffer to temp file and send as file stream
        try {
          const tempPath = path.join('/tmp', `card_${Date.now()}.jpg`);
          fs.writeFileSync(tempPath, buffer);
          await ctx.telegram.sendPhoto(
            chatId || ctx.chat.id,
            { source: fs.createReadStream(tempPath) },
            {
              caption: cardDetails,
              parse_mode: 'HTML',
              ...getReplyParams(ctx)
            }
          );
          fs.unlinkSync(tempPath);
          return true;
        } catch (fileError) {
          console.error('Failed to send photo as file:', fileError);
        }
      }
    } catch (bufferError) {
      console.error('Failed to fetch image buffer:', bufferError);
    }
  }

  // Fallback: If image sending failed, send text-only message
  const cardDetails = `<b>Card details:</b>\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}\n<b>Rating:</b> ${card.rating}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
  await ctx.telegram.sendMessage(
    chatId || ctx.chat.id,
    cardDetails,
    { parse_mode: 'HTML', ...getReplyParams(ctx) }
  );
  return true;
}

// Updated Callback query handler to show complete card details
bot.on("callback_query", async (ctx, next) => {
  if ('data' in ctx.callbackQuery && ctx.callbackQuery.data === "check_card") {
    const userId = ctx.callbackQuery.from.id;
    let cardFound = false;
    // Iterate over active card drops to find an uncollected card
    for (const [chatId, card] of activeCardDrops.entries()) {
      if (!card.collected) {
        cardFound = await sendCardDetails(ctx, card, chatId);
        break;
      }
    }
    if (!cardFound) {
      await ctx.answerCbQuery("No active card drop available.");
    } else {
      await ctx.answerCbQuery("Card details sent in chat!");
    }
  } else {
    return next();
  }
});

// Handler for collecting the card in group chat when a user types the card name
bot.on("text", async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== 'private' && ctx.from) {
    const chatId = ctx.chat.id;
    const activeCard = activeCardDrops.get(chatId);
    if (activeCard && !activeCard.collected && ctx.message.text.trim().toLowerCase() === activeCard.name.toLowerCase()) {
      // Add card to user's collection
      const user = await ensureUser(prisma, ctx.from);
      try {
        // Check if user already has this card
        const existing = await prisma.ownership.findUnique({
          where: {
            userId_cardId: {
              userId: user.id,
              cardId: activeCard.id
            }
          }
        });

        if (existing) {
          // Increment quantity if user already has the card
          await prisma.ownership.update({
            where: { id: existing.id },
            data: { quantity: existing.quantity + 1 }
          });
        } else {
          // Create new ownership if user doesn't have the card
          await prisma.ownership.create({
            data: {
              userId: user.id,
              cardId: activeCard.id,
              quantity: 1
            }
          });
        }

        activeCard.collected = true;
        activeCardDrops.set(chatId, activeCard);
        const message = `✪ You Collected A ${activeCard.rarity} !!\n\n${activeCard.name}\n➥ ${activeCard.country}\n\nTake A Look At Your Collection Using /cards`;
        await ctx.reply(message, { ...getReplyParams(ctx) });
      } catch (error) {
        console.error('Error adding card to collection:', error);
        await ctx.reply('Error adding card to your collection.');
      }
    }
  }
  return next();
});

// Helper to always get reply_parameters for a ctx
function getReplyParams(ctx) {
  return ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {};
}

// Insert Group Command Admin Middleware
bot.use(async (ctx, next) => {
  if (ctx.chat && ctx.chat.type !== 'private' && ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string' && ctx.message.text.startsWith('/')) {
    if (!ctx.from) return next();
    try {
      const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
      if (member.status !== 'creator' && member.status !== 'administrator') {
        await ctx.reply('You must be an admin to use bot commands in group chats.');
        return;
      }
    } catch (e) {
      console.error('Error fetching chat member info:', e);
    }
  }
  return next();
});
