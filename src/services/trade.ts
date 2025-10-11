import { PrismaClient } from "@prisma/client";

export const createTrade = async (prisma: PrismaClient, fromUserId: number, toUserId: number, offeredCardId: number, requestedCardId: number) => {
  if (fromUserId === toUserId) throw new Error('Cannot trade with yourself.');
  const hasOffered = await prisma.ownership.findUnique({ where: { userId_cardId: { userId: fromUserId, cardId: offeredCardId } } });
  const hasRequested = await prisma.ownership.findUnique({ where: { userId_cardId: { userId: toUserId, cardId: requestedCardId } } });
  if (!hasOffered || hasOffered.quantity <= 0) throw new Error('You do not own the offered card.');
  if (!hasRequested || hasRequested.quantity <= 0) throw new Error('Target user does not own the requested card.');
  return prisma.trade.create({ data: { fromUserId, toUserId, offeredCardId, requestedCardId, status: 'PENDING' } });
}

export const acceptTrade = async (prisma: PrismaClient, tradeId: number, actingUserId: number) => {
  return prisma.$transaction(async (tx) => {
    const trade = await tx.trade.findUnique({ where: { id: tradeId } });
    if (!trade || trade.status !== 'PENDING') throw new Error('Trade not available.');
    if (trade.toUserId !== actingUserId) throw new Error('Only recipient can accept.');
    const fromOwn = await tx.ownership.findUnique({ where: { userId_cardId: { userId: trade.fromUserId, cardId: trade.offeredCardId } } });
    const toOwn = await tx.ownership.findUnique({ where: { userId_cardId: { userId: trade.toUserId, cardId: trade.requestedCardId } } });
    if (!fromOwn || fromOwn.quantity <= 0) throw new Error('Sender no longer owns offered card.');
    if (!toOwn || toOwn.quantity <= 0) throw new Error('Recipient no longer owns requested card.');
    // Handle fromOwn quantity - delete if becomes 0, otherwise decrement
    if (fromOwn.quantity === 1) {
      await tx.ownership.delete({ where: { id: fromOwn.id } });
    } else {
      await tx.ownership.update({ where: { id: fromOwn.id }, data: { quantity: { decrement: 1 } } });
    }
    
    // Handle toOwn quantity - delete if becomes 0, otherwise decrement
    if (toOwn.quantity === 1) {
      await tx.ownership.delete({ where: { id: toOwn.id } });
    } else {
      await tx.ownership.update({ where: { id: toOwn.id }, data: { quantity: { decrement: 1 } } });
    }
    const toHasOffered = await tx.ownership.findUnique({ where: { userId_cardId: { userId: trade.toUserId, cardId: trade.offeredCardId } } });
    if (toHasOffered) {
      await tx.ownership.update({ where: { id: toHasOffered.id }, data: { quantity: { increment: 1 } } });
    } else {
      await tx.ownership.create({ data: { userId: trade.toUserId, cardId: trade.offeredCardId, quantity: 1 } });
    }
    const fromHasRequested = await tx.ownership.findUnique({ where: { userId_cardId: { userId: trade.fromUserId, cardId: trade.requestedCardId } } });
    if (fromHasRequested) {
      await tx.ownership.update({ where: { id: fromHasRequested.id }, data: { quantity: { increment: 1 } } });
    } else {
      await tx.ownership.create({ data: { userId: trade.fromUserId, cardId: trade.requestedCardId, quantity: 1 } });
    }
    
    // Increment total cards collected for both users
    await tx.user.update({ where: { id: trade.toUserId }, data: { totalCardsCollected: { increment: 1 } } });
    await tx.user.update({ where: { id: trade.fromUserId }, data: { totalCardsCollected: { increment: 1 } } });
    await tx.trade.update({ where: { id: trade.id }, data: { status: 'ACCEPTED' } });
    return { ok: true } as const;
  });
}

export const rejectTrade = async (prisma: PrismaClient, tradeId: number, actingUserId: number) => {
  const trade = await prisma.trade.findUnique({ where: { id: tradeId } });
  if (!trade || trade.status !== 'PENDING') throw new Error('Trade not available.');
  if (trade.toUserId !== actingUserId) throw new Error('Only recipient can reject.');
  await prisma.trade.update({ where: { id: trade.id }, data: { status: 'REJECTED' } });
  return { ok: true } as const;
}

export const myTrades = async (prisma: PrismaClient, userId: number) => {
  return prisma.trade.findMany({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] }, orderBy: { createdAt: 'desc' } });
}
