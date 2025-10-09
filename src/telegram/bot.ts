import { Telegraf, Markup, Scenes, session } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
type MyWizardContext = Scenes.WizardContext;
import { PrismaClient } from '@prisma/client';
import { ensureUser, openPackForUser, listUserCards, claimDaily, getLeaderboard } from '../services/game.js';
import { createTrade, acceptTrade, rejectTrade, myTrades } from '../services/trade.js';
import { browseMarket, listForSale, buyFromMarket, cancelListing } from '../services/market.js';

async function isAdmin(user: { id: number }): Promise<boolean> {
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id }
  });
  return (dbUser as any)?.isAdmin || false;
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
  // Step 1: Enter card name (slug will be auto-generated)
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card = {}; // Initialize the card object
    await ctx.reply('Enter card name:', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    return ctx.wizard.next();
  },
  // Step 2: Show rarity options
  async (ctx) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    const name = ctx.message.text;
    (ctx.wizard.state as any).card.name = name;
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
      const cardDetails = `<b>Card details:</b>\n<b>Card ID:</b> ${card.id}\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}${(card as any).bio ? `\n<b>Bio:</b> ${(card as any).bio}` : ''}`;
      await ctx.replyWithHTML(cardDetails, {
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
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin({ id: user.id })) {
    return ctx.reply('Only admins can use this command.');
  }
  (ctx as any).scene.enter('add-card-wizard');
});

// Command to delete a card: /deletecard card_id (admin only)
bot.command('deletecard', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin({ id: user.id })) {
    return ctx.reply('Only admins can use this command.', { ...getReplyParams(ctx) });
  }
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) return ctx.reply('Usage: /deletecard <cardId>', { ...getReplyParams(ctx) });
  try {
    // Delete all related data in a transaction
    const deleted = await prisma.$transaction(async (tx) => {
      // First get the card to ensure it exists
      const card = await tx.card.findUnique({
        where: { id: cardId },
        include: {
          ownerships: true,
          listings: true,
          offeredTrades: true,
          requestedTrades: true
        }
      });

      if (!card) {
        throw new Error('Card not found');
      }

      // Delete all related listings
      await tx.listing.deleteMany({
        where: { cardId }
      });

      // Delete all ownerships
      await tx.ownership.deleteMany({
        where: { cardId }
      });

      // Delete all trades where this card is involved
      await tx.trade.deleteMany({
        where: {
          OR: [
            { offeredCardId: cardId },
            { requestedCardId: cardId }
          ]
        }
      });

      // Finally delete the card
      return await tx.card.delete({
        where: { id: cardId }
      });
    });

    await ctx.reply(`Card deleted: ${deleted.name} (${deleted.rarity})\nAll related trades, listings, and ownerships have been removed.`, { ...getReplyParams(ctx) });
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
      ]).resize() as any,
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
  
  // Always start from first page when button is clicked
  const userId = ctx.from.id;
  userCardPages.set(userId, 0);
  
  const PAGE_SIZE = 5;
  const totalPages = Math.ceil(cards.length / PAGE_SIZE);
  const currentPage = userCardPages.get(userId) || 0;
  const start = currentPage * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageCards = cards.slice(start, end);
  
  const cardsList = pageCards.map(c => 
    `${getRarityWithEmoji(c.card.rarity)} ${c.card.name} (ID: ${c.cardId}) x${c.quantity}`
  ).join('\n');
  
  const message = `📇 Your Cards (Page ${currentPage + 1}/${totalPages}):\n\n${cardsList}`;
  
  // Create navigation buttons
  const buttons = [];
  if (currentPage > 0) {
    buttons.push({ text: '⬅️ Previous', callback_data: 'cards:prev' });
  }
  if (currentPage < totalPages - 1) {
    buttons.push({ text: 'Next ➡️', callback_data: 'cards:next' });
  }
  
  await ctx.reply(message, {
    ...getReplyParams(ctx),
    parse_mode: 'HTML',
    reply_markup: buttons.length ? {
      inline_keyboard: [buttons]
    } : undefined
  });
});

// Handle cards pagination
bot.action('cards:next', async (ctx) => {
  const userId = ctx.from.id;
  const currentPage = userCardPages.get(userId) || 0;
  userCardPages.set(userId, currentPage + 1);
  
  // Re-display cards with new page
  const user = await ensureUser(prisma, ctx.from);
  const cards = await listUserCards(prisma, user.id);
  
  const PAGE_SIZE = 5;
  const totalPages = Math.ceil(cards.length / PAGE_SIZE);
  const start = (currentPage + 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageCards = cards.slice(start, end);
  
  const cardsList = pageCards.map(c => 
    `${getRarityWithEmoji(c.card.rarity)} ${c.card.name} (ID: ${c.cardId}) x${c.quantity}`
  ).join('\n');
  
  const message = `📇 Your Cards (Page ${currentPage + 2}/${totalPages}):\n\n${cardsList}`;
  
  // Update navigation buttons
  const buttons = [];
  if (currentPage + 1 > 0) {
    buttons.push({ text: '⬅️ Previous', callback_data: 'cards:prev' });
  }
  if (currentPage + 1 < totalPages - 1) {
    buttons.push({ text: 'Next ➡️', callback_data: 'cards:next' });
  }
  
  await ctx.editMessageText(message, {
    parse_mode: 'HTML',
    reply_markup: buttons.length ? {
      inline_keyboard: [buttons]
    } : undefined
  });
  await ctx.answerCbQuery();
});

// Handle gift acceptance
bot.action(/accept_gift:(.+)/, async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const giftId = ctx.match[1];
  
  try {
    const gift = pendingGifts.get(giftId);
    if (!gift) {
      await ctx.answerCbQuery('Gift not found or expired.');
      return;
    }

    // Check if this user is the gift sender
    if (gift.fromUserId !== user.id) {
      await ctx.answerCbQuery('Only the gift sender can confirm the gift.');
      return;
    }

    // Transfer the card
    await prisma.$transaction(async (tx) => {
      // Decrease sender's quantity
      const senderOwnership = await tx.ownership.findUnique({
        where: { userId_cardId: { userId: gift.fromUserId, cardId: gift.cardId } },
        include: { card: true }
      });

      if (!senderOwnership || senderOwnership.quantity < 1) {
        throw new Error('Sender no longer has this card.');
      }

      await tx.ownership.update({
        where: { id: senderOwnership.id },
        data: { quantity: { decrement: 1 } }
      });

      // Increase recipient's quantity or create new ownership
      const recipientOwnership = await tx.ownership.findUnique({
        where: { userId_cardId: { userId: gift.toUserId, cardId: gift.cardId } }
      });

      if (recipientOwnership) {
        await tx.ownership.update({
          where: { id: recipientOwnership.id },
          data: { quantity: { increment: 1 } }
        });
      } else {
        await tx.ownership.create({
          data: {
            userId: gift.toUserId,
            cardId: gift.cardId,
            quantity: 1
          }
        });
      }

      // Remove the pending gift
      pendingGifts.delete(giftId);

      await ctx.editMessageText(
        `✅ Gift Sent!\n\n` +
        `Card: ${senderOwnership.card.name} (#${gift.cardId})\n` +
        `To: Player #${gift.toUserId}`
      );
    });

    await ctx.answerCbQuery('Gift sent successfully!');
  } catch (e: any) {
    await ctx.answerCbQuery(`Gift acceptance failed: ${e.message}`);
  }
});

// Handle gift rejection
bot.action(/reject_gift:(.+)/, async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const giftId = ctx.match[1];
  
  try {
    const gift = pendingGifts.get(giftId);
    if (!gift) {
      await ctx.answerCbQuery('Gift not found or expired.');
      return;
    }

    // Check if this user is the gift sender
    if (gift.fromUserId !== user.id) {
      await ctx.answerCbQuery('Only the gift sender can cancel the gift.');
      return;
    }

    // Remove the pending gift
    pendingGifts.delete(giftId);

    await ctx.editMessageText(
      `❌ Gift Rejected\n\n` +
      `Card #${gift.cardId} gift was declined.`
    );
    await ctx.answerCbQuery('Gift rejected successfully.');
  } catch (e: any) {
    await ctx.answerCbQuery(`Gift rejection failed: ${e.message}`);
  }
});

// Handle rarity selection callback
bot.action(/^cards_rarity:(.+)$/, async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const rarity = ctx.match[1];
  
  // Get cards of selected rarity
  const cards = await prisma.ownership.findMany({
    where: {
      userId: user.id,
      card: {
        rarity: rarity
      }
    },
    include: {
      card: true
    },
    orderBy: {
      cardId: 'asc'
    }
  });

  if (cards.length === 0) {
    await ctx.answerCbQuery();
    return ctx.editMessageText(`You don't have any ${rarity.toLowerCase()} cards.`);
  }

  const cardsList = cards.map(ownership => 
    `${getRarityWithEmoji(ownership.card.rarity)} ${ownership.card.name} (ID: ${ownership.cardId}) x${ownership.quantity}`
  ).join('\n');

  const message = `Your ${rarity} Cards:\n\n${cardsList}`;

  await ctx.answerCbQuery();
  await ctx.editMessageText(message, { parse_mode: 'HTML' });
});

bot.action('cards:prev', async (ctx) => {
  const userId = ctx.from.id;
  const currentPage = userCardPages.get(userId) || 0;
  userCardPages.set(userId, currentPage - 1);
  
  // Re-display cards with new page
  const user = await ensureUser(prisma, ctx.from);
  const cards = await listUserCards(prisma, user.id);
  
  const PAGE_SIZE = 5;
  const totalPages = Math.ceil(cards.length / PAGE_SIZE);
  const start = (currentPage - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageCards = cards.slice(start, end);
  
  const cardsList = pageCards.map(c => 
    `${getRarityWithEmoji(c.card.rarity)} ${c.card.name} (ID: ${c.cardId}) x${c.quantity}`
  ).join('\n');
  
  const message = `📇 Your Cards (Page ${currentPage}/${totalPages}):\n\n${cardsList}`;
  
  // Update navigation buttons
  const buttons = [];
  if (currentPage - 1 > 0) {
    buttons.push({ text: '⬅️ Previous', callback_data: 'cards:prev' });
  }
  if (currentPage - 1 < totalPages - 1) {
    buttons.push({ text: 'Next ➡️', callback_data: 'cards:next' });
  }
  
  await ctx.editMessageText(message, {
    parse_mode: 'HTML',
    reply_markup: buttons.length ? {
      inline_keyboard: [buttons]
    } : undefined
  });
  await ctx.answerCbQuery();
});

// Handle /cards command with different modes
bot.command('cards', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  
  // Case 1: /cards rarity - Show rarity selection buttons
  if (parts[1]?.toLowerCase() === 'rarity') {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🥉 Common', callback_data: 'cards_rarity:COMMON' },
          { text: '🥈 Medium', callback_data: 'cards_rarity:MEDIUM' }
        ],
        [
          { text: '🥇 Rare', callback_data: 'cards_rarity:RARE' },
          { text: '🟡 Legendary', callback_data: 'cards_rarity:LEGENDARY' }
        ],
        [
          { text: '💮 Exclusive', callback_data: 'cards_rarity:EXCLUSIVE' },
          { text: '🔮 Limited Edition', callback_data: 'cards_rarity:LIMITED' }
        ],
        [
          { text: '💠 Cosmic', callback_data: 'cards_rarity:COSMIC' },
          { text: '♠️ Prime', callback_data: 'cards_rarity:PRIME' }
        ],
        [
          { text: '🧿 Premium', callback_data: 'cards_rarity:PREMIUM' }
        ]
      ]
    };
    
    return await ctx.reply('Select a rarity to view your cards:', {
      reply_markup: keyboard
    });
  }

  // Case 2: /cards <card_id> - Show specific card count
  const cardId = Number(parts[1]);
  if (!isNaN(cardId)) {
    // First check if the card exists
    const card = await prisma.card.findUnique({
      where: { id: cardId }
    });

    if (!card) {
      return ctx.reply(`Card #${cardId} does not exist.`);
    }

    // Then check if user owns it
    const ownership = await prisma.ownership.findFirst({
      where: {
        userId: user.id,
        cardId: cardId
      },
      include: {
        card: true
      }
    });

    if (!ownership) {
      return ctx.reply(`You don't own card #${cardId}.`);
    }

    return ctx.reply(
      `Card #${cardId}: ${ownership.card.name}\n` +
      `Rarity: ${getRarityWithEmoji(ownership.card.rarity)}\n` +
      `Quantity: x${ownership.quantity}`
    );
  }

  // Case 3: /cards - Show all cards (paginated)
  const cards = await listUserCards(prisma, user.id);
  if (cards.length === 0) return ctx.reply('You have no cards yet. Try opening a pack!', { ...getReplyParams(ctx) });
  
  // Always start from first page when command is used
  const userId = ctx.from.id;
  userCardPages.set(userId, 0);
  
  const PAGE_SIZE = 5;
  const totalPages = Math.ceil(cards.length / PAGE_SIZE);
  const currentPage = userCardPages.get(userId) || 0;
  const start = currentPage * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageCards = cards.slice(start, end);
  
  const cardsList = pageCards.map(c => 
    `${getRarityWithEmoji(c.card.rarity)} ${c.card.name} (ID: ${c.cardId}) x${c.quantity}`
  ).join('\n');
  
  const message = `📇 Your Cards (Page ${currentPage + 1}/${totalPages}):\n\n${cardsList}`;
  
  // Create navigation buttons
  const buttons = [];
  if (currentPage > 0) {
    buttons.push({ text: '⬅️ Previous', callback_data: 'cards:prev' });
  }
  if (currentPage < totalPages - 1) {
    buttons.push({ text: 'Next ➡️', callback_data: 'cards:next' });
  }
  
  await ctx.reply(message, {
    ...getReplyParams(ctx),
    parse_mode: 'HTML',
    reply_markup: buttons.length ? {
      inline_keyboard: [buttons]
    } : undefined
  });
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
  await ctx.reply('Reply to a user\'s message with: /trade <offeredCardId> <requestedCardId>');
});

bot.hears(/^(?:\/)?trade\s+(\d+)\s+(\d+)$/i, async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const offeredCardId = Number(ctx.match[1]);
  const requestedCardId = Number(ctx.match[2]);

  // Check if this is a reply to someone
  const replyToMessage = ctx.message.reply_to_message;
  if (!replyToMessage || !replyToMessage.from) {
    return ctx.reply('You must reply to a user\'s message to propose a trade.');
  }

  // Get target user from the replied message
  const toUserId = replyToMessage.from.id;

  // Check that user is not trying to trade with themselves
  if (toUserId === ctx.from.id) {
    return ctx.reply('You cannot trade with yourself.');
  }

  try {
    // Ensure the target user exists in our database
    const targetUser = await ensureUser(prisma, replyToMessage.from);

    // Create the trade
    const t = await createTrade(prisma, user.id, targetUser.id, offeredCardId, requestedCardId);
    
    const userMention = replyToMessage.from.username 
      ? `@${replyToMessage.from.username}`
      : replyToMessage.from.first_name;

    // Get card details
    const [offeredCard, requestedCard] = await Promise.all([
      prisma.card.findUnique({ where: { id: offeredCardId } }),
      prisma.card.findUnique({ where: { id: requestedCardId } })
    ]);

    if (!offeredCard || !requestedCard) {
      throw new Error('One or both cards not found');
    }

    // Send notification about the trade with inline buttons
    await ctx.reply(
      `📨 Trade Proposal\n\n` +
      `From: ${ctx.from.first_name}\n` +
      `To: ${userMention}\n\n` +
      `Offering: ${offeredCard.name} (#${offeredCardId})\n` +
      `For: ${requestedCard.name} (#${requestedCardId})`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Accept', callback_data: `accept_trade:${t.id}` },
              { text: '❌ Reject', callback_data: `reject_trade:${t.id}` }
            ]
          ]
        }
      }
    );
  } catch (e: any) {
    await ctx.reply(`Trade failed: ${e.message}`);
  }
});

// Handle inline button callbacks for trades
bot.action(/accept_trade:(\d+)/, async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const tradeId = Number(ctx.match[1]);
  
  try {
    // Get trade details first
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        fromUser: true,
        toUser: true,
        offeredCard: true,
        requestedCard: true
      }
    });

    if (!trade) {
      await ctx.answerCbQuery('Trade not found.');
      return;
    }

    // Check if this user is the trade recipient
    if (trade.toUserId !== user.id) {
      await ctx.answerCbQuery('Only the trade recipient can accept the trade.');
      return;
    }

    const res = await acceptTrade(prisma, tradeId, user.id);
    if (res.ok) {
      // Construct user reference
      const fromUserRef = trade.fromUser.username 
        ? `@${trade.fromUser.username}`
        : trade.fromUser.firstName || 'User';

      await ctx.editMessageText(
        `✅ Trade accepted!\n` +
        `Received Card #${trade.offeredCard.id} (${trade.offeredCard.name}) from ${fromUserRef}\n` +
        `Sent Card #${trade.requestedCard.id} (${trade.requestedCard.name})`
      );
      await ctx.answerCbQuery('Trade accepted successfully!');
    }
  } catch (e: any) {
    await ctx.answerCbQuery(`Accept failed: ${e.message}`);
  }
});

bot.action(/reject_trade:(\d+)/, async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const tradeId = Number(ctx.match[1]);
  
  try {
    // Get trade details first
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        fromUser: true,
        toUser: true,
        offeredCard: true,
        requestedCard: true
      }
    });

    if (!trade) {
      await ctx.answerCbQuery('Trade not found.');
      return;
    }

    // Check if this user is the trade recipient
    if (trade.toUserId !== user.id) {
      await ctx.answerCbQuery('Only the trade recipient can reject the trade.');
      return;
    }

    const res = await rejectTrade(prisma, tradeId, user.id);
    if (res.ok) {
      // Construct user reference
      const fromUserRef = trade.fromUser.username 
        ? `@${trade.fromUser.username}`
        : trade.fromUser.firstName || 'User';

      await ctx.editMessageText(
        `❌ Trade rejected.\n` +
        `Declined offer from ${fromUserRef}:\n` +
        `Their Card #${trade.offeredCard.id} (${trade.offeredCard.name})\n` +
        `For Your Card #${trade.requestedCard.id} (${trade.requestedCard.name})`
      );
      await ctx.answerCbQuery('Trade rejected successfully!');
    }
  } catch (e: any) {
    await ctx.answerCbQuery(`Reject failed: ${e.message}`);
  }
});

bot.command('accept', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const tradeId = Number(parts[1]);
  if (!tradeId) return ctx.reply('Please use the Accept button on the trade message instead.');
  try {
    // Get trade details first
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        fromUser: true,
        toUser: true,
        offeredCard: true,
        requestedCard: true
      }
    });

    if (!trade) {
      return ctx.reply('Trade not found.');
    }

    const res = await acceptTrade(prisma, tradeId, user.id);
    if (res.ok) {
      // Construct user references
      const fromUserRef = trade.fromUser.username 
        ? `@${trade.fromUser.username}`
        : trade.fromUser.firstName || 'User';

      await ctx.reply(
        `Trade accepted!\n` +
        `Received Card #${trade.offeredCard.id} (${trade.offeredCard.name}) from ${fromUserRef}\n` +
        `Sent Card #${trade.requestedCard.id} (${trade.requestedCard.name})`
      );
    }
  } catch (e: any) {
    await ctx.reply(`Accept failed: ${e.message}`);
  }
});

bot.command('reject', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const tradeId = Number(parts[1]);
  if (!tradeId) return ctx.reply('Please use the Reject button on the trade message instead.');
  try {
    // Get trade details first
    const trade = await prisma.trade.findUnique({
      where: { id: tradeId },
      include: {
        fromUser: true,
        offeredCard: true,
        requestedCard: true
      }
    });

    if (!trade) {
      return ctx.reply('Trade not found.');
    }

    const res = await rejectTrade(prisma, tradeId, user.id);
    if (res.ok) {
      // Construct user reference
      const fromUserRef = trade.fromUser.username 
        ? `@${trade.fromUser.username}`
        : trade.fromUser.firstName || 'User';

      await ctx.reply(
        `Trade rejected.\n` +
        `Declined offer from ${fromUserRef}:\n` +
        `Their Card #${trade.offeredCard.id} (${trade.offeredCard.name})\n` +
        `For Your Card #${trade.requestedCard.id} (${trade.requestedCard.name})`
      );
    }
  } catch (e: any) {
    await ctx.reply(`Reject failed: ${e.message}`);
  }
});

bot.command('trades', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  
  // Get trades with full card and user details
  const trades = await prisma.trade.findMany({
    where: {
      OR: [
        { fromUserId: user.id },
        { toUserId: user.id }
      ]
    },
    include: {
      fromUser: true,
      toUser: true,
      offeredCard: true,
      requestedCard: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  if (trades.length === 0) return ctx.reply('No trades.');

  const tradeMessages = trades.map(t => {
    const isOutgoing = t.fromUserId === user.id;
    const otherUser = isOutgoing ? t.toUser : t.fromUser;
    const otherUserRef = otherUser.username 
      ? `@${otherUser.username}`
      : otherUser.firstName || 'User';

    return `Trade #${t.id} [${t.status}]\n` +
           `${isOutgoing ? 'To' : 'From'}: ${otherUserRef}\n` +
           `${isOutgoing ? 'Offering' : 'Offered'}: #${t.offeredCard.id} (${t.offeredCard.name})\n` +
           `${isOutgoing ? 'For Their' : 'For Your'}: #${t.requestedCard.id} (${t.requestedCard.name})\n`;
  });

  await ctx.reply(tradeMessages.join('\n'));
});

// Admin command to set the card drop rate for a group
bot.command('droprate', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin({ id: user.id })) {
    return ctx.reply('Only admins can use this command.');
  }

  // Only work in group chats
  if (!ctx.chat || ctx.chat.type === 'private') {
    return ctx.reply('This command only works in group chats.');
  }

  const parts = ctx.message.text.split(' ');
  const chatId = ctx.chat.id;
  
  if (parts.length === 1) {
    const currentRate = groupDropRates.get(chatId) || DEFAULT_DROP_RATE;
    return ctx.reply(`Current drop rate: every ${currentRate} messages`);
  }

  if (isNaN(Number(parts[1])) || Number(parts[1]) < 1) {
    return ctx.reply('Usage: /droprate <number>\nNumber must be positive.');
  }

  const newDropRate = Math.floor(Number(parts[1]));
  groupDropRates.set(chatId, newDropRate);
  // Reset message count to avoid unexpected drops
  groupMessageCount.set(chatId, 0);

  await ctx.reply(`Card drop rate set to every ${newDropRate} messages.`);
});

bot.command('gift', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  
  // Check if command is a reply to someone's message
  const replyToMessage = ctx.message.reply_to_message;
  if (!replyToMessage || !replyToMessage.from) {
    return ctx.reply('You must reply to a user\'s message to gift a card.\nUsage: Reply with /gift <cardId>');
  }

  // Parse command parameters
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);

  if (!cardId) {
    return ctx.reply('Usage: Reply with /gift <cardId>');
  }

  // Get target user from the replied message
  const toUserId = replyToMessage.from.id;

  // Check that user is not trying to gift to themselves
  if (toUserId === ctx.from.id) {
    return ctx.reply('You cannot gift a card to yourself.');
  }

  try {
    // Check if user owns the card
    const ownership = await prisma.ownership.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      },
      include: {
        card: true
      }
    });

    if (!ownership) {
      return ctx.reply('You don\'t own this card.');
    }

    if (ownership.quantity < 1) {
      return ctx.reply('You don\'t have enough copies of this card to gift.');
    }

    // Ensure the target user exists in our database
    const targetUser = await ensureUser(prisma, replyToMessage.from);

    const userMention = replyToMessage.from.username 
      ? `@${replyToMessage.from.username}`
      : replyToMessage.from.first_name;

    // Store gift details in memory
    const giftId = Date.now().toString();
    pendingGifts.set(giftId, {
      fromUserId: user.id,
      toUserId: targetUser.id,
      cardId: cardId
    });

    // Send gift proposal with buttons
    await ctx.reply(
      `🎁 Gift Proposal\n\n` +
      `To: ${userMention}\n` +
      `Card: ${ownership.card.name} (#${cardId})\n` +
      `Rarity: ${getRarityWithEmoji(ownership.card.rarity)}\n\n` +
      `Do you want to confirm this gift?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Confirm Gift', callback_data: `accept_gift:${giftId}` },
              { text: '❌ Cancel', callback_data: `reject_gift:${giftId}` }
            ]
          ]
        }
      }
    );
  } catch (e: any) {
    await ctx.reply(`Gift failed: ${e.message}`);
  }
});

bot.command('help', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const isUserAdmin = await isAdmin({ id: user.id });
  let helpText = '/start, /help, /profile, /pack, /cards, /daily, /leaderboard, /list, /cancel, /trade, /gift, /trades';
  if (isUserAdmin) {
    helpText += '\n\nAdmin commands:\n/addcard - Add a new card\n/deletecard - Delete a card\n/makeadmin - Make another user an admin\n/removeadmin - Remove admin rights from a user\n/droprate <number> - Set messages required for card drop';
  }
  await ctx.reply(helpText);
});

// Command to make a user an admin (only existing admins can use this)
bot.command('makeadmin', async (ctx) => {
  const adminUser = await ensureUser(prisma, ctx.from);
  if (!await isAdmin({ id: adminUser.id })) {
    return ctx.reply('Only admins can use this command.');
  }
  
  // Check if command is a reply to someone's message
  const replyToMessage = ctx.message.reply_to_message;
  let targetUser = null;

  try {
    if (replyToMessage && replyToMessage.from) {
      // If replying to a message, get that user
      targetUser = await prisma.user.findFirst({
        where: { telegramId: replyToMessage.from.id.toString() }
      });
    } else {
      // If not a reply, check for username parameter
      const parts = ctx.message.text.split(' ');
      if (parts.length !== 2) {
        return ctx.reply('Usage: Reply to a message with /makeadmin OR use /makeadmin <telegram_username>');
      }
      
      const username = parts[1].replace('@', '');
      targetUser = await prisma.user.findFirst({
        where: { username }
      });
    }
    
    if (!targetUser) {
      return ctx.reply('User not found. They need to interact with the bot first.');
    }
    
    await prisma.user.update({
      where: { id: targetUser.id },
      data: { isAdmin: true } as any
    });
    
    // Construct user reference for the message
    const userReference = replyToMessage && replyToMessage.from 
      ? replyToMessage.from.username 
        ? `@${replyToMessage.from.username}` 
        : replyToMessage.from.first_name
      : targetUser.username 
        ? `@${targetUser.username}` 
        : targetUser.firstName || 'User';
    
    await ctx.reply(`${userReference} is now an admin.`);
  } catch (e: any) {
    await ctx.reply(`Failed to make user an admin: ${e.message}`);
  }
});

// Command to remove admin rights from a user (only existing admins can use this)
bot.command('removeadmin', async (ctx) => {
  const adminUser = await ensureUser(prisma, ctx.from);
  if (!await isAdmin({ id: adminUser.id })) {
    return ctx.reply('Only admins can use this command.');
  }
  
  // Check if command is a reply to someone's message
  const replyToMessage = ctx.message.reply_to_message;
  let targetUser = null;
  
  try {
    if (replyToMessage && replyToMessage.from) {
      // If replying to a message, get that user
      targetUser = await prisma.user.findFirst({
        where: { telegramId: replyToMessage.from.id.toString() }
      });
    } else {
      // If not a reply, check for username parameter
      const parts = ctx.message.text.split(' ');
      if (parts.length !== 2) {
        return ctx.reply('Usage: Reply to a message with /removeadmin OR use /removeadmin <telegram_username>');
      }
      
      const username = parts[1].replace('@', '');
      targetUser = await prisma.user.findFirst({
        where: { username }
      });
    }
    
    if (!targetUser) {
      return ctx.reply('User not found. They need to interact with the bot first.');
    }
    
    await prisma.user.update({
      where: { id: targetUser.id },
      data: { isAdmin: false } as any
    });
    
    // Construct user reference for the message
    const userReference = replyToMessage && replyToMessage.from 
      ? replyToMessage.from.username 
        ? `@${replyToMessage.from.username}` 
        : replyToMessage.from.first_name
      : targetUser.username 
        ? `@${targetUser.username}` 
        : targetUser.firstName || 'User';
    
    await ctx.reply(`${userReference} is no longer an admin.`);
  } catch (e: any) {
    await ctx.reply(`Failed to remove admin rights: ${e.message}`);
  }
});

bot.command('pack', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  try {
    const results = await openPackForUser(prisma, user.id);
    for (const result of results) {
      const cardDetails = `<b>You opened a new card!</b>\n<b>Card ID:</b> ${result.card.id}\n<b>Name:</b> ${result.card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(result.card.rarity)}\n<b>Country:</b> ${result.card.country}\n<b>Role:</b> ${result.card.role}${(result.card as any).bio ? `\n<b>Bio:</b> ${(result.card as any).bio}` : ''}`;
      await ctx.replyWithHTML(cardDetails, { ...getReplyParams(ctx) });
    }
  } catch (e: any) {
    const msg = e && e.message ? e.message : 'Failed to open pack.';
    await ctx.reply(msg, { ...getReplyParams(ctx) });
  }
});

bot.command('cards', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const cards = await listUserCards(prisma, user.id);
  if (cards.length === 0) return ctx.reply('You have no cards yet. Try /pack', { ...getReplyParams(ctx) });
  const cardsList = cards.map(c => `<b>Card ID:</b> ${c.cardId}\n<b>Name:</b> ${c.card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(c.card.rarity)}\n<b>Country:</b> ${c.card.country}\n<b>Role:</b> ${c.card.role}\n<b>Quantity:</b> x${c.quantity}`).join('\n\n');
  await ctx.replyWithHTML(cardsList, { ...getReplyParams(ctx) });
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

// In-memory maps to track group message counts, drop rates, and active card drops
const groupMessageCount: Map<number, number> = new Map();
const groupDropRates: Map<number, number> = new Map();
const DEFAULT_DROP_RATE = 10;
// Store user's current page for cards command
const userCardPages = new Map<number, number>();
// Store pending gift proposals
const pendingGifts = new Map<string, { fromUserId: number; toUserId: number; cardId: number; }>();

const activeCardDrops: Map<number, {
  id: number;
  name: string;
  rarity: string;
  country: string;
  role: string;
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

    // Get the drop rate for this chat, or use default
    const dropRate = groupDropRates.get(chatId) || DEFAULT_DROP_RATE;
    
    // Drop a new card when message count reaches the drop rate
    if (count % dropRate === 0) {
      // Clear any existing card drop before adding a new one
      if (activeCardDrops.has(chatId)) {
        const previousCard = activeCardDrops.get(chatId);
        // if (!previousCard?.collected) {
        //   // Notify that the previous card was missed
        //   await ctx.reply('⌛️ The previous card disappeared into the void...');
        // }
        activeCardDrops.delete(chatId);
      }
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
            [{ text: '📩 ᴄʜᴇᴄᴋ ɴᴀᴍᴇ ɪɴ ᴅᴍ', url }]
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
    const cardDetails = `<b>Card details:</b>\n<b>Card ID:</b> ${card.id}\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
    await ctx.telegram.sendMessage(
      chatId || ctx.chat.id,
      cardDetails,
      { parse_mode: 'HTML', ...getReplyParams(ctx) }
    );
    return true;
  }

  try {
    const cardDetails = `<b>Card details:</b>\n<b>Card ID:</b> ${card.id}\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
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
      const cardDetails = `<b>Card details:</b>\n<b>Card ID:</b> ${card.id}\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
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
  const cardDetails = `<b>Card details:</b>\n<b>Card ID:</b> ${card.id}\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
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
    if (activeCard && !activeCard.collected) {
      // Split the card name and user's message into words
      const cardNameParts = activeCard.name.toLowerCase().split(/\s+/);
      const userMessageParts = ctx.message.text.trim().toLowerCase().split(/\s+/);
      
      // Check if any part of the user's message matches any part of the card name
      const isMatch = userMessageParts.some(msgPart => 
        // Check if this part matches the full card name
        activeCard.name.toLowerCase() === msgPart ||
        // Or if it matches any part of the card name
        cardNameParts.some(namePart => namePart === msgPart)
      );
      
      if (isMatch) {
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
  }
  return next();
});

// Helper to always get reply_parameters for a ctx
function getReplyParams(ctx: any) {
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