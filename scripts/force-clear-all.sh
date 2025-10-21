#!/bin/bash

# Force clear all bot sessions and conflicts
BOT_DIR="/home/ubuntu/deploy-production-20251016_193509"

echo "🔥 FORCE CLEARING ALL BOT SESSIONS..."

# Kill ALL node processes
echo "1. Killing ALL node processes..."
sudo pkill -9 -f "node" 2>/dev/null
sleep 5

# Clear webhook multiple times
echo "2. Force clearing webhook..."
cd "$BOT_DIR" || exit 1
BOT_TOKEN=$(grep BOT_TOKEN .env | cut -d= -f2)
if [ -n "$BOT_TOKEN" ]; then
    for i in {1..5}; do
        curl -s "https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook" > /dev/null
        echo "   Webhook clear attempt $i"
        sleep 2
    done
fi

# Clear pending updates multiple times
echo "3. Force clearing pending updates..."
if [ -n "$BOT_TOKEN" ]; then
    for i in {1..5}; do
        curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getUpdates?offset=-1" > /dev/null
        echo "   Update clear attempt $i"
        sleep 2
    done
fi

# Remove ALL lock files
echo "4. Removing ALL lock files..."
rm -f "$BOT_DIR/bot.pid"
rm -f "$BOT_DIR/bot.lock"
rm -f "$BOT_DIR/manager.pid"
rm -f /tmp/bot-*
rm -f /var/run/bot-*

# Wait longer
echo "5. Waiting for complete cleanup..."
sleep 10

# Check webhook status
echo "6. Checking webhook status..."
if [ -n "$BOT_TOKEN" ]; then
    curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | jq .
fi

# Verify no processes
echo "7. Verifying no bot processes..."
REMAINING=$(pgrep -f "node" | wc -l)
if [ "$REMAINING" -eq 0 ]; then
    echo "✅ ALL SESSIONS FORCE CLEARED!"
else
    echo "⚠️  Warning: $REMAINING node processes still running"
    pgrep -f "node"
fi

echo "🚀 Ready for fresh start"
