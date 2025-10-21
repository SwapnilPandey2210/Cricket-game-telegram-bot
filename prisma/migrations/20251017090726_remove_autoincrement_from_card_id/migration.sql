-- Remove autoincrement from Card.id column
-- SQLite doesn't support modifying column constraints directly, so we need to recreate the table

-- Create a new Card table without autoincrement
CREATE TABLE "Card_new" (
    "id" INTEGER NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "country" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "bio" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Copy data from old table to new table
INSERT INTO "Card_new" SELECT * FROM "Card";

-- Drop the old table
DROP TABLE "Card";

-- Rename the new table to the original name
ALTER TABLE "Card_new" RENAME TO "Card";