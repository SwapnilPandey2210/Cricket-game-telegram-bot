import { Telegraf, Markup } from 'telegraf';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { PrismaClient } from '@prisma/client';
import { ensureUser, openPackForUser, listUserCards, claimDaily, getLeaderboard } from '../services/game.js';
import { createTrade, acceptTrade, rejectTrade, myTrades } from '../services/trade.js';
import { browseMarket, listForSale, buyFromMarket, cancelListing } from '../services/market.js';

async function isAdmin(user: { isAdmin: boolean }): Promise<boolean> {
  return user.isAdmin || false;
}

// Helper function to get the next available card ID
async function getNextCardId(prisma: PrismaClient): Promise<number> {
  const existingCards = await prisma.card.findMany({
    select: { id: true },
    orderBy: { id: 'asc' }
  });
  
  const existingIds = new Set(existingCards.map(card => card.id));
  
  // Find the first missing ID starting from 1
  for (let id = 1; id <= existingCards.length + 1; id++) {
    if (!existingIds.has(id)) {
      return id;
    }
  }
  
  // If no gaps found, return the next sequential ID
  return existingCards.length + 1;
}

// Helper function to reorder card IDs to fill gaps
async function reorderCardIds(prisma: PrismaClient): Promise<void> {
  const existingCards = await prisma.card.findMany({
    orderBy: { id: 'asc' }
  });
  
  if (existingCards.length === 0) return;
  
  // Check if there are gaps
  const hasGaps = existingCards.some((card, index) => card.id !== index + 1);
  
  if (!hasGaps) return; // No gaps to fill
  
  console.log('Reordering card IDs to fill gaps...');
  
  // Create a mapping of old IDs to new sequential IDs
  const idMapping = new Map<number, number>();
  existingCards.forEach((card, index) => {
    idMapping.set(card.id, index + 1);
  });
  
  // Update all related tables in a transaction
  await prisma.$transaction(async (tx) => {
    // Update Ownership table
    for (const [oldId, newId] of idMapping) {
      if (oldId !== newId) {
        await tx.ownership.updateMany({
          where: { cardId: oldId },
          data: { cardId: newId }
        });
      }
    }
    
    // Update Listing table
    for (const [oldId, newId] of idMapping) {
      if (oldId !== newId) {
        await tx.listing.updateMany({
          where: { cardId: oldId },
          data: { cardId: newId }
        });
      }
    }
    
    // Update Trade table (offered cards)
    for (const [oldId, newId] of idMapping) {
      if (oldId !== newId) {
        await tx.trade.updateMany({
          where: { offeredCardId: oldId },
          data: { offeredCardId: newId }
        });
      }
    }
    
    // Update Trade table (requested cards)
    for (const [oldId, newId] of idMapping) {
      if (oldId !== newId) {
        await tx.trade.updateMany({
          where: { requestedCardId: oldId },
          data: { requestedCardId: newId }
        });
      }
    }
    
    // Update FuseLock table
    for (const [oldId, newId] of idMapping) {
      if (oldId !== newId) {
        await tx.fuseLock.updateMany({
          where: { cardId: oldId },
          data: { cardId: newId }
        });
      }
    }
    
    // Update User favoriteCardId
    for (const [oldId, newId] of idMapping) {
      if (oldId !== newId) {
        await tx.user.updateMany({
          where: { favoriteCardId: oldId },
          data: { favoriteCardId: newId }
        });
      }
    }
    
    // Finally, update Card IDs
    for (const [oldId, newId] of idMapping) {
      if (oldId !== newId) {
        await tx.card.update({
          where: { id: oldId },
          data: { id: newId }
        });
      }
    }
  });
  
  console.log('Card IDs reordered successfully!');
}

const token = process.env.BOT_TOKEN;
if (!token) {
  throw new Error('BOT_TOKEN is required');
}

const prisma = new PrismaClient();
const bot = new Telegraf(token);

// Spam detection system variables
const messageCounts = new Map<number, { count: number; lastReset: number }>(); // userId -> { count, lastReset }
const tempBannedUsers = new Map<number, number>(); // userId -> banEndTime
let spamLimit = 5; // Default: 5 messages in 2 seconds

// Ban check middleware - must be BEFORE all command handlers
bot.use(async (ctx, next) => {
  if (ctx.from && ctx.message && 'text' in ctx.message && typeof ctx.message.text === 'string' && ctx.message.text.startsWith('/')) {
    const userId = ctx.from.id;
    const now = Date.now();
    const command = ctx.message.text.split(' ')[0];
    
    // Check for temporary spam ban
    if (tempBannedUsers.has(userId)) {
      const banEndTime = tempBannedUsers.get(userId)!;
      if (now < banEndTime) {
        // User is temporarily banned from spam
        if (command !== '/profile' && !command.startsWith('/profile@')) {
          await ctx.reply('🚫 You are temporarily banned for 2 minutes due to spam. Only /profile command is available.', {
            ...getReplyParams(ctx)
          });
          return;
        }
      } else {
        // Ban expired, remove from temp banned list
        tempBannedUsers.delete(userId);
      }
    }
    
    // Check for permanent ban (isBanned field)
    try {
      const user = await ensureUser(prisma, ctx.from);
      if (user.isBanned && command !== '/profile' && !command.startsWith('/profile@')) {
        await ctx.reply('🚫 You are banned from using this bot. Only /profile command is available.', {
          ...getReplyParams(ctx)
        });
        return;
      }
    } catch (error) {
      console.error('Error in ban check middleware:', error);
    }
  }
  return next();
});

export { bot, prisma }

// Do not need separate action handlers as we'll handle them in the wizard

// Helper function to get a sticker from CricketBotOfficialS pack
async function getCricketSticker(ctx: any): Promise<string> {
  let stickerFileId = 'CAACAgUAAxkBAAILWGShUkG9AAGnyI0uD3E53QftAAHKiwACfgQAAu_wsVYVB_CQPipbkDME'; // fallback sticker
  
  try {
    const stickerSet = await ctx.telegram.getStickerSet('CricketBotOfficialS');
    if (stickerSet.stickers && stickerSet.stickers.length > 0) {
      // Use the first sticker from the pack (you can modify this to select a specific one or random)
      stickerFileId = stickerSet.stickers[0].file_id;
    }
  } catch (error) {
    console.log('Could not fetch CricketBotOfficialS stickers, using fallback:', error);
  }
  
  return stickerFileId;
}

// Helper function to check if user can open a pack (cooldown check)
async function canOpenPack(prisma: PrismaClient, userId: number): Promise<{ canOpen: boolean; message?: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const now = dayjs();
  if (user.lastPackAt && dayjs(user.lastPackAt).isAfter(now.subtract(3, 'minute'))) {
    const next = dayjs(user.lastPackAt).add(3, 'minute');
    const seconds = Math.max(1, Math.ceil(next.diff(now) / 1000));
    return { canOpen: false, message: `Pack on cooldown. Try again in ${seconds} seconds.` };
  }
  return { canOpen: true };
}

// Command handlers that work in both private and group chats
bot.command('openpack', async (ctx) => {
  try {
    const user = await ensureUser(prisma, ctx.from);
    
    // Check if user can open a pack (cooldown check)
    const cooldownCheck = await canOpenPack(prisma, user.id);
    if (!cooldownCheck.canOpen) {
      await ctx.reply(cooldownCheck.message!, { ...getReplyParams(ctx) });
      return;
    }
    
    // Get sticker from CricketBotOfficialS pack
    const stickerFileId = await getCricketSticker(ctx);
    
    // Send cricket sticker for pack opening
    const stickerMessage = await ctx.replyWithSticker(stickerFileId, { ...getReplyParams(ctx) });
    
    // Get the pack results while the sticker is showing
    const results = await openPackForUser(prisma, user.id);
    
    // Wait for 2 seconds to show the animation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Delete the sticker message
    await ctx.telegram.deleteMessage(ctx.chat.id, stickerMessage.message_id);
    
    // Display each card with image and username message combined
    for (const result of results) {
      const playerName = ctx.from.first_name || ctx.from.username || 'Player';
      const prefix = `${playerName} got a new card.`;
      
      // Send the card with image and username message combined
      await sendCardDetails(ctx, result.card, undefined, prefix);
    }
  } catch (e: any) {
    const msg = e && e.message ? e.message : 'Failed to open pack.';
    await ctx.reply(msg, { ...getReplyParams(ctx) });
  }
});

// Helper function to send card details with image
// Temporarily disabled wizard to ensure bot stability
/*
const addCardWizard = new Scenes.WizardScene<MyWizardContext>(
  'add-card-wizard',
  // Step 1: Enter card name (slug will be auto-generated)
  async (ctx) => {
    try {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card = {}; // Initialize the card object
      
      try {
    await ctx.reply('Enter card name:', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
      } catch (error) {
        // If reply fails (message not found), send without reply
        await ctx.reply('Enter card name:');
      }
    return ctx.wizard.next();
    } catch (error: any) {
      console.error('Error in wizard step 1:', error);
      try {
        await ctx.reply('❌ An error occurred. Please try the /addcard command again.');
        return ctx.scene.leave();
      } catch (replyError) {
        console.error('Failed to send error reply in wizard step 1:', replyError);
        return ctx.scene.leave();
      }
    }
  },
  // Step 2: Show rarity options
  async (ctx) => {
    try {
      if (!ctx.message || !('text' in ctx.message)) {
        await ctx.reply('❌ Invalid input. Please try the /addcard command again.');
        return ctx.scene.leave();
      }
    
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
    
      try {
    await ctx.reply('Select card rarity:', {
      reply_markup: keyboard,
      ...(reply_parameters ? { reply_parameters } : {})
    });
      } catch (error) {
        // If reply fails (message not found), send without reply
        await ctx.reply('Select card rarity:', { reply_markup: keyboard });
      }
    return ctx.wizard.next();
    } catch (error: any) {
      console.error('Error in wizard step 2:', error);
      try {
        await ctx.reply('❌ An error occurred. Please try the /addcard command again.');
        return ctx.scene.leave();
      } catch (replyError) {
        console.error('Failed to send error reply in wizard step 2:', replyError);
        return ctx.scene.leave();
      }
    }
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
    try {
    await ctx.reply('Enter role (e.g. Batsman, Bowler, All-rounder):', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    } catch (error) {
      await ctx.reply('Enter role (e.g. Batsman, Bowler, All-rounder):');
    }
    return ctx.wizard.next();
  },
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.role = ctx.message && 'text' in ctx.message ? (ctx.message as any).text : '';
    try {
    await ctx.reply('Enter bio (or type "skip"):', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    } catch (error) {
      await ctx.reply('Enter bio (or type "skip"):');
    }
    return ctx.wizard.next();
  },
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.bio = ctx.message && 'text' in ctx.message && (ctx.message as any).text === 'skip' ? null : ctx.message && 'text' in ctx.message ? (ctx.message as any).text : null;
    try {
    await ctx.reply('Enter image URL (or type "skip"):', {
      ...(reply_parameters ? { reply_parameters } : {})
    });
    } catch (error) {
      await ctx.reply('Enter image URL (or type "skip"):');
    }
    return ctx.wizard.next();
  },
  async (ctx) => {
    const reply_parameters = ctx.message?.message_id ? { message_id: ctx.message.message_id } : undefined;
    (ctx.wizard.state as any).card.imageUrl = ctx.message && 'text' in ctx.message && (ctx.message as any).text === 'skip' ? null : ctx.message && 'text' in ctx.message ? (ctx.message as any).text : null;
    try {
      // Get the next available card ID
      const nextId = await getNextCardId(prisma);
      (ctx.wizard.state as any).card.id = nextId;
      
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
*/

// Temporarily disabled wizard scenes to ensure bot stability
// const stage = new Scenes.Stage<MyWizardContext>([addCardWizard]);
// bot.use(session() as any);
// bot.use(stage.middleware() as any);

bot.command('addcard', async (ctx) => {
  try {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(user)) {
    return ctx.reply('Only admins can use this command.');
  }
    
    // Clear any existing state for this user
    addCardStates.delete(user.id);
    
    // Initialize the addcard wizard state
    addCardStates.set(user.id, {
      step: 'name',
      card: {}
    });
    
    await ctx.reply(
      '📝 Add Card Wizard\n\n' +
      'Step 1/6: Enter the card name:\n\n' +
      'Example: Virat Kohli or MS Dhoni',
      { ...getReplyParams(ctx) }
    );
  } catch (error: any) {
    console.error('Error in addcard command:', error);
    // Clear state on error
    if (ctx.from) {
      addCardStates.delete(ctx.from.id);
    }
    try {
      await ctx.reply('❌ An error occurred. Please try again later.');
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError);
    }
  }
});

// Command to cancel addcard wizard
bot.command('canceladdcard', async (ctx) => {
  try {
    const user = await ensureUser(prisma, ctx.from);
    if (!await isAdmin(user)) {
      return ctx.reply('Only admins can use this command.');
    }
    
    if (addCardStates.has(user.id)) {
      addCardStates.delete(user.id);
      await ctx.reply('✅ Add card wizard cancelled.', { ...getReplyParams(ctx) });
    } else {
      await ctx.reply('No active add card wizard to cancel.', { ...getReplyParams(ctx) });
    }
  } catch (error: any) {
    console.error('Error in canceladdcard command:', error);
    try {
      await ctx.reply('❌ An error occurred. Please try again later.');
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError);
    }
  }
});

// Search command for finding cards
bot.command('search', async (ctx) => {
  try {
    const user = await ensureUser(prisma, ctx.from);
    const args = ctx.message.text.split(' ').slice(1);
    
    if (args.length === 0) {
      // If no search term, show the search interface with inline button
      const searchMessage = '🔍 SEARCH ALL THE [PLAYERS] UPLOADED BY CLICKING THE BUTTON BELOW 📱';
      
      const keyboard = {
        inline_keyboard: [
          [{ text: '🔍 Search Player', switch_inline_query_current_chat: '' }]
        ]
      };
      
      await ctx.reply(searchMessage, {
        ...getReplyParams(ctx),
        reply_markup: keyboard
      });
      return;
    }
    
    const searchTerm = args.join(' ').trim();
    
    if (searchTerm.length < 2) {
      await ctx.reply('❌ Search term must be at least 2 characters long.', { ...getReplyParams(ctx) });
      return;
    }
    
    // Search for cards containing the query in name
    const searchResults = await prisma.card.findMany({
      where: {
        name: {
          contains: searchTerm
        }
      },
      take: 10,
      orderBy: [
        { rarity: 'asc' }, // Show higher rarities first
        { name: 'asc' }
      ]
    });
    
    if (searchResults.length === 0) {
      await ctx.reply(`🔍 **Search Results for "${searchTerm}"**\n\n` +
        `❌ No cards found for "${searchTerm}"\n\n` +
        `💡 **Search Tips:**\n` +
        `• Try different spellings\n` +
        `• Use partial names (e.g., "Rohit" instead of "Rohit Sharma")\n` +
        `• Check /allcards to see all available cards`, {
        ...getReplyParams(ctx),
        parse_mode: 'HTML'
      });
      return;
    }
    
    let resultMessage = `🔍 **Search Results for "${searchTerm}"**\n\n`;
    resultMessage += `Found ${searchResults.length} card(s):\n\n`;
    
    searchResults.forEach((card, index) => {
      resultMessage += `${index + 1}. **${card.name}**\n`;
      resultMessage += `   ${getRarityWithEmoji(card.rarity)} ${card.rarity} • ${card.country} ${getCountryFlag(card.country)}\n`;
      resultMessage += `   ID: ${card.id} • Role: ${card.role}\n\n`;
    });
    
    resultMessage += `━━━━━━━━━━━━━━━━━━\n`;
    resultMessage += `💡 Use /check card_id for more details`;
    
    await ctx.reply(resultMessage, {
      ...getReplyParams(ctx),
      parse_mode: 'HTML'
    });
    
  } catch (error: any) {
    console.error('Error in search command:', error);
    try {
      await ctx.reply('❌ An error occurred while searching. Please try again later.');
    } catch (replyError) {
      console.error('Failed to send error reply:', replyError);
    }
  }
});

// Command to delete a card: /deletecard card_id (admin only)
bot.command('deletecard', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(user)) {
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

      // Delete all fuse locks for this card
      await tx.fuseLock.deleteMany({
        where: { cardId }
      });

      // Clear favorite card references
      await tx.user.updateMany({
        where: { favoriteCardId: cardId },
        data: { favoriteCardId: null }
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

// Command to reorder card IDs: /reordercards (admin only)
bot.command('reordercards', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(user)) {
    return ctx.reply('Only admins can use this command.', { ...getReplyParams(ctx) });
  }
  
  try {
    await ctx.reply('🔄 Reordering card IDs to fill gaps...', { ...getReplyParams(ctx) });
    await reorderCardIds(prisma);
    await ctx.reply('✅ Card IDs have been reordered successfully! All gaps have been filled.', { ...getReplyParams(ctx) });
  } catch (e: any) {
    await ctx.reply(`Error reordering cards: ${e.message}`, { ...getReplyParams(ctx) });
  }
});

// Command to change card rarity: /changerarity card_id (admin only)
bot.command('changerarity', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(user)) {
    return ctx.reply('Only admins can use this command.', { ...getReplyParams(ctx) });
  }
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) return ctx.reply('Usage: /changerarity <cardId>', { ...getReplyParams(ctx) });
  
  try {
    // Check if card exists
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) {
      return ctx.reply('Card not found.', { ...getReplyParams(ctx) });
    }
    
    // Show rarity selection keyboard
    const keyboard = {
      inline_keyboard: [
        [
          { text: '🏆 Common', callback_data: `change_rarity_${cardId}_COMMON` },
          { text: '🥈 Medium', callback_data: `change_rarity_${cardId}_MEDIUM` }
        ],
        [
          { text: '🥇 Rare', callback_data: `change_rarity_${cardId}_RARE` },
          { text: '🟡 Legendary', callback_data: `change_rarity_${cardId}_LEGENDARY` }
        ],
        [
          { text: '🧠 Exclusive', callback_data: `change_rarity_${cardId}_EXCLUSIVE` },
          { text: '🟣 Limited Edition', callback_data: `change_rarity_${cardId}_LIMITED_EDITION` }
        ],
        [
          { text: '❄️ Cosmic', callback_data: `change_rarity_${cardId}_COSMIC` },
          { text: '♠️ Prime', callback_data: `change_rarity_${cardId}_PRIME` }
        ],
        [
          { text: '🧿 Premium', callback_data: `change_rarity_${cardId}_PREMIUM` }
        ]
      ]
    };
    
    await ctx.reply(`Select new rarity for "${card.name}" (ID: ${cardId}):`, {
      reply_markup: keyboard,
      ...getReplyParams(ctx)
    });
  } catch (e: any) {
    await ctx.reply('Failed to change rarity: ' + (e.message || e), { ...getReplyParams(ctx) });
  }
});

// Command to give card to user: /daan card_id (admin only, must reply to user's message)
bot.command('daan', async (ctx) => {
  const admin = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(admin)) {
    return ctx.reply('Only admins can use this command.', { ...getReplyParams(ctx) });
  }
  
  // Check if this is a reply to another user's message
  if (!ctx.message.reply_to_message || !ctx.message.reply_to_message.from) {
    return ctx.reply('Please reply to a user\'s message to give them a card.', { ...getReplyParams(ctx) });
  }
  
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) return ctx.reply('Usage: /daan <cardId> (reply to user\'s message)', { ...getReplyParams(ctx) });
  
  try {
    // Check if card exists
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) {
      return ctx.reply('Card not found.', { ...getReplyParams(ctx) });
    }
    
    // Get the target user (the one being replied to)
    const targetUser = await ensureUser(prisma, ctx.message.reply_to_message.from);
    
    // Use transaction to give the card and update totalCardsCollected
    await prisma.$transaction(async (tx) => {
      // Check if user already has this card
      const existing = await tx.ownership.findUnique({
        where: {
          userId_cardId: {
            userId: targetUser.id,
            cardId: cardId
          }
        }
      });

      if (existing) {
        // Increment quantity if user already has the card
        await tx.ownership.update({
          where: { id: existing.id },
          data: { quantity: existing.quantity + 1 }
        });
      } else {
        // Create new ownership if user doesn't have the card
        await tx.ownership.create({
          data: {
            userId: targetUser.id,
            cardId: cardId,
            quantity: 1
          }
        });
      }

      // Increment totalCardsCollected for the target user
      await tx.user.update({
        where: { id: targetUser.id },
        data: { totalCardsCollected: { increment: 1 } }
      });
    });
    
    const targetUserName = targetUser.firstName || targetUser.username || 'User';
    
    // Send enhanced collection message to the target user
    await sendCardCollectionMessage(ctx, card, targetUserName);
    
    // Also send confirmation to admin
    await ctx.reply(
      `✅ Card given successfully!\n\n` +
      `Given to: ${targetUserName}\n` +
      `Card: ${getRarityWithEmoji(card.rarity)} ${card.name}\n` +
      `Card ID: ${cardId}`,
      { ...getReplyParams(ctx) }
    );
  } catch (e: any) {
    await ctx.reply('Failed to give card: ' + (e.message || e), { ...getReplyParams(ctx) });
  }
});

// Command to ban a user: /botban username or reply to user with /botban
bot.command('botban', async (ctx) => {
  console.log('🔨 /botban command triggered by user:', ctx.from?.id, ctx.from?.username);
  const admin = await ensureUser(prisma, ctx.from);
  console.log('🔨 Admin check - isAdmin:', admin.isAdmin);
  if (!admin.isAdmin) {
    return ctx.reply('❌ You must be an admin to use this command.', { ...getReplyParams(ctx) });
  }

  let targetUser;
  
  // Check if replying to a message
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
    // Get the user from the database directly
    targetUser = await prisma.user.findFirst({
      where: { telegramId: ctx.message.reply_to_message.from.id.toString() }
    });
    
    if (!targetUser) {
      return ctx.reply('❌ User not found in database.', { ...getReplyParams(ctx) });
    }
  } else {
    // Get username from command arguments
    const parts = (ctx.message.text || '').split(/\s+/);
    const username = parts[1];
    
    if (!username) {
      return ctx.reply('❌ Usage: /botban <username> or reply to a user with /botban', { ...getReplyParams(ctx) });
    }
    
    // Find user by username (remove @ if present)
    const cleanUsername = username.replace('@', '');
    targetUser = await prisma.user.findFirst({
      where: { username: cleanUsername }
    });
    
    if (!targetUser) {
      return ctx.reply('❌ User not found.', { ...getReplyParams(ctx) });
    }
  }

  if (targetUser.isAdmin) {
    return ctx.reply('❌ Cannot ban an admin.', { ...getReplyParams(ctx) });
  }

  if (targetUser.isBanned) {
    return ctx.reply('❌ User is already banned.', { ...getReplyParams(ctx) });
  }

  // Ban the user
  console.log(`Banning user: ${targetUser.telegramId}, ${targetUser.username}, ${targetUser.firstName}`);
  await prisma.user.update({
    where: { id: targetUser.id },
    data: { isBanned: true }
  });

  const targetName = targetUser.firstName || targetUser.username || 'User';
  console.log(`User ${targetName} (ID: ${targetUser.id}) has been banned`);
  await ctx.reply(`🔨 <b>${targetName}</b> has been banned from the bot.`, {
    parse_mode: 'HTML',
    ...getReplyParams(ctx)
  });
});

// Command to unban a user: /botunban username or reply to user with /botunban
bot.command('botunban', async (ctx) => {
  console.log('✅ /botunban command triggered by user:', ctx.from?.id, ctx.from?.username);
  const admin = await ensureUser(prisma, ctx.from);
  console.log('✅ Admin check - isAdmin:', admin.isAdmin);
  if (!admin.isAdmin) {
    return ctx.reply('❌ You must be an admin to use this command.', { ...getReplyParams(ctx) });
  }

  let targetUser;
  
  // Check if replying to a message
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
    // Get the user from the database directly
    targetUser = await prisma.user.findFirst({
      where: { telegramId: ctx.message.reply_to_message.from.id.toString() }
    });
    
    if (!targetUser) {
      return ctx.reply('❌ User not found in database.', { ...getReplyParams(ctx) });
    }
  } else {
    // Get username from command arguments
    const parts = (ctx.message.text || '').split(/\s+/);
    const username = parts[1];
    
    if (!username) {
      return ctx.reply('❌ Usage: /botunban <username> or reply to a user with /botunban', { ...getReplyParams(ctx) });
    }
    
    // Find user by username (remove @ if present)
    const cleanUsername = username.replace('@', '');
    targetUser = await prisma.user.findFirst({
      where: { username: cleanUsername }
    });
    
    if (!targetUser) {
      return ctx.reply('❌ User not found.', { ...getReplyParams(ctx) });
    }
  }

  if (!targetUser.isBanned) {
    return ctx.reply('❌ User is not banned.', { ...getReplyParams(ctx) });
  }

  // Unban the user
  console.log(`Unbanning user: ${targetUser.telegramId}, ${targetUser.username}, ${targetUser.firstName}`);
  await prisma.user.update({
    where: { id: targetUser.id },
    data: { isBanned: false }
  });

  const targetName = targetUser.firstName || targetUser.username || 'User';
  console.log(`User ${targetName} (ID: ${targetUser.id}) has been unbanned`);
  await ctx.reply(`✅ <b>${targetName}</b> has been unbanned from the bot.`, {
    parse_mode: 'HTML',
    ...getReplyParams(ctx)
  });
});

// Command to check card details: /check card_id
bot.command('check', async (ctx) => {
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) return ctx.reply('Usage: /check <cardId>', { ...getReplyParams(ctx) });
  try {
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return ctx.reply('Card not found.', { ...getReplyParams(ctx) });
    await sendCardDetails(ctx, card, undefined, undefined, true); // Pass showTopCollectors = true
  } catch (e: any) {
    await ctx.reply('Error fetching card details.', { ...getReplyParams(ctx) });
  }
});

// Command to ban a user: /botban username or reply to user with /botban
bot.command('botban', async (ctx) => {
  const admin = await ensureUser(prisma, ctx.from);
  if (!admin.isAdmin) {
    return ctx.reply('❌ You must be an admin to use this command.', { ...getReplyParams(ctx) });
  }

  let targetUser;
  
  // Check if replying to a message
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
    targetUser = await ensureUser(prisma, ctx.message.reply_to_message.from);
  } else {
    // Try to get username from command
    const parts = (ctx.message.text || '').split(/\s+/);
    const username = parts[1];
    
    if (!username) {
      return ctx.reply('❌ Usage: /botban <username> or reply to a user with /botban', { ...getReplyParams(ctx) });
    }
    
    // Find user by username
    targetUser = await prisma.user.findFirst({
      where: { username: username.replace('@', '') }
    });
    
    if (!targetUser) {
      return ctx.reply('❌ User not found.', { ...getReplyParams(ctx) });
    }
  }

  // Check if user is already banned
  if (targetUser.isBanned) {
    return ctx.reply('❌ User is already banned.', { ...getReplyParams(ctx) });
  }

  // Ban the user
  await prisma.user.update({
    where: { id: targetUser.id },
    data: { isBanned: true }
  });

  const targetName = targetUser.firstName || targetUser.username || 'User';
  await ctx.reply(`🔨 <b>User Banned</b>\n\nUser: ${targetName}\nStatus: Banned from bot access`, {
    parse_mode: 'HTML',
    ...getReplyParams(ctx)
  });
});

// Command to unban a user: /botunban username or reply to user with /botunban
bot.command('botunban', async (ctx) => {
  const admin = await ensureUser(prisma, ctx.from);
  if (!admin.isAdmin) {
    return ctx.reply('❌ You must be an admin to use this command.', { ...getReplyParams(ctx) });
  }

  let targetUser;
  
  // Check if replying to a message
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
    targetUser = await ensureUser(prisma, ctx.message.reply_to_message.from);
  } else {
    // Try to get username from command
    const parts = (ctx.message.text || '').split(/\s+/);
    const username = parts[1];
    
    if (!username) {
      return ctx.reply('❌ Usage: /botunban <username> or reply to a user with /botunban', { ...getReplyParams(ctx) });
    }
    
    // Find user by username
    targetUser = await prisma.user.findFirst({
      where: { username: username.replace('@', '') }
    });
    
    if (!targetUser) {
      return ctx.reply('❌ User not found.', { ...getReplyParams(ctx) });
    }
  }

  // Check if user is not banned
  if (!targetUser.isBanned) {
    return ctx.reply('❌ User is not banned.', { ...getReplyParams(ctx) });
  }

  // Unban the user
  await prisma.user.update({
    where: { id: targetUser.id },
    data: { isBanned: false }
  });

  const targetName = targetUser.firstName || targetUser.username || 'User';
  await ctx.reply(`✅ <b>User Unbanned</b>\n\nUser: ${targetName}\nStatus: Bot access restored`, {
    parse_mode: 'HTML',
    ...getReplyParams(ctx)
  });
});

// Command to remove temporary spam ban: /unbantemp username or reply to user with /unbantemp
bot.command('unbantemp', async (ctx) => {
  const admin = await ensureUser(prisma, ctx.from);
  if (!admin.isAdmin) {
    return ctx.reply('❌ You must be an admin to use this command.', { ...getReplyParams(ctx) });
  }

  let targetUser;
  
  // Check if replying to a message
  if (ctx.message.reply_to_message && ctx.message.reply_to_message.from) {
    targetUser = ctx.message.reply_to_message.from;
  } else {
    // Try to get username from command
    const parts = (ctx.message.text || '').split(/\s+/);
    const username = parts[1];
    
    if (!username) {
      return ctx.reply('❌ Usage: /unbantemp <username> or reply to a user with /unbantemp', { ...getReplyParams(ctx) });
    }
    
    // Find user by username
    const dbUser = await prisma.user.findFirst({
      where: { username: username.replace('@', '') }
    });
    
    if (!dbUser) {
      return ctx.reply('❌ User not found.', { ...getReplyParams(ctx) });
    }
    
    targetUser = { id: dbUser.telegramId };
  }

  const userId = parseInt(targetUser.id.toString());
  
  // Check if user is temporarily banned
  if (!tempBannedUsers.has(userId)) {
    return ctx.reply('❌ User is not temporarily banned.', { ...getReplyParams(ctx) });
  }

  // Remove temporary ban
  tempBannedUsers.delete(userId);
  
  const targetName = ctx.message.reply_to_message?.from?.first_name || ctx.message.reply_to_message?.from?.username || 'User';
  await ctx.reply(`✅ <b>Temporary Ban Removed</b>\n\nUser: ${targetName}\nStatus: Spam ban lifted`, {
    parse_mode: 'HTML',
    ...getReplyParams(ctx)
  });
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
    // Check if user can open a pack (cooldown check)
    const cooldownCheck = await canOpenPack(prisma, user.id);
    if (!cooldownCheck.canOpen) {
      await ctx.reply(cooldownCheck.message!, { ...getReplyParams(ctx) });
      return;
    }
    
    // Get sticker from CricketBotOfficialS pack
    const stickerFileId = await getCricketSticker(ctx);
    
    // Send cricket sticker for pack opening
    const stickerMessage = await ctx.replyWithSticker(stickerFileId, { ...getReplyParams(ctx) });
    
    // Get the pack results while the sticker is showing
    const results = await openPackForUser(prisma, user.id);
    
    // Wait for 2 seconds to show the animation
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Delete the sticker message
    await ctx.telegram.deleteMessage(ctx.chat.id, stickerMessage.message_id);
    
    // Display each card with image and username message combined
    for (const result of results) {
      const playerName = ctx.from.first_name || ctx.from.username || 'Player';
      const prefix = `${playerName} got a new card.`;
      
      // Send the card with image and username message combined
      await sendCardDetails(ctx, result.card, undefined, prefix);
    }
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
  
  // Create navigation buttons with user ID
  const buttons = [];
  if (currentPage > 0) {
    buttons.push({ text: '⬅️ Previous', callback_data: `cards:prev:${userId}` });
  }
  if (currentPage < totalPages - 1) {
    buttons.push({ text: 'Next ➡️', callback_data: `cards:next:${userId}` });
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
bot.action(/^cards:next:(\d+)$/, async (ctx) => {
  const originalUserId = Number(ctx.match[1]);
  const clickingUserId = ctx.from.id;
  
  // Only allow the original user to control pagination
  if (originalUserId !== clickingUserId) {
    await ctx.answerCbQuery('Only the card owner can navigate their cards.');
    return;
  }
  
  const currentPage = userCardPages.get(originalUserId) || 0;
  userCardPages.set(originalUserId, currentPage + 1);
  
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
    buttons.push({ text: '⬅️ Previous', callback_data: `cards:prev:${originalUserId}` });
  }
  if (currentPage + 1 < totalPages - 1) {
    buttons.push({ text: 'Next ➡️', callback_data: `cards:next:${originalUserId}` });
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

      // Check if this is the last card (quantity will become 0)
      if (senderOwnership.quantity === 1) {
        // Delete the ownership record if this is the last card
        await tx.ownership.delete({
          where: { id: senderOwnership.id }
        });
      } else {
        // Decrement quantity if there are more cards
      await tx.ownership.update({
        where: { id: senderOwnership.id },
        data: { quantity: { decrement: 1 } }
      });
      }

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

      // Increment recipient's total cards collected
      await tx.user.update({
        where: { id: gift.toUserId },
        data: { totalCardsCollected: { increment: 1 } }
      });

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

bot.action(/^cards:prev:(\d+)$/, async (ctx) => {
  const originalUserId = Number(ctx.match[1]);
  const clickingUserId = ctx.from.id;
  
  // Only allow the original user to control pagination
  if (originalUserId !== clickingUserId) {
    await ctx.answerCbQuery('Only the card owner can navigate their cards.');
    return;
  }
  
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
    buttons.push({ text: '⬅️ Previous', callback_data: `cards:prev:${originalUserId}` });
  }
  if (currentPage - 1 < totalPages - 1) {
    buttons.push({ text: 'Next ➡️', callback_data: `cards:next:${originalUserId}` });
  }
  
  await ctx.editMessageText(message, {
    parse_mode: 'HTML',
    reply_markup: buttons.length ? {
      inline_keyboard: [buttons]
    } : undefined
  });
  await ctx.answerCbQuery();
});

// Handle allcards pagination
bot.action(/^allcards:(\d+)$/, async (ctx) => {
  const page = Number(ctx.match[1]);
  const CARDS_PER_PAGE = 15;
  const skip = (page - 1) * CARDS_PER_PAGE;
  
  try {
    // Get total count of cards
    const totalCards = await prisma.card.count();
    const totalPages = Math.ceil(totalCards / CARDS_PER_PAGE);
    
    if (page > totalPages || page < 1) {
      await ctx.answerCbQuery('Invalid page number.');
      return;
    }
    
    // Get cards for current page
    const cards = await prisma.card.findMany({
      orderBy: { id: 'asc' },
      skip: skip,
      take: CARDS_PER_PAGE
    });
    
    // Build message
    let message = `🃏 All Cards (Page ${page}/${totalPages})\n\n`;
    message += `📊 Total Cards: ${totalCards}\n`;
    message += `━━━━━━━━━━━━━━━━━━\n\n`;
    
    cards.forEach((card, index) => {
      const globalIndex = skip + index + 1;
      message += `${card.name}`;
      message += `   ID: ${card.id} | ${getRarityWithEmoji(card.rarity)}\n`;
    });
    
    // Add pagination buttons
    const buttons = [];
    if (page > 1) {
      buttons.push({ text: '⬅️ Previous', callback_data: `allcards:${page - 1}` });
    }
    if (page < totalPages) {
      buttons.push({ text: 'Next ➡️', callback_data: `allcards:${page + 1}` });
    }
    
    await ctx.editMessageText(message, {
      parse_mode: 'HTML',
      reply_markup: buttons.length ? {
        inline_keyboard: [buttons]
      } : undefined
    });
    
    await ctx.answerCbQuery();
    
  } catch (error) {
    console.error('Error in allcards pagination:', error);
    await ctx.answerCbQuery('Error loading page.');
  }
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
  
  // Create navigation buttons with user ID
  const buttons = [];
  if (currentPage > 0) {
    buttons.push({ text: '⬅️ Previous', callback_data: `cards:prev:${userId}` });
  }
  if (currentPage < totalPages - 1) {
    buttons.push({ text: 'Next ➡️', callback_data: `cards:next:${userId}` });
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

// Command to show leaderboard: /leaderboard
bot.command('leaderboard', async (ctx) => {
  const top = await getLeaderboard(prisma);
  if (top.length === 0) return ctx.reply('No players yet. Be the first!', { ...getReplyParams(ctx) });
  const msg = top.map((u, i) => `${i + 1}. ${u.username ?? u.firstName ?? 'Anonymous'} — ${u.totalCardsCollected} cards`).join('\n');
  await ctx.reply(`🏆 Top 10 Card Collectors\n\n${msg}`, { ...getReplyParams(ctx) });
});

bot.hears('🏆 Leaderboard', async (ctx) => {
  const top = await getLeaderboard(prisma);
  if (top.length === 0) return ctx.reply('No players yet. Be the first!', { ...getReplyParams(ctx) });
  const msg = top.map((u, i) => `${i + 1}. ${u.username ?? u.firstName ?? 'Anonymous'} — ${u.totalCardsCollected} cards`).join('\n');
  await ctx.reply(msg, { ...getReplyParams(ctx) });
});

bot.command('market', async (ctx) => {
  const listings = await browseMarket(prisma);
  if (listings.length === 0) return ctx.reply('No active listings in the market.', marketKeyboard());

  let msg = '🏪 *Market Listings*\n\n';
  for (const l of listings) {
    msg += `*${l.card.name}* [${l.card.rarity}]\n`;
    msg += `├ ID: \`${l.cardId}\`\n`;
    msg += `├ Price: ${l.price} 💰\n`;
    msg += `├ Quantity: ${l.quantity}x\n`;
    msg += `└ Seller: @${l.seller.username ?? 'anon'}\n\n`;
  }
  msg += '\nMarket Commands:\n';
  msg += '`/addpmarket card_id price` - List a card for sale\n';
  msg += '`/buypmarket card_id quantity` - Buy a card\n';
  msg += '`/removepmarket card_id` - Remove your listing';

  await ctx.reply(msg, { 
    parse_mode: 'Markdown',
    ...marketKeyboard()
  });
});

bot.hears('🛒 Market', async (ctx) => {
  // Redirect to /market command for consistency
  await ctx.reply('Use /market to view all listings', marketKeyboard());
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
    await ctx.reply(`✅ Purchased x${qty}. Spent ${res.spent} coins.`, marketKeyboard());
  } catch (e: any) {
    await ctx.reply(`❌ Purchase failed: ${e.message}`, marketKeyboard());
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

// Handle rarity change callback
bot.action(/^change_rarity_(\d+)_(.+)$/, async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(user)) {
    await ctx.answerCbQuery('Only admins can change card rarity.');
    return;
  }
  
  const cardId = Number(ctx.match[1]);
  const newRarity = ctx.match[2];
  
  try {
    // Update the card's rarity
    const updatedCard = await prisma.card.update({
      where: { id: cardId },
      data: { rarity: newRarity }
    });
    
    await ctx.editMessageText(
      `✅ Rarity changed successfully!\n\n` +
      `Card: ${updatedCard.name}\n` +
      `New Rarity: ${getRarityWithEmoji(newRarity)}`
    );
    await ctx.answerCbQuery('Rarity changed successfully!');
  } catch (e: any) {
    await ctx.answerCbQuery(`Failed to change rarity: ${e.message}`);
  }
});

// Addcard wizard rarity selection handler
bot.action(/^addcard_rarity_(.+)$/, async (ctx) => {
  try {
    const user = await ensureUser(prisma, ctx.from);
    if (!await isAdmin(user)) {
      await ctx.answerCbQuery('Only admins can add cards.');
      return;
    }
    
    const rarity = ctx.match[1];
    const state = addCardStates.get(user.id);
    
    if (!state || state.step !== 'rarity') {
      await ctx.answerCbQuery('Invalid wizard state. Please start over with /addcard');
      return;
    }
    
    // Update the card with selected rarity
    state.card.rarity = rarity;
    state.step = 'country';
    
    await ctx.editMessageText(
      `✅ Rarity selected: ${getRarityWithEmoji(rarity)} ${rarity}\n\n` +
      `Step 3/6: Enter the country/team:\n\n` +
      `Example: India, Australia, England`
    );
    await ctx.answerCbQuery('Rarity selected!');
  } catch (error: any) {
    console.error('Error in addcard rarity selection:', error);
    await ctx.answerCbQuery('❌ An error occurred. Please try again.');
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

// Admin command to set the spam limit (messages per 2 seconds)
bot.command('limit', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(user)) {
    return ctx.reply('Only admins can use this command.', { ...getReplyParams(ctx) });
  }
  
  const parts = (ctx.message.text || '').split(/\s+/);
  const limit = Number(parts[1]);
  
  if (!limit || limit < 1 || limit > 50) {
    return ctx.reply('Usage: /limit <number>\nSet the message limit per 2 seconds (1-50). Current limit: ' + spamLimit, { ...getReplyParams(ctx) });
  }
  
  spamLimit = limit;
  await ctx.reply(`✅ Spam limit set to ${limit} messages per 2 seconds.`, { ...getReplyParams(ctx) });
});

// Admin command to set the card drop rate for a group
bot.command('droprate', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(user)) {
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

// Command to show all cards with pagination
bot.command('allcards', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const page = parts[1] ? parseInt(parts[1]) : 1;
  
  if (isNaN(page) || page < 1) {
    await ctx.reply('Please provide a valid page number. Usage: /allcards [page]', { ...getReplyParams(ctx) });
    return;
  }
  
  const CARDS_PER_PAGE = 15;
  const skip = (page - 1) * CARDS_PER_PAGE;
  
  try {
    // Get total count of cards
    const totalCards = await prisma.card.count();
    const totalPages = Math.ceil(totalCards / CARDS_PER_PAGE);
    
    if (page > totalPages && totalPages > 0) {
      await ctx.reply(`Page ${page} does not exist. There are only ${totalPages} page(s).`, { ...getReplyParams(ctx) });
      return;
    }
    
    if (totalCards === 0) {
      await ctx.reply('No cards found in the database.', { ...getReplyParams(ctx) });
      return;
    }
    
    // Get cards for current page
    const cards = await prisma.card.findMany({
      orderBy: { id: 'asc' },
      skip: skip,
      take: CARDS_PER_PAGE
    });
    
    // Build message
    let message = `🃏 **All Cards (Page ${page}/${totalPages})**\n\n`;
    message += `📊 Total Cards: ${totalCards}\n`;
    message += `━━━━━━━━━━━━━━━━━━\n\n`;
    
    cards.forEach((card, index) => {
      const globalIndex = skip + index + 1;
      message += `${card.name}`;
      message += `   ID: ${card.id} | ${getRarityWithEmoji(card.rarity)}\n`;
    });
    
    // Add pagination buttons
    const buttons = [];
    if (page > 1) {
      buttons.push({ text: '⬅️ Previous', callback_data: `allcards:${page - 1}` });
    }
    if (page < totalPages) {
      buttons.push({ text: 'Next ➡️', callback_data: `allcards:${page + 1}` });
    }
    
    await ctx.reply(message, {
      ...getReplyParams(ctx),
      parse_mode: 'HTML',
      reply_markup: buttons.length ? {
        inline_keyboard: [buttons]
      } : undefined
    });
    
  } catch (error) {
    console.error('Error in /allcards command:', error);
    await ctx.reply('Error fetching cards. Please try again.', { ...getReplyParams(ctx) });
  }
});


bot.command('help', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const isUserAdmin = await isAdmin(user);
  let helpText = '/start, /help, /profile, /pack, /cards, /allcards, /daily, /leaderboard, /list, /cancel, /trade, /gift, /trades, /fuse, /fuselock, /fuseunlock, /fusecheck, /fav';
  if (isUserAdmin) {
    helpText += '\n\nAdmin commands:\n/addcard - Add a new card\n/deletecard - Delete a card\n/reordercards - Reorder card IDs to fill gaps\n/changerarity - Change card rarity\n/changeimage - Change card image\n/changebio - Change card bio\n/changecountry - Change card country\n/daan - Give card to user (reply to message)\n/makeadmin - Make another user an admin\n/removeadmin - Remove admin rights from a user\n/botban - Ban a user\n/botunban - Unban a user\n/unbantemp - Remove temporary spam ban\n/limit <number> - Set spam limit (messages per 2 seconds)\n/droprate <number> - Set messages required for card drop';
  }
  await ctx.reply(helpText);
});

// Command to make a user an admin (only existing admins can use this)
bot.command('makeadmin', async (ctx) => {
  const adminUser = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(adminUser)) {
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
  if (!await isAdmin(adminUser)) {
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

// In-memory map to track pending bio changes (avoiding session conflicts)
const pendingBioChanges = new Map<number, number>(); // userId -> cardId

// In-memory map to track addcard wizard state (avoiding session conflicts)
const addCardStates = new Map<number, {
  step: 'name' | 'rarity' | 'country' | 'role' | 'bio' | 'image';
  card: any;
}>(); // userId -> wizard state


// Cleanup function to remove old pending changes (5 minutes timeout)
setInterval(() => {
  // This is a simple cleanup - in production you might want to track timestamps
  // For now, we'll just clear the maps periodically to prevent memory leaks
  if (pendingBioChanges.size > 100) {
    pendingBioChanges.clear();
    console.log('Cleared pending bio changes map to prevent memory leaks');
  }
  if (addCardStates.size > 100) {
    addCardStates.clear();
    console.log('Cleared addcard states map to prevent memory leaks');
  }
}, 5 * 60 * 1000); // 5 minutes

// Command to change card bio
bot.command('changebio', async (ctx) => {
  const admin = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(admin)) {
    return ctx.reply('Only admins can use this command.', { ...getReplyParams(ctx) });
  }
  
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  if (!cardId) {
    return ctx.reply('Usage: /changebio <cardId>\n\nExample: /changebio 123', { ...getReplyParams(ctx) });
  }
  
  try {
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) {
      return ctx.reply('Card not found.', { ...getReplyParams(ctx) });
    }
    
    // Store the card ID in memory for this user
    pendingBioChanges.set(admin.id, cardId);
    
    await ctx.reply(
      `📝 **Change Bio for Card**\n\n` +
      `**Card:** ${card.name}\n` +
      `**Current Bio:** ${card.bio || 'No bio set'}\n\n` +
      `Please send the new bio for this card:`,
      { ...getReplyParams(ctx), parse_mode: 'HTML' }
    );
  } catch (e: any) {
    await ctx.reply('Failed to start bio change: ' + (e.message || e), { ...getReplyParams(ctx) });
  }
});

// Command to change card country
bot.command('changecountry', async (ctx) => {
  const admin = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(admin)) {
    return ctx.reply('Only admins can use this command.', { ...getReplyParams(ctx) });
  }
  
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  const newCountry = parts.slice(2).join(' ').trim();
  
  if (!cardId || !newCountry) {
    return ctx.reply('Usage: /changecountry <cardId> <new_country>\n\nExample: /changecountry 123 India', { ...getReplyParams(ctx) });
  }
  
  try {
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) {
      return ctx.reply('Card not found.', { ...getReplyParams(ctx) });
    }
    
    const updatedCard = await prisma.card.update({
      where: { id: cardId },
      data: { country: newCountry }
    });
    
    await ctx.reply(
      `🌍 **Country Changed Successfully!**\n\n` +
      `**Card:** ${updatedCard.name}\n` +
      `**Old Country:** ${card.country}\n` +
      `**New Country:** ${newCountry}\n` +
      `**Card ID:** ${cardId}`,
      { ...getReplyParams(ctx), parse_mode: 'HTML' }
    );
  } catch (e: any) {
    await ctx.reply('Failed to change country: ' + (e.message || e), { ...getReplyParams(ctx) });
  }
});

bot.command('cards', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const cards = await listUserCards(prisma, user.id);
  if (cards.length === 0) return ctx.reply('You have no cards yet. Try opening a pack!', { ...getReplyParams(ctx) });
  
  const cardsList = cards.map(c => `<b>Card ID:</b> ${c.cardId}\n<b>Name:</b> ${c.card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(c.card.rarity)}\n<b>Country:</b> ${c.card.country}\n<b>Role:</b> ${c.card.role}\n<b>Quantity:</b> x${c.quantity}`).join('\n\n');
  
  await ctx.replyWithHTML(cardsList, { ...getReplyParams(ctx) });
});

bot.command('profile', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  
  // Get user's card ownership data
  const ownerships = await prisma.ownership.findMany({
    where: { userId: user.id },
    include: { card: true }
  });
  
  // Calculate statistics
  const totalCardsOwned = ownerships.reduce((sum, ownership) => sum + ownership.quantity, 0);
  const totalUniqueCards = ownerships.length;
  
  // Use the totalCardsCollected field from the user record
  const totalCardsCollected = user.totalCardsCollected;
  
  // Define valid rarities in order
  const validRarities = ['COMMON', 'MEDIUM', 'RARE', 'LEGENDARY', 'LIMITED_EDITION', 'COSMIC', 'PRIME', 'PREMIUM'];
  
  // Group cards by rarity (only valid rarities)
  const cardsByRarity: { [key: string]: { total: number; unique: number } } = {};
  
  ownerships.forEach(ownership => {
    const rarity = ownership.card.rarity;
    // Only include cards with valid rarities
    if (validRarities.includes(rarity)) {
      if (!cardsByRarity[rarity]) {
        cardsByRarity[rarity] = { total: 0, unique: 0 };
      }
      cardsByRarity[rarity].total += ownership.quantity;
      cardsByRarity[rarity].unique += 1;
    }
  });
  
  // Get today's collection count and rank info
  const todayCollection = await getTodayCollectionCount(prisma, user.id);
  const username = user.firstName || user.username || 'Anonymous';
  const userRank = calculateRank(totalCardsCollected);
  const rankInfo = getRankInfo(userRank);
  
  // Build profile message with new formatting
  let profileMessage = `🏏 ━━━〔 🧾 PLAYER PROFILE 〕━━━ 🏏\n\n`;
  profileMessage += `👤 Username: ${username}\n`;
  profileMessage += `🏆 Rank: ${userRank}️⃣ — ${rankInfo.emoji} *${rankInfo.name}*\n`;
  profileMessage += `🃏 Total Cards Collected: ${totalCardsCollected}\n`;
  profileMessage += `📦 Unique Cards Owned: ${totalUniqueCards}\n`;
  profileMessage += `🗂️ Total Cards Owned: ${totalCardsOwned}\n`;
  profileMessage += `🔥 Today's Collection: ${todayCollection}\n`;
  profileMessage += `💰 Total Coins: ${user.coins.toLocaleString()}\n\n`;
  
  profileMessage += `━━━━━━━━━━━━━━━━━━\n`;
  profileMessage += `📊 〔 CARDS BY RARITY 〕\n`;
  
  // Show all rarities in the specified order, even if not owned
  validRarities.forEach(rarity => {
    const emoji = RARITY_EMOJIS[rarity] || '⭐';
    if (cardsByRarity[rarity]) {
      const stats = cardsByRarity[rarity];
      profileMessage += `${emoji} ${rarity}: ${stats.total} (${stats.unique})\n`;
    } else {
      // Show 0(0) for rarities not owned
      profileMessage += `${emoji} ${rarity}: 0 (0)\n`;
    }
  });
  
  profileMessage += `━━━━━━━━━━━━━━━━━━\n\n`;
  profileMessage += `🏟️ Keep collecting to climb the leaderboard!`;
  
  // Get favorite card if set
  let favoriteCard = null;
  if (user.favoriteCardId) {
    favoriteCard = await prisma.card.findUnique({
      where: { id: user.favoriteCardId }
    });
  }
  
  // If user has a favorite card with image, send it with the profile
  if (favoriteCard && favoriteCard.imageUrl && favoriteCard.imageUrl.startsWith('http')) {
    await ctx.replyWithPhoto(
      favoriteCard.imageUrl,
      {
        caption: profileMessage,
        parse_mode: 'HTML' as const,
        ...getReplyParams(ctx)
      }
    );
  } else {
    await ctx.replyWithHTML(profileMessage, { ...getReplyParams(ctx) });
  }
});

// Fuse command: /fuse card_id or /fuse rarity
bot.command('fuse', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  
  if (parts.length < 2) {
    await ctx.reply('Usage: /fuse &lt;card_id&gt; or /fuse &lt;rarity&gt;\n\nExamples:\n/fuse 123 - Fuse all cards of card ID 123\n/fuse legendary - Fuse all legendary cards', { ...getReplyParams(ctx), parse_mode: 'HTML' });
    return;
  }
  
  const input = parts[1].toLowerCase();
  
  // Check if input is a number (card_id)
  const cardId = Number(input);
  if (!isNaN(cardId)) {
    // Fuse specific card by ID
    await handleFuseCardById(ctx, user, cardId);
  } else {
    // Fuse by rarity
    await handleFuseByRarity(ctx, user, input);
  }
});

// Helper function to handle fusing specific card by ID
async function handleFuseCardById(ctx: any, user: any, cardId: number) {
  try {
    // Check if user owns this card
    const ownership = await prisma.ownership.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      },
      include: { card: true }
    });
    
    if (!ownership) {
      await ctx.reply(`You don't own any cards with ID ${cardId}.`, { ...getReplyParams(ctx) });
      return;
    }
    
    // Check if card is locked from fusing
    const fuseLock = await prisma.fuseLock.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      }
    });
    
    if (fuseLock) {
      await ctx.reply(
        `🔒 **Card is Locked from Fusing**\n\n` +
        `Card: ${getRarityWithEmoji(ownership.card.rarity)} ${ownership.card.name}\n` +
        `Card ID: ${cardId}\n\n` +
        `This card is protected from fusing. Use /fuseunlock ${cardId} to unlock it.`,
        { ...getReplyParams(ctx), parse_mode: 'HTML' }
      );
      return;
    }
    
    const card = ownership.card;
    const quantity = ownership.quantity;
    const rarity = card.rarity;
    const rate = RARITY_FUSE_RATES[rarity] || 0;
    const totalCoins = quantity * rate;
    
    if (rate === 0) {
      await ctx.reply(`Unknown rarity: ${rarity}. Cannot fuse this card.`, { ...getReplyParams(ctx) });
      return;
    }
    
    // Create confirmation message
    const emoji = RARITY_EMOJIS[rarity] || '⭐';
    const confirmMessage = `🔥 <b>Fuse Confirmation</b>\n\n` +
      `Card: ${emoji} ${card.name} (ID: ${cardId})\n` +
      `Rarity: ${rarity}\n` +
      `Quantity: ${quantity} cards\n` +
      `Rate: ${rate} coins per card\n` +
      `Total coins: ${totalCoins}\n\n` +
      `Are you sure you want to fuse all ${quantity} cards of this type?`;
    
    await ctx.replyWithHTML(confirmMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm Fuse', callback_data: `fuse_confirm_card_${cardId}` },
            { text: '❌ Cancel', callback_data: 'fuse_cancel' }
          ]
        ]
      },
      ...getReplyParams(ctx)
    });
    
  } catch (error) {
    console.error('Error in handleFuseCardById:', error);
    await ctx.reply('An error occurred while processing the fuse request.', { ...getReplyParams(ctx) });
  }
}

// Helper function to handle fusing by rarity
async function handleFuseByRarity(ctx: any, user: any, rarityInput: string) {
  try {
    // Normalize rarity input
    const rarity = rarityInput.toUpperCase();
    
    if (!RARITY_FUSE_RATES[rarity]) {
      const validRarities = Object.keys(RARITY_FUSE_RATES).join(', ');
      await ctx.reply(`Invalid rarity: ${rarityInput}\n\nValid rarities: ${validRarities}`, { ...getReplyParams(ctx) });
      return;
    }
    
    // Get all cards of this rarity owned by user
    const ownerships = await prisma.ownership.findMany({
      where: { userId: user.id },
      include: { card: true }
    });
    
    // Get all fuse locks for this user
    const fuseLocks = await prisma.fuseLock.findMany({
      where: { userId: user.id }
    });
    const lockedCardIds = new Set(fuseLocks.map(lock => lock.cardId));
    
    // Filter cards of this rarity, excluding locked ones
    const cardsOfRarity = ownerships.filter(ownership => 
      ownership.card.rarity === rarity && !lockedCardIds.has(ownership.cardId)
    );
    
    if (cardsOfRarity.length === 0) {
      await ctx.reply(`You don't own any ${rarity} cards that can be fused (some may be locked).`, { ...getReplyParams(ctx) });
      return;
    }
    
    const totalQuantity = cardsOfRarity.reduce((sum, ownership) => sum + ownership.quantity, 0);
    const rate = RARITY_FUSE_RATES[rarity];
    const totalCoins = totalQuantity * rate;
    const uniqueCards = cardsOfRarity.length;
    
    // Create confirmation message
    const emoji = RARITY_EMOJIS[rarity] || '⭐';
    const confirmMessage = `🔥 <b>Fuse Confirmation</b>\n\n` +
      `Rarity: ${emoji} ${rarity}\n` +
      `Unique cards: ${uniqueCards}\n` +
      `Total quantity: ${totalQuantity} cards\n` +
      `Rate: ${rate} coins per card\n` +
      `Total coins: ${totalCoins}\n\n` +
      `Are you sure you want to fuse all ${rarity} cards?`;
    
    await ctx.replyWithHTML(confirmMessage, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm Fuse', callback_data: `fuse_confirm_rarity_${rarity}` },
            { text: '❌ Cancel', callback_data: 'fuse_cancel' }
          ]
        ]
      },
      ...getReplyParams(ctx)
    });
    
  } catch (error) {
    console.error('Error in handleFuseByRarity:', error);
    await ctx.reply('An error occurred while processing the fuse request.', { ...getReplyParams(ctx) });
  }
}

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

// Command to change or add image for a card: /changeimage card_id image_link (admin only)
bot.command('changeimage', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  if (!await isAdmin(user)) {
    return ctx.reply('Only admins can use this command.', { ...getReplyParams(ctx) });
  }
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

// Rarity fuse rates mapping (coins per card)
const RARITY_FUSE_RATES: {
  [key: string]: number;
} = {
  'COMMON': 10,
  'MEDIUM': 20,
  'RARE': 50,
  'LEGENDARY': 100,
  'EXCLUSIVE': 200,
  'LIMITED_EDITION': 1000,
  'COSMIC': 10000,
  'PRIME': 100000,
  'PREMIUM': 1000000 // Adding premium rate for completeness
};

// Function to get emoji for a rarity
function getRarityWithEmoji(rarity: string): string {
  return `${RARITY_EMOJIS[rarity] || ''} ${rarity}`;
}

// Function to calculate user rank based on total cards collected
function calculateRank(totalCardsCollected: number): number {
  if (totalCardsCollected >= 0 && totalCardsCollected <= 100) return 1;
  if (totalCardsCollected >= 101 && totalCardsCollected <= 250) return 2;
  if (totalCardsCollected >= 251 && totalCardsCollected <= 1000) return 3;
  if (totalCardsCollected >= 1001 && totalCardsCollected <= 2000) return 4;
  if (totalCardsCollected >= 2001 && totalCardsCollected <= 3000) return 5;
  if (totalCardsCollected >= 3001 && totalCardsCollected <= 5000) return 6;
  if (totalCardsCollected >= 5001 && totalCardsCollected <= 7500) return 7;
  if (totalCardsCollected >= 7501 && totalCardsCollected <= 10000) return 8;
  if (totalCardsCollected >= 10001 && totalCardsCollected <= 20000) return 9;
  if (totalCardsCollected >= 20001 && totalCardsCollected <= 40000) return 10;
  if (totalCardsCollected >= 40001 && totalCardsCollected <= 75000) return 11;
  return 12; // For 75000+ cards
}

// Function to get rank name and emoji
function getRankInfo(rank: number): { emoji: string; name: string } {
  const rankInfo: { [key: number]: { emoji: string; name: string } } = {
    1: { emoji: '🪶', name: 'Rookie' },
    2: { emoji: '🧒', name: 'Gully Champ' },
    3: { emoji: '🏕️', name: 'Street Cricketer' },
    4: { emoji: '🥉', name: 'Rising Talent' },
    5: { emoji: '🧢', name: 'Club Captain' },
    6: { emoji: '🧤', name: 'Power Striker' },
    7: { emoji: '🏏', name: 'Pro Batter' },
    8: { emoji: '🥈', name: 'All-Star Player' },
    9: { emoji: '🏆', name: 'League Master' },
    10: { emoji: '🥇', name: 'World Champion' },
    11: { emoji: '🏅', name: 'Ultimate Legend' },
    12: { emoji: '👑', name: 'Transcendent Master' }
  };
  return rankInfo[rank] || { emoji: '⭐', name: 'Unknown' };
}

// Function to get today's collection count
async function getTodayCollectionCount(prisma: PrismaClient, userId: number): Promise<number> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // Count cards collected today by checking ownership records created today
  const todayOwnerships = await prisma.ownership.findMany({
    where: {
      userId: userId,
      createdAt: {
        gte: today,
        lt: tomorrow
      }
    }
  });
  
  return todayOwnerships.reduce((sum, ownership) => sum + ownership.quantity, 0);
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
    // Spam detection system
    if (ctx.from) {
      const userId = ctx.from.id;
      const now = Date.now();
      
      // Check if user is temporarily banned
      if (tempBannedUsers.has(userId)) {
        const banEndTime = tempBannedUsers.get(userId)!;
        if (now < banEndTime) {
          // User is still banned, don't count their message for card drops
          // But don't delete the message - just skip processing
          return next();
        } else {
          // Ban expired, remove from temp banned list
          tempBannedUsers.delete(userId);
        }
      }
      
      // Check if user is admin (admins are exempt from spam detection)
      try {
        const user = await ensureUser(prisma, ctx.from);
        if (user.isAdmin) {
          // Admin users are exempt from spam detection
        } else {
          // Non-admin users: check spam limit
          const userData = messageCounts.get(userId);
          const twoSecondsAgo = now - 2000;
          
          if (!userData || userData.lastReset < twoSecondsAgo) {
            // Reset counter for new 2-second window
            messageCounts.set(userId, { count: 1, lastReset: now });
          } else {
            // Increment counter
            userData.count++;
            messageCounts.set(userId, userData);
            
            // Check if limit exceeded
            if (userData.count > spamLimit) {
              // Ban user for 2 minutes
              const banEndTime = now + (2 * 60 * 1000); // 2 minutes
              tempBannedUsers.set(userId, banEndTime);
              
              // Don't delete the message - just notify about the ban
              await ctx.reply(`🚫 ${ctx.from.first_name || 'User'} has been temporarily banned for 2 minutes due to spam (${userData.count} messages in 2 seconds).`);
              return;
            }
          }
        }
      } catch (error) {
        console.error('Error in spam detection:', error);
      }
    }
    
    // Check if the user is banned before counting their message
    if (ctx.from) {
      try {
        const user = await ensureUser(prisma, ctx.from);
        if (user.isBanned) {
          return next(); // Don't count messages from banned users
        }
      } catch (error) {
        console.error('Error checking user ban status:', error);
      }
    }
    
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
async function sendCardDetails(ctx: any, card: any, chatId?: number, prefix?: string, showTopCollectors?: boolean) {
  // Always use ctx.telegram.sendPhoto for sending images, to avoid argument confusion

  // Debug log to verify arguments
  console.log('sendCardDetails called with:', {
    chatId: chatId || ctx.chat.id,
    imageUrl: card.imageUrl,
    card,
    showTopCollectors
  });

  if (typeof card.imageUrl !== 'string' || !card.imageUrl.startsWith('http')) {
    console.error('Invalid imageUrl:', card.imageUrl);
    // Fallback: If no image or image sending failed, send text-only message
    const cardDetails = `${prefix ? prefix + '\n\n' : ''}` +
      `👤<b>Name:</b> ${card.name}\n` +
      `💮 <b>Rarity:</b> ${getRarityWithEmoji(card.rarity)} ${card.rarity}\n` +
      `🤝<b>ᴛᴇᴀᴍ:</b> ${card.country}\n\n` +
      `${card.bio ? `ʙɪᴏ: ${card.bio}\n` : ''}` +
      `ʀᴏʟᴇ: ${card.role}\n\n` +
      `🆔 <b>ID:</b> ${card.id}`;
    
    // Add Top Collectors button if requested
    const replyMarkup = showTopCollectors ? {
      inline_keyboard: [
        [{ text: '🏆 Top Collectors', callback_data: `top_collectors_${card.id}` }]
      ]
    } : undefined;
    
    await ctx.telegram.sendMessage(
      chatId || ctx.chat.id,
      cardDetails,
      { parse_mode: 'HTML', reply_markup: replyMarkup, ...getReplyParams(ctx) }
    );
    return true;
  }

  try {
    const cardDetails = `${prefix ? prefix + '\n\n' : ''}` +
      `👤<b>Name:</b> ${card.name}\n` +
      `💮 <b>Rarity:</b> ${getRarityWithEmoji(card.rarity)} ${card.rarity}\n` +
      `🤝<b>ᴛᴇᴀᴍ:</b> ${card.country}\n\n` +
      `${card.bio ? `ʙɪᴏ: ${card.bio}\n` : ''}` +
      `ʀᴏʟᴇ: ${card.role}\n\n` +
      `🆔 <b>ID:</b> ${card.id}`;
    console.log('Calling sendPhoto with:', chatId || ctx.chat.id, card.imageUrl);
    
    // Add Top Collectors button if requested
    const replyMarkup = showTopCollectors ? {
      inline_keyboard: [
        [{ text: '🏆 Top Collectors', callback_data: `top_collectors_${card.id}` }]
      ]
    } : undefined;
    
    await ctx.telegram.sendPhoto(
      chatId || ctx.chat.id,
      card.imageUrl,
      {
        caption: cardDetails,
        parse_mode: 'HTML' as const,
        reply_markup: replyMarkup,
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
      const cardDetails = `${prefix ? prefix + '\n\n' : ''}` +
      `👤<b>Name:</b> ${card.name}\n` +
      `💮 <b>Rarity:</b> ${getRarityWithEmoji(card.rarity)} ${card.rarity}\n` +
      `🤝<b>ᴛᴇᴀᴍ:</b> ${card.country}\n\n` +
      `${card.bio ? `ʙɪᴏ: ${card.bio}\n` : ''}` +
      `ʀᴏʟᴇ: ${card.role}\n\n` +
      `🆔 <b>ID:</b> ${card.id}`;
      try {
        await ctx.telegram.sendPhoto(
          chatId || ctx.chat.id,
          { source: buffer, filename: 'card.jpg' },
          {
            caption: cardDetails,
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
  const cardDetails = `${prefix ? prefix + '\n\n' : ''}<b>Card details:</b>\n<b>Card ID:</b> ${card.id}\n<b>Name:</b> ${card.name}\n<b>Rarity:</b> ${getRarityWithEmoji(card.rarity)}\n<b>Country:</b> ${card.country}\n<b>Role:</b> ${card.role}${card.bio ? `\n<b>Bio:</b> ${card.bio}` : ''}`;
  await ctx.telegram.sendMessage(
    chatId || ctx.chat.id,
    cardDetails,
    { parse_mode: 'HTML', ...getReplyParams(ctx) }
  );
  return true;
}

// Helper function to handle fuse confirmation for specific card
async function handleFuseConfirmCard(ctx: any) {
  try {
    const data = ctx.callbackQuery.data;
    const cardId = Number(data.replace('fuse_confirm_card_', ''));
    const user = await ensureUser(prisma, ctx.from);
    
    // Get ownership details
    const ownership = await prisma.ownership.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      },
      include: { card: true }
    });
    
    if (!ownership) {
      await ctx.answerCbQuery("Card not found in your collection.");
      await ctx.editMessageText("❌ Card not found in your collection.");
      return;
    }
    
    // Check if card is locked from fusing
    const fuseLock = await prisma.fuseLock.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      }
    });
    
    if (fuseLock) {
      await ctx.answerCbQuery("Card is locked from fusing.");
      await ctx.editMessageText(
        `🔒 **Card is Locked from Fusing**\n\n` +
        `Card: ${getRarityWithEmoji(ownership.card.rarity)} ${ownership.card.name}\n` +
        `Card ID: ${cardId}\n\n` +
        `This card is protected from fusing. Use /fuseunlock ${cardId} to unlock it.`,
        { parse_mode: 'HTML' }
      );
      return;
    }
    
    const card = ownership.card;
    const quantity = ownership.quantity;
    const rarity = card.rarity;
    const rate = RARITY_FUSE_RATES[rarity] || 0;
    const totalCoins = quantity * rate;
    
    // Remove the ownership record
    await prisma.ownership.delete({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      }
    });
    
    // Add coins to user
    await prisma.user.update({
      where: { id: user.id },
      data: { coins: { increment: totalCoins } }
    });
    
    // Update user object for display
    user.coins += totalCoins;
    
    const emoji = RARITY_EMOJIS[rarity] || '⭐';
    const successMessage = `🔥 <b>Fuse Successful!</b>\n\n` +
      `Card: ${emoji} ${card.name} (ID: ${cardId})\n` +
      `Rarity: ${rarity}\n` +
      `Fused: ${quantity} cards\n` +
      `Coins received: ${totalCoins}\n` +
      `New balance: ${user.coins} coins`;
    
    await ctx.answerCbQuery("Cards fused successfully!");
    await ctx.editMessageText(successMessage, { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('Error in handleFuseConfirmCard:', error);
    await ctx.answerCbQuery("An error occurred during fusion.");
    await ctx.editMessageText("❌ An error occurred during fusion.");
  }
}

// Helper function to handle fuse confirmation for rarity
async function handleFuseConfirmRarity(ctx: any) {
  try {
    const data = ctx.callbackQuery.data;
    const rarity = data.replace('fuse_confirm_rarity_', '');
    const user = await ensureUser(prisma, ctx.from);
    
    // Get all cards of this rarity owned by user
    const ownerships = await prisma.ownership.findMany({
      where: { userId: user.id },
      include: { card: true }
    });
    
    // Get all fuse locks for this user
    const fuseLocks = await prisma.fuseLock.findMany({
      where: { userId: user.id }
    });
    const lockedCardIds = new Set(fuseLocks.map(lock => lock.cardId));
    
    // Filter cards of this rarity, excluding locked ones
    const cardsOfRarity = ownerships.filter(ownership => 
      ownership.card.rarity === rarity && !lockedCardIds.has(ownership.cardId)
    );
    
    if (cardsOfRarity.length === 0) {
      await ctx.answerCbQuery("No cards of this rarity found.");
      await ctx.editMessageText("❌ No cards of this rarity found.");
      return;
    }
    
    const totalQuantity = cardsOfRarity.reduce((sum, ownership) => sum + ownership.quantity, 0);
    const rate = RARITY_FUSE_RATES[rarity];
    const totalCoins = totalQuantity * rate;
    const uniqueCards = cardsOfRarity.length;
    
    // Remove all ownership records for this rarity
    const cardIds = cardsOfRarity.map(ownership => ownership.cardId);
    await prisma.ownership.deleteMany({
      where: {
        userId: user.id,
        cardId: { in: cardIds }
      }
    });
    
    // Add coins to user
    await prisma.user.update({
      where: { id: user.id },
      data: { coins: { increment: totalCoins } }
    });
    
    // Update user object for display
    user.coins += totalCoins;
    
    const emoji = RARITY_EMOJIS[rarity] || '⭐';
    const successMessage = `🔥 <b>Fuse Successful!</b>\n\n` +
      `Rarity: ${emoji} ${rarity}\n` +
      `Unique cards: ${uniqueCards}\n` +
      `Fused: ${totalQuantity} cards\n` +
      `Coins received: ${totalCoins}\n` +
      `New balance: ${user.coins} coins`;
    
    await ctx.answerCbQuery("Cards fused successfully!");
    await ctx.editMessageText(successMessage, { parse_mode: 'HTML' });
    
  } catch (error) {
    console.error('Error in handleFuseConfirmRarity:', error);
    await ctx.answerCbQuery("An error occurred during fusion.");
    await ctx.editMessageText("❌ An error occurred during fusion.");
  }
}

// Fuse lock command: /fuselock card_id
bot.command('fuselock', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  
  if (!cardId) {
    await ctx.reply('Usage: /fuselock &lt;card_id&gt;\n\nExample: /fuselock 123', { ...getReplyParams(ctx), parse_mode: 'HTML' });
    return;
  }
  
  try {
    // Check if user owns this card
    const ownership = await prisma.ownership.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      },
      include: { card: true }
    });
    
    if (!ownership) {
      await ctx.reply(`You don't own any cards with ID ${cardId}.`, { ...getReplyParams(ctx) });
      return;
    }
    
    // Check if card is already locked
    const existingLock = await prisma.fuseLock.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      }
    });
    
    if (existingLock) {
      await ctx.reply(`Card "${ownership.card.name}" (ID: ${cardId}) is already locked from fusing.`, { ...getReplyParams(ctx) });
      return;
    }
    
    // Create fuse lock
    await prisma.fuseLock.create({
      data: {
        userId: user.id,
        cardId: cardId
      }
    });
    
    await ctx.reply(
      `🔒 **Card Locked from Fusing**\n\n` +
      `Card: ${getRarityWithEmoji(ownership.card.rarity)} ${ownership.card.name}\n` +
      `Card ID: ${cardId}\n\n` +
      `This card will not be affected by /fuse commands.`,
      { ...getReplyParams(ctx), parse_mode: 'HTML' }
    );
    
  } catch (e: any) {
    await ctx.reply('Failed to lock card: ' + (e.message || e), { ...getReplyParams(ctx) });
  }
});

// Fuse unlock command: /fuseunlock card_id
bot.command('fuseunlock', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  const cardId = Number(parts[1]);
  
  if (!cardId) {
    await ctx.reply('Usage: /fuseunlock &lt;card_id&gt;\n\nExample: /fuseunlock 123', { ...getReplyParams(ctx), parse_mode: 'HTML' });
    return;
  }
  
  try {
    // Check if fuse lock exists
    const fuseLock = await prisma.fuseLock.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      },
      include: { card: true }
    });
    
    if (!fuseLock) {
      await ctx.reply(`Card ID ${cardId} is not locked from fusing.`, { ...getReplyParams(ctx) });
      return;
    }
    
    // Remove fuse lock
    await prisma.fuseLock.delete({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      }
    });
    
    await ctx.reply(
      `🔓 **Card Unlocked from Fusing**\n\n` +
      `Card: ${getRarityWithEmoji(fuseLock.card.rarity)} ${fuseLock.card.name}\n` +
      `Card ID: ${cardId}\n\n` +
      `This card can now be fused again.`,
      { ...getReplyParams(ctx), parse_mode: 'HTML' }
    );
    
  } catch (e: any) {
    await ctx.reply('Failed to unlock card: ' + (e.message || e), { ...getReplyParams(ctx) });
  }
});

// Fuse check command: /fusecheck
bot.command('fusecheck', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  
  try {
    // Get all fuse locks for this user
    const fuseLocks = await prisma.fuseLock.findMany({
      where: { userId: user.id },
      include: { card: true },
      orderBy: { createdAt: 'desc' }
    });
    
    if (fuseLocks.length === 0) {
      await ctx.reply(
        `🔒 **Fuse Lock Status**\n\n` +
        `No cards are currently locked from fusing.\n\n` +
        `Use /fuselock &lt;card_id&gt; to lock a card from being fused.`,
        { ...getReplyParams(ctx), parse_mode: 'HTML' }
      );
      return;
    }
    
    let message = `🔒 **Fuse Lock Status**\n\n`;
    message += `You have ${fuseLocks.length} card(s) locked from fusing:\n\n`;
    
    fuseLocks.forEach((lock, index) => {
      const card = lock.card;
      message += `${index + 1}. ${getRarityWithEmoji(card.rarity)} **${card.name}** (ID: ${card.id})\n`;
    });
    
    message += `\n━━━━━━━━━━━━━━━━━━\n`;
    message += `Use /fuseunlock &lt;card_id&gt; to unlock a card.`;
    
    await ctx.reply(message, { ...getReplyParams(ctx), parse_mode: 'HTML' });
    
  } catch (e: any) {
    await ctx.reply('Failed to check fuse locks: ' + (e.message || e), { ...getReplyParams(ctx) });
  }
});

// Favorite card command: /fav card_id
bot.command('fav', async (ctx) => {
  const user = await ensureUser(prisma, ctx.from);
  const parts = (ctx.message.text || '').split(/\s+/);
  
  if (parts.length === 1) {
    // Show current favorite card
    if (!user.favoriteCardId) {
      await ctx.reply(
        `⭐ ━━━〔 FAVORITE CARD 〕━━━ ⭐\n\n` +
        `❌ **No favorite card set yet.**\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💡 Use /fav &lt;card_id&gt; to set your favorite card!`,
        { ...getReplyParams(ctx), parse_mode: 'HTML' }
      );
      return;
    }
    
    // Get favorite card details
    const favoriteCard = await prisma.card.findUnique({
      where: { id: user.favoriteCardId }
    });
    
    if (!favoriteCard) {
      await ctx.reply(
        `⭐ ━━━〔 FAVORITE CARD 〕━━━ ⭐\n\n` +
        `❌ **Card Not Found**\n` +
        `Your favorite card (ID: ${user.favoriteCardId}) no longer exists.\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `💡 Use /fav &lt;card_id&gt; to set a new favorite card!`,
        { ...getReplyParams(ctx), parse_mode: 'HTML' }
      );
      return;
    }
    
    // Send favorite card with image and nice formatting
    const cardDetails = `⭐ ━━━ YOUR FAVORITE CARD ━━━ ⭐\n\n` +
      `🏆 ${favoriteCard.name}\n` +
      `🎯 Rarity: ${getRarityWithEmoji(favoriteCard.rarity)}\n` +
      `🌍 Country: ${favoriteCard.country}\n` +
      `━━━━━━━━━━━━━━━━━━\n`;
    
    if (favoriteCard.imageUrl && favoriteCard.imageUrl.startsWith('http')) {
      await ctx.replyWithPhoto(
        favoriteCard.imageUrl,
        {
          caption: cardDetails,
          ...getReplyParams(ctx)
        }
      );
    } else {
      await ctx.reply(cardDetails, { ...getReplyParams(ctx), parse_mode: 'HTML' });
    }
    return;
  }
  
  const cardId = Number(parts[1]);
  if (!cardId) {
    await ctx.reply('Usage: /fav &lt;card_id&gt; to set favorite card\n/fav to show current favorite card', { ...getReplyParams(ctx), parse_mode: 'HTML' });
    return;
  }
  
  try {
    // Check if user owns this card
    const ownership = await prisma.ownership.findUnique({
      where: {
        userId_cardId: {
          userId: user.id,
          cardId: cardId
        }
      },
      include: { card: true }
    });
    
    if (!ownership) {
      await ctx.reply(`You don't own any cards with ID ${cardId}.`, { ...getReplyParams(ctx) });
      return;
    }
    
    // Set as favorite card
    await prisma.user.update({
      where: { id: user.id },
      data: { favoriteCardId: cardId }
    });
    
    await ctx.reply(
      `⭐ ━━━〔 FAVORITE CARD SET 〕━━━ ⭐\n\n` +
      `🏆 **${ownership.card.name}**\n` +
      `🎯 ${getRarityWithEmoji(ownership.card.rarity)} **${ownership.card.rarity}**\n` +
      `🌍 **Country:** ${ownership.card.country}\n` +
      `⚡ **Role:** ${ownership.card.role}\n` +
      `🆔 **Card ID:** ${cardId}\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `✨ This card will now appear in your /cards and /profile!`,
      { ...getReplyParams(ctx), parse_mode: 'HTML' }
    );
    
  } catch (e: any) {
    await ctx.reply('Failed to set favorite card: ' + (e.message || e), { ...getReplyParams(ctx) });
  }
});


// Handler for Top Collectors button
async function handleTopCollectors(ctx: any) {
  try {
    const data = ctx.callbackQuery.data;
    const cardId = Number(data.replace('top_collectors_', ''));
    
    if (!cardId) {
      await ctx.answerCbQuery('Invalid card ID.');
      return;
    }
    
    // Get the card details first
    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) {
      await ctx.answerCbQuery('Card not found.');
      return;
    }
    
    // Get top 10 collectors of this card
    const topCollectors = await prisma.ownership.findMany({
      where: { cardId: cardId },
      include: { user: true },
      orderBy: { quantity: 'desc' },
      take: 10
    });
    
    if (topCollectors.length === 0) {
      const noCollectorsMessage = `🏆 **Top Collectors for ${card.name}**\n\n` +
        `No one owns this card yet! Be the first to collect it! 🎯`;
      
      try {
        await ctx.editMessageText(noCollectorsMessage, { parse_mode: 'Markdown' });
      } catch (error) {
        // If editMessageText fails, try editMessageCaption (for photo messages)
        await ctx.editMessageCaption(noCollectorsMessage, { parse_mode: 'Markdown' });
      }
      await ctx.answerCbQuery('No collectors found.');
      return;
    }
    
    // Build the top collectors message
    let message = `🏆 **Top Collectors for ${card.name}**\n\n`;
    
    topCollectors.forEach((ownership, index) => {
      const rank = index + 1;
      const userName = ownership.user.firstName || ownership.user.username || 'Anonymous';
      const quantity = ownership.quantity;
      
      // Add rank emoji
      const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅';
      
      message += `${rankEmoji} **${rank}.** ${userName} — **${quantity}** \n`;
    });
    
    message += `\n━━━━━━━━━━━━━━━━━━\n`;
    message += `📊 Total collectors: ${topCollectors.length}`;
    
    try {
      await ctx.editMessageText(message, { parse_mode: 'Markdown' });
    } catch (error) {
      // If editMessageText fails, try editMessageCaption (for photo messages)
      await ctx.editMessageCaption(message, { parse_mode: 'Markdown' });
    }
    await ctx.answerCbQuery('Top collectors displayed!');
    
  } catch (error) {
    console.error('Error in handleTopCollectors:', error);
    await ctx.answerCbQuery('Error loading top collectors.');
  }
}

// Updated Callback query handler to show complete card details
bot.on("callback_query", async (ctx, next) => {
  try {
    if ('data' in ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
    
    if (data === "check_card") {
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
    } else if (data === "fuse_cancel") {
      await ctx.answerCbQuery("Fuse cancelled.");
      await ctx.editMessageText("❌ Fuse operation cancelled.");
    } else if (data.startsWith("fuse_confirm_card_")) {
      await handleFuseConfirmCard(ctx);
    } else if (data.startsWith("fuse_confirm_rarity_")) {
      await handleFuseConfirmRarity(ctx);
    } else if (data.startsWith("top_collectors_")) {
      await handleTopCollectors(ctx);
  } else {
    return next();
    }
  } else {
    return next();
  }
  } catch (error: any) {
    console.error('Error in callback query handler:', error);
    try {
      await ctx.answerCbQuery('❌ An error occurred. Please try again.');
    } catch (answerError) {
      console.error('Failed to answer callback query:', answerError);
    }
  }
});

// Search callback handlers
bot.action('search_popular', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Show popular cards
    const popularCards = await prisma.card.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' }
    });
    
    let resultMessage = `🔍 **Popular Players**\n\n`;
    resultMessage += `Here are some popular cards:\n\n`;
    
    popularCards.forEach((card, index) => {
      resultMessage += `${index + 1}. **${card.name}**\n`;
      resultMessage += `   ${getRarityWithEmoji(card.rarity)} ${card.rarity} • ${card.country} ${getCountryFlag(card.country)}\n`;
      resultMessage += `   ID: ${card.id} • Role: ${card.role}\n\n`;
    });
    
    resultMessage += `━━━━━━━━━━━━━━━━━━\n`;
    resultMessage += `💡 Use /check <card_id> for more details\n`;
    resultMessage += `💡 Use /search <player_name> to search for specific players`;
    
    await ctx.editMessageText(resultMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Search Popular Players', callback_data: 'search_popular' }],
          [{ text: '📋 View All Cards', callback_data: 'view_all_cards' }],
          [{ text: '❓ Help', callback_data: 'search_help' }]
        ]
      }
    });
    
  } catch (error: any) {
    console.error('Error in search_popular callback:', error);
    await ctx.answerCbQuery('❌ An error occurred. Please try again.');
  }
});

bot.action('view_all_cards', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    // Redirect to allcards command
    const allCards = await prisma.card.findMany({
      take: 15,
      orderBy: [
        { rarity: 'asc' },
        { name: 'asc' }
      ]
    });
    
    let resultMessage = `📋 **All Cards (Sample)**\n\n`;
    resultMessage += `Showing ${allCards.length} cards:\n\n`;
    
    allCards.forEach((card, index) => {
      resultMessage += `${index + 1}. **${card.name}**\n`;
      resultMessage += `   ${getRarityWithEmoji(card.rarity)} ${card.rarity} • ${card.country} ${getCountryFlag(card.country)}\n`;
      resultMessage += `   ID: ${card.id} • Role: ${card.role}\n\n`;
    });
    
    resultMessage += `━━━━━━━━━━━━━━━━━━\n`;
    resultMessage += `💡 Use /allcards for complete list\n`;
    resultMessage += `💡 Use /check <card_id> for more details`;
    
    await ctx.editMessageText(resultMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Search Popular Players', callback_data: 'search_popular' }],
          [{ text: '📋 View All Cards', callback_data: 'view_all_cards' }],
          [{ text: '❓ Help', callback_data: 'search_help' }]
        ]
      }
    });
    
  } catch (error: any) {
    console.error('Error in view_all_cards callback:', error);
    await ctx.answerCbQuery('❌ An error occurred. Please try again.');
  }
});

bot.action('search_help', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const helpMessage = `❓ **Search Help**\n\n` +
      `**How to search for cards:**\n\n` +
      `1. **Direct Search:**\n` +
      `   • Type \`/search <player_name>\`\n` +
      `   • Example: \`/search virat\` or \`/search rohit\`\n\n` +
      `2. **View All Cards:**\n` +
      `   • Use \`/allcards\` to see all available cards\n` +
      `   • Use \`/cards rarity\` to filter by rarity\n\n` +
      `3. **Check Card Details:**\n` +
      `   • Use \`/check <card_id>\` for detailed information\n\n` +
      `**Search Tips:**\n` +
      `• Use partial names (e.g., "Rohit" instead of "Rohit Sharma")\n` +
      `• Search is case-insensitive\n` +
      `• Try different spellings if no results found\n\n` +
      `**Available Rarities:**\n` +
      `• ${getRarityWithEmoji('COMMON')} Common\n` +
      `• ${getRarityWithEmoji('RARE')} Rare\n` +
      `• ${getRarityWithEmoji('LEGENDARY')} Legendary\n` +
      `• ${getRarityWithEmoji('LIMITED_EDITION')} Limited Edition\n` +
      `• ${getRarityWithEmoji('COSMIC')} Cosmic\n` +
      `• ${getRarityWithEmoji('PREMIUM')} Premium`;
    
    await ctx.editMessageText(helpMessage, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔍 Search Popular Players', callback_data: 'search_popular' }],
          [{ text: '📋 View All Cards', callback_data: 'view_all_cards' }],
          [{ text: '❓ Help', callback_data: 'search_help' }]
        ]
      }
    });
    
  } catch (error: any) {
    console.error('Error in search_help callback:', error);
    await ctx.answerCbQuery('❌ An error occurred. Please try again.');
  }
});

// Inline query handler for card search
bot.on('inline_query', async (ctx) => {
  try {
    const query = ctx.inlineQuery.query.trim().toLowerCase();
    
    if (!query || query.length < 2) {
      // If no query or too short, show some popular cards
      const popularCards = await prisma.card.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' }
      });
      
      const results = popularCards.map(card => ({
        type: 'article' as const,
        id: `card_${card.id}`,
        title: card.name,
        description: `${getRarityWithEmoji(card.rarity)} ${card.rarity} • ${card.country} • ${card.role}`,
        thumb_url: card.imageUrl || undefined,
        input_message_content: {
          message_text: `🔍 **Search Result**\n\n` +
            `**Name:** ${card.name}\n` +
            `**Rarity:** ${getRarityWithEmoji(card.rarity)} ${card.rarity}\n` +
            `**Country:** ${card.country} ${getCountryFlag(card.country)}\n` +
            `**ID:** ${card.id}\n` +
            `**Role:** ${card.role}${card.bio ? `\n**Bio:** ${card.bio}` : ''}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💡 **Click the button below to see the full card with image!**`,
          parse_mode: 'HTML' as const,
          reply_markup: {
            inline_keyboard: [
              [{ text: '🖼️ View Full Card', callback_data: `show_card_${card.id}` }]
            ]
          }
        }
      }));
      
      await ctx.answerInlineQuery(results, { cache_time: 300 });
      return;
    }
    
    // Search for cards containing the query in name (case-insensitive)
    const searchResults = await prisma.card.findMany({
      where: {
        name: {
          contains: query
        }
      },
      take: 20,
      orderBy: [
        { rarity: 'asc' },
        { name: 'asc' }
      ]
    });
    
    if (searchResults.length === 0) {
      await ctx.answerInlineQuery([{
        type: 'article' as const,
        id: 'no_results',
        title: 'No cards found',
        description: `No cards found for "${query}"`,
        input_message_content: {
          message_text: `🔍 Search Results\n\n` +
            `❌ No cards found for "${query}"\n\n` +
            `💡 Search Tips:\n` +
            `• Try different spellings\n` +
            `• Use partial names (e.g., "Rohit" instead of "Rohit Sharma")\n` +
            `• Check /allcards to see all available cards`,
        }
      }], { cache_time: 300 });
      return;
    }
    
    const results = searchResults.map(card => ({
      type: 'article' as const,
      id: `card_${card.id}`,
      title: card.name,
      description: `${getRarityWithEmoji(card.rarity)} ${card.rarity} • ${card.country} • ${card.role}`,
      thumb_url: card.imageUrl || undefined,
      input_message_content: {
        message_text: `🔍 **Search Result**\n\n` +
          `**Name:** ${card.name}\n` +
          `**Rarity:** ${getRarityWithEmoji(card.rarity)} ${card.rarity}\n` +
          `**Country:** ${card.country} ${getCountryFlag(card.country)}\n` +
          `**ID:** ${card.id}\n` +
          `**Role:** ${card.role}${card.bio ? `\n**Bio:** ${card.bio}` : ''}\n\n` +
          `━━━━━━━━━━━━━━━━━━\n` +
          `💡 **Click the button below to see the full card with image!**`,
        parse_mode: 'HTML' as const,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🖼️ View Full Card', callback_data: `show_card_${card.id}` }]
          ]
        }
      }
    }));
    
    await ctx.answerInlineQuery(results, { 
      cache_time: 300,
      is_personal: false
    });
    
  } catch (error) {
    console.error('Error in inline query:', error);
    try {
      await ctx.answerInlineQuery([{
        type: 'article' as const,
        id: 'error',
        title: 'Search Error',
        description: 'An error occurred while searching',
        input_message_content: {
          message_text: '❌ An error occurred while searching for cards. Please try again.',
        }
      }], { cache_time: 10 });
    } catch (answerError) {
      console.error('Failed to answer inline query:', answerError);
    }
  }
});


// Handler for showing full card from search results
bot.action(/^show_card_(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();
    
    const cardId = parseInt(ctx.match[1]);
    
    // Get the card details
    const card = await prisma.card.findUnique({
      where: { id: cardId }
    });
    
    if (!card) {
      await ctx.editMessageText('❌ Card not found.');
      return;
    }
    
    // Send the full card with image using the existing sendCardDetails function
    await sendCardDetails(ctx, card, undefined, '🔍 **Search Result - Full Card**');
    
  } catch (error: any) {
    console.error('Error in show_card callback:', error);
    try {
      await ctx.answerCbQuery('❌ An error occurred. Please try again.');
    } catch (answerError) {
      console.error('Failed to answer callback query:', answerError);
    }
  }
});

// Handler for collecting the card in group chat when a user types the card name
bot.on("text", async (ctx, next) => {
  try {
    // Check if user is banned before processing any text
    if (ctx.from) {
      const user = await ensureUser(prisma, ctx.from);
      
      // If user is banned, don't process their messages for card drops
      if (user.isBanned) {
        return next();
      }
    }

    // Handle bio change for admins
    if (ctx.from) {
    const admin = await ensureUser(prisma, ctx.from);
    if (await isAdmin(admin) && pendingBioChanges.has(admin.id)) {
      const cardId = pendingBioChanges.get(admin.id)!;
      const newBio = ctx.message.text;
      
      try {
        const updatedCard = await prisma.card.update({
          where: { id: cardId },
          data: { bio: newBio }
        });
        
        // Clear the pending change
        pendingBioChanges.delete(admin.id);
        
        await ctx.reply(
          `📝 **Bio Changed Successfully!**\n\n` +
          `**Card:** ${updatedCard.name}\n` +
          `**New Bio:** ${newBio}\n` +
          `**Card ID:** ${cardId}`,
          { ...getReplyParams(ctx), parse_mode: 'HTML' }
        );
        return;
      } catch (e: any) {
        pendingBioChanges.delete(admin.id);
        await ctx.reply('Failed to change bio: ' + (e.message || e), { ...getReplyParams(ctx) });
        return;
      }
    }
    
    // Handle addcard wizard for admins
    if (await isAdmin(admin) && addCardStates.has(admin.id)) {
      const state = addCardStates.get(admin.id)!;
      const input = ctx.message.text;
      
      try {
        if (state.step === 'name') {
          state.card.name = input;
          state.step = 'rarity';
          
          const keyboard = {
            inline_keyboard: [
              [
                { text: '🥉 Common', callback_data: 'addcard_rarity_COMMON' },
                { text: '🥈 Medium', callback_data: 'addcard_rarity_MEDIUM' }
              ],
              [
                { text: '🥇 Rare', callback_data: 'addcard_rarity_RARE' },
                { text: '🟡 Legendary', callback_data: 'addcard_rarity_LEGENDARY' }
              ],
              [
                { text: '💮 Exclusive', callback_data: 'addcard_rarity_EXCLUSIVE' },
                { text: '🔮 Limited Edition', callback_data: 'addcard_rarity_LIMITED_EDITION' }
              ],
              [
                { text: '💠 Cosmic', callback_data: 'addcard_rarity_COSMIC' },
                { text: '♠️ Prime', callback_data: 'addcard_rarity_PRIME' }
              ],
              [
                { text: '🧿 Premium', callback_data: 'addcard_rarity_PREMIUM' }
              ]
            ]
          };
          
          await ctx.reply(
            `✅ Name set: ${input}\n\n` +
            `Step 2/6: Select card rarity:`,
            { ...getReplyParams(ctx), reply_markup: keyboard }
          );
          return;
        } else if (state.step === 'country') {
          state.card.country = input;
          state.step = 'role';
          
          await ctx.reply(
            `✅ Country set: ${input}\n\n` +
            `Step 4/6: Enter the player role:\n\n` +
            `Example: Batsman, Bowler, All-rounder, Wicket-keeper`,
            { ...getReplyParams(ctx) }
          );
          return;
        } else if (state.step === 'role') {
          state.card.role = input;
          state.step = 'bio';
          
          await ctx.reply(
            `✅ Role set: ${input}\n\n` +
            `Step 5/6: Enter the player bio (or type "skip"):\n\n` +
            `Example: Legendary Indian cricketer and former captain`,
            { ...getReplyParams(ctx) }
          );
          return;
        } else if (state.step === 'bio') {
          state.card.bio = input === 'skip' ? null : input;
          state.step = 'image';
          
          await ctx.reply(
            `✅ Bio set: ${input === 'skip' ? 'None' : input}\n\n` +
            `Step 6/6: Enter the image URL (or type "skip"):\n\n` +
            `Example: https://example.com/image.jpg`,
            { ...getReplyParams(ctx) }
          );
          return;
        } else if (state.step === 'image') {
          state.card.imageUrl = input === 'skip' ? null : input;
          
          // Create the card
          try {
            const nextId = await getNextCardId(prisma);
            state.card.id = nextId;
            
            const card = await prisma.card.create({ data: state.card });
            
            // Clear the wizard state
            addCardStates.delete(admin.id);
            
            const cardDetails = `✅ Card Created Successfully!\n\n` +
              `Card ID: ${card.id}\n` +
              `Name: ${card.name}\n` +
              `Rarity: ${getRarityWithEmoji(card.rarity)} ${card.rarity}\n` +
              `Country: ${card.country}\n` +
              `Role: ${card.role}${card.bio ? `\nBio: ${card.bio}` : ''}`;
            
            await ctx.reply(cardDetails, { ...getReplyParams(ctx) });
            return;
          } catch (e: any) {
            addCardStates.delete(admin.id);
            await ctx.reply(`❌ Failed to create card: ${e.message}`, { ...getReplyParams(ctx) });
            return;
          }
        }
      } catch (e: any) {
        addCardStates.delete(admin.id);
        await ctx.reply(`❌ An error occurred: ${e.message}`, { ...getReplyParams(ctx) });
        return;
      }
    }
  }
  
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
          // Use transaction to ensure atomicity
          await prisma.$transaction(async (tx) => {
          // Check if user already has this card
            const existing = await tx.ownership.findUnique({
            where: {
              userId_cardId: {
                userId: user.id,
                cardId: activeCard.id
              }
            }
          });

          if (existing) {
            // Increment quantity if user already has the card
              await tx.ownership.update({
              where: { id: existing.id },
              data: { quantity: existing.quantity + 1 }
            });
          } else {
            // Create new ownership if user doesn't have the card
              await tx.ownership.create({
              data: {
                userId: user.id,
                cardId: activeCard.id,
                quantity: 1
              }
            });
          }

            // Increment totalCardsCollected for the user
            await tx.user.update({
              where: { id: user.id },
              data: { totalCardsCollected: { increment: 1 } }
            });
          });

          activeCard.collected = true;
          activeCardDrops.set(chatId, activeCard);
          
          // Get user name for the collection message
          const userName = user.firstName || user.username || 'User';
          
          // Send the enhanced collection message with image and emojis
          await sendCardCollectionMessage(ctx, activeCard, userName);
        } catch (error) {
          console.error('Error adding card to collection:', error);
          await ctx.reply('Error adding card to your collection.');
        }
      }
    }
  }
  return next();
  } catch (error: any) {
    console.error('Error in text handler:', error);
    try {
      await ctx.reply('❌ An error occurred while processing your message. Please try again.');
    } catch (replyError) {
      console.error('Failed to send error reply in text handler:', replyError);
    }
  }
});

// Helper to always get reply_parameters for a ctx
function getReplyParams(ctx: any) {
  return ctx.message?.message_id ? { reply_parameters: { message_id: ctx.message.message_id } } : {};
}

// Helper function to get country flag emoji
function getCountryFlag(country: string): string {
  const flagMap: { [key: string]: string } = {
    'India': '🇮🇳',
    'Australia': '🇦🇺',
    'England': '🇬🇧',
    'Pakistan': '🇵🇰',
    'South Africa': '🇿🇦',
    'New Zealand': '🇳🇿',
    'West Indies': '🇯🇲',
    'Sri Lanka': '🇱🇰',
    'Bangladesh': '🇧🇩',
    'Afghanistan': '🇦🇫',
    'Ireland': '🇮🇪',
    'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'Netherlands': '🇳🇱',
    'Zimbabwe': '🇿🇼',
    'USA': '🇺🇸',
    'Canada': '🇨🇦',
    'UAE': '🇦🇪',
    'Oman': '🇴🇲',
    'Nepal': '🇳🇵',
    'Hong Kong': '🇭🇰',
    'Singapore': '🇸🇬',
    'Malaysia': '🇲🇾',
    'Thailand': '🇹🇭',
    'Japan': '🇯🇵',
    'China': '🇨🇳',
    'Korea': '🇰🇷',
    'Germany': '🇩🇪',
    'France': '🇫🇷',
    'Italy': '🇮🇹',
    'Spain': '🇪🇸',
    'Brazil': '🇧🇷',
    'Argentina': '🇦🇷',
    'Mexico': '🇲🇽',
    'Kenya': '🇰🇪',
    'Uganda': '🇺🇬',
    'Tanzania': '🇹🇿',
    'Namibia': '🇳🇦',
    'Botswana': '🇧🇼',
    'Rwanda': '🇷🇼',
    'Ghana': '🇬🇭',
    'Nigeria': '🇳🇬',
    'Egypt': '🇪🇬',
    'Morocco': '🇲🇦',
    'Tunisia': '🇹🇳',
    'Algeria': '🇩🇿',
    'Libya': '🇱🇾',
    'Sudan': '🇸🇩',
    'Ethiopia': '🇪🇹',
    'Somalia': '🇸🇴',
    'Djibouti': '🇩🇯',
    'Eritrea': '🇪🇷',
    'Somaliland': '🇸🇴',
    'Puntland': '🇸🇴',
    'Galmudug': '🇸🇴',
    'Hirshabelle': '🇸🇴',
    'South West': '🇸🇴',
    'Jubaland': '🇸🇴'
  };
  
  return flagMap[country] || '🏳️';
}

// Function to send card collection message with image and emojis
async function sendCardCollectionMessage(ctx: any, card: any, userName: string) {
  try {
    const rarityEmoji = getRarityWithEmoji(card.rarity);
    const countryFlag = getCountryFlag(card.country);
    
    // Create the collection message with emojis and formatting
    const caption = `🏆 <b>${userName.toUpperCase()}</b> 😲, you've collected a new <b>Card!</b>\n\n` +
      `👤 <b>Name:</b> ${card.name}\n` +
      `💎<b>Rarity:</b> ${rarityEmoji} \n` +
      `🤝 <b>TEAM:</b> ${card.country} \n\n` +
      `🧭 <b>Take A Look At Your Collection Using /</b>cards`;
    
    // Send photo with caption
    if (card.imageUrl) {
      await ctx.replyWithPhoto(card.imageUrl, {
        caption: caption,
        parse_mode: 'HTML',
        ...getReplyParams(ctx)
      });
    } else {
      // Fallback to text message if no image
      await ctx.reply(caption, {
        parse_mode: 'HTML',
        ...getReplyParams(ctx)
      });
    }
  } catch (error) {
    console.error('Error sending card collection message:', error);
    // Fallback to simple text message
    const fallbackMessage = `🏆 <b>${userName.toUpperCase()}</b> 😲, you've collected a new <b>CRICKETERS!</b>\n\n` +
      `👤 <b>Name:</b> ${card.name}\n` +
      `${getRarityWithEmoji(card.rarity)} <b>Rarity:</b> ${card.rarity}\n` +
      `🤝 <b>TEAM:</b> ${card.country} ${getCountryFlag(card.country)}\n\n` +
      `🧭 <b>Take A Look At Your Collection Using /</b>cards`;
    
    await ctx.reply(fallbackMessage, {
      parse_mode: 'HTML',
      ...getReplyParams(ctx)
    });
  }
}

// Ban check middleware
bot.use(async (ctx, next) => {
  if (ctx.from) {
    try {
      const user = await ensureUser(prisma, ctx.from);
      
      // Allow /profile command for banned users
      if (user.isBanned && ctx.message && 'text' in ctx.message) {
        const text = ctx.message.text;
        if (text === '/profile') {
          return next();
        }
        
        // Block all other commands and interactions for banned users
        if (text.startsWith('/')) {
          await ctx.reply('🚫 You are banned from using this bot. Contact an admin for assistance.', { ...getReplyParams(ctx) });
          return;
        }
        
        // Block card collection for banned users
        if (text && !text.startsWith('/')) {
          return; // Don't process card collection for banned users
        }
      }
    } catch (error) {
      console.error('Error in ban check middleware:', error);
    }
  }
  return next();
});

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

