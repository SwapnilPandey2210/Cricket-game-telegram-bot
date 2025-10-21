// Test script to verify search functionality
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testSearch() {
  try {
    console.log('🔍 Testing search functionality...');
    
    // Test search for "rohit"
    const rohitResults = await prisma.card.findMany({
      where: {
        name: {
          contains: 'rohit'
        }
      },
      take: 5
    });
    
    console.log(`Found ${rohitResults.length} cards with "rohit":`);
    rohitResults.forEach(card => {
      console.log(`- ${card.name} (ID: ${card.id})`);
    });
    
    // Test search for "virat"
    const viratResults = await prisma.card.findMany({
      where: {
        name: {
          contains: 'virat'
        }
      },
      take: 5
    });
    
    console.log(`\nFound ${viratResults.length} cards with "virat":`);
    viratResults.forEach(card => {
      console.log(`- ${card.name} (ID: ${card.id})`);
    });
    
    // Test search for "dhoni"
    const dhoniResults = await prisma.card.findMany({
      where: {
        name: {
          contains: 'dhoni'
        }
      },
      take: 5
    });
    
    console.log(`\nFound ${dhoniResults.length} cards with "dhoni":`);
    dhoniResults.forEach(card => {
      console.log(`- ${card.name} (ID: ${card.id})`);
    });
    
    console.log('\n✅ Search functionality test completed!');
    
  } catch (error) {
    console.error('❌ Error testing search:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testSearch();
