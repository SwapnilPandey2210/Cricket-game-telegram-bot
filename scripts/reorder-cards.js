import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function reorderCardIds() {
  try {
    console.log('🔄 Starting card ID reordering...');
    
    const existingCards = await prisma.card.findMany({
      orderBy: { id: 'asc' }
    });
    
    console.log(`📊 Found ${existingCards.length} cards`);
    
    if (existingCards.length === 0) {
      console.log('✅ No cards to reorder');
      return;
    }
    
    // Check if there are gaps
    const hasGaps = existingCards.some((card, index) => card.id !== index + 1);
    
    if (!hasGaps) {
      console.log('✅ No gaps found, cards are already sequential');
      return;
    }
    
    console.log('🔍 Gaps detected, reordering...');
    
    // Create a mapping of old IDs to new sequential IDs
    const idMapping = new Map();
    existingCards.forEach((card, index) => {
      idMapping.set(card.id, index + 1);
    });
    
    console.log('📝 ID mapping:', Array.from(idMapping.entries()));
    
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
    
    console.log('✅ Card IDs reordered successfully!');
    
    // Verify the reordering
    const reorderedCards = await prisma.card.findMany({
      orderBy: { id: 'asc' }
    });
    
    console.log('🔍 Verification:');
    reorderedCards.forEach((card, index) => {
      console.log(`  ${index + 1}. ID: ${card.id}, Name: ${card.name}`);
    });
    
  } catch (error) {
    console.error('❌ Error reordering cards:', error);
  } finally {
    await prisma.$disconnect();
  }
}

reorderCardIds();
