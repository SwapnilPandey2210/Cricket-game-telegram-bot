cd ~/deploy-production-20251016_193509
pkill -f 'node dist/index.js'
sleep 2
nohup node dist/index.js > bot.log 2>&1 &
echo "Bot restarted. PID: $(pgrep -f 'node dist/index.js')"
