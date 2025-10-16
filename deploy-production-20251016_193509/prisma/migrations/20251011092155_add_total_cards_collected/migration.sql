-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "coins" INTEGER NOT NULL DEFAULT 100,
    "lastDailyAt" DATETIME,
    "lastPackAt" DATETIME,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "totalCardsCollected" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_User" ("coins", "createdAt", "firstName", "id", "isAdmin", "lastDailyAt", "lastPackAt", "telegramId", "updatedAt", "username") SELECT "coins", "createdAt", "firstName", "id", "isAdmin", "lastDailyAt", "lastPackAt", "telegramId", "updatedAt", "username" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
