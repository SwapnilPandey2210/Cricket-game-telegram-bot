/*
  Warnings:

  - You are about to drop the column `rating` on the `Card` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Card" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "country" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "bio" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Card" ("bio", "country", "createdAt", "id", "imageUrl", "name", "rarity", "role", "slug") SELECT "bio", "country", "createdAt", "id", "imageUrl", "name", "rarity", "role", "slug" FROM "Card";
DROP TABLE "Card";
ALTER TABLE "new_Card" RENAME TO "Card";
CREATE UNIQUE INDEX "Card_slug_key" ON "Card"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
