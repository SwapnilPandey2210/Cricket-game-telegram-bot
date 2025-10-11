import { PrismaClient } from "@prisma/client";

export async function listForSale(prisma: PrismaClient, userId: number, cardId: number, quantity: number, price: number) {
  if (quantity <= 0 || price <= 0) throw new Error('Quantity and price must be positive.');
  const own = await prisma.ownership.findUnique({ where: { userId_cardId: { userId, cardId } } });
  if (!own || own.quantity < quantity) throw new Error('Not enough quantity to list.');
  // Check for duplicate listing at same price
  const existing = await prisma.listing.findFirst({ where: { sellerId: userId, cardId, price, active: true } });
  if (existing) throw new Error('You already have an active listing for this card at this price.');
  return prisma.$transaction(async (tx) => {
    // Check if this will remove all cards (quantity becomes 0)
    if (own.quantity === quantity) {
      // Delete the ownership record if all cards are being listed
      await tx.ownership.delete({ where: { id: own.id } });
    } else {
      // Decrement quantity if there are remaining cards
      await tx.ownership.update({ where: { id: own.id }, data: { quantity: { decrement: quantity } } });
    }
    const listing = await tx.listing.create({ data: { sellerId: userId, cardId, quantity, price, active: true } });
    return listing;
  });
}

export async function browseMarket(prisma: PrismaClient, limit = 20) {
  return prisma.listing.findMany({ where: { active: true }, include: { card: true, seller: true }, take: limit, orderBy: { createdAt: 'desc' } });
}

export async function buyFromMarket(prisma: PrismaClient, buyerId: number, listingId: number, quantity: number) {
  if (quantity <= 0) throw new Error('Quantity must be positive.');
  return prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId }, include: { card: true } });
    if (!listing || !listing.active) throw new Error('Listing not available.');
    if (listing.quantity < quantity) throw new Error('Not enough quantity in listing.');
    if (listing.sellerId === buyerId) throw new Error('Seller cannot buy their own listing.');
    const total = listing.price * quantity;
    const buyer = await tx.user.findUniqueOrThrow({ where: { id: buyerId } });
    if (buyer.coins < total) throw new Error('Insufficient coins.');
    await tx.user.update({ where: { id: buyerId }, data: { coins: { decrement: total } } });
    await tx.user.update({ where: { id: listing.sellerId }, data: { coins: { increment: total } } });
    await tx.listing.update({ where: { id: listing.id }, data: { quantity: listing.quantity - quantity, active: listing.quantity - quantity > 0 } });
    const existing = await tx.ownership.findUnique({ where: { userId_cardId: { userId: buyerId, cardId: listing.cardId } } });
    if (existing) {
      await tx.ownership.update({ where: { id: existing.id }, data: { quantity: { increment: quantity } } });
    } else {
      await tx.ownership.create({ data: { userId: buyerId, cardId: listing.cardId, quantity } });
    }
    
    // Increment buyer's total cards collected
    await tx.user.update({ where: { id: buyerId }, data: { totalCardsCollected: { increment: quantity } } });
    return { ok: true, spent: total, listingId: listing.id } as const;
  });
}

export async function cancelListing(prisma: PrismaClient, userId: number, listingId: number) {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.listing.findUnique({ where: { id: listingId } });
    if (!listing || listing.sellerId !== userId) throw new Error('Listing not found or not yours.');
    if (!listing.active) return { ok: false, message: 'Already inactive.' } as const;
    await tx.listing.update({ where: { id: listing.id }, data: { active: false } });
    const existing = await tx.ownership.findUnique({ where: { userId_cardId: { userId, cardId: listing.cardId } } });
    if (existing) {
      await tx.ownership.update({ where: { id: existing.id }, data: { quantity: { increment: listing.quantity } } });
    } else {
      await tx.ownership.create({ data: { userId, cardId: listing.cardId, quantity: listing.quantity } });
    }
    return { ok: true } as const;
  });
}
