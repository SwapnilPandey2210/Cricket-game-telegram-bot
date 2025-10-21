#!/bin/bash

# Clear all bot sessions and conflicts
BOT_DIR="/home/ubuntu/deploy-production-20251016_193509"

echo "🧹 Clearing all bot sessions and conflicts..."

# Kill all bot processes
echo "1. Killing all bot processes..."
pkill -9 -f "node dist/index.js" 2>/dev/null
pkill -9 -f "robust-bot-manager" 2>/dev/null
pkill -9 -f "bot-manager" 2>/dev/null
sleep 3

# Clear webhook
echo "2. Clearing webhook..."
cd "$BOT_DIR" || exit 1
BOT_TOKEN=$(grep BOT_TOKEN .env | cut -d= -f2)
if [ -n "$BOT_TOKEN" ]; then
    curl -s "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook" > /dev/null
    echo "   Webhook cleared"
fi

# Clear pending updates
echo "3. Clearing pending updates..."
if [ -n "$BOT_TOKEN" ]; then
    curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1" > /dev/null
    echo "   Pending updates cleared"
fi

# Remove lock files
echo "4. Removing lock files..."
rm -f "$BOT_DIR/bot.pid"
rm -f "$BOT_DIR/bot.lock"
rm -f "$BOT_DIR/manager.pid"

# Wait for any remaining processes to die
echo "5. Waiting for processes to die..."
sleep 5

# Verify no bot processes are running
REMAINING=$(pgrep -f "node dist/index.js" | wc -l)
if [ "$REMAINING" -eq 0 ]; then
    echo "✅ All bot sessions cleared successfully!"
else
    echo "⚠️  Warning: $REMAINING bot processes still running"
    pgrep -f "node dist/index.js"
fi

echo "🚀 Ready to start bot with clean session"
