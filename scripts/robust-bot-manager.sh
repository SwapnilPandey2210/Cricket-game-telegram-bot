#!/bin/bash

# Robust Cricket Heritage Bot Manager
# This script ensures the bot runs continuously with proper session management

BOT_DIR="/home/ubuntu/deploy-production-20251016_193509"
BOT_LOG="$BOT_DIR/bot.log"
PID_FILE="$BOT_DIR/bot.pid"
LOCK_FILE="$BOT_DIR/bot.lock"
MAX_RESTARTS=10
RESTART_COUNT=0

# Function to log messages
log_message() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$BOT_DIR/manager.log"
}

# Function to acquire lock
acquire_lock() {
    if [ -f "$LOCK_FILE" ]; then
        local lock_pid=$(cat "$LOCK_FILE")
        if kill -0 "$lock_pid" 2>/dev/null; then
            log_message "Another bot manager is already running (PID: $lock_pid)"
            exit 1
        else
            rm -f "$LOCK_FILE"
        fi
    fi
    echo $$ > "$LOCK_FILE"
}

# Function to release lock
release_lock() {
    rm -f "$LOCK_FILE"
}

# Function to kill all bot processes aggressively
kill_all_bot_processes() {
    log_message "Aggressively stopping all bot processes..."
    
    # Kill by PID file if it exists
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log_message "Killing bot process $pid"
            kill -TERM "$pid" 2>/dev/null
            sleep 3
            if kill -0 "$pid" 2>/dev/null; then
                log_message "Force killing bot process $pid"
                kill -KILL "$pid" 2>/dev/null
            fi
        fi
        rm -f "$PID_FILE"
    fi
    
    # Kill any remaining node processes running the bot
    pkill -f "node dist/index.js" 2>/dev/null
    sleep 2
    
    # Double check and force kill if needed
    local remaining=$(pgrep -f "node dist/index.js" | wc -l)
    if [ "$remaining" -gt 0 ]; then
        log_message "Force killing remaining bot processes"
        pkill -9 -f "node dist/index.js" 2>/dev/null
        sleep 2
    fi
    
    # Clear any potential webhook conflicts
    log_message "Clearing potential webhook conflicts..."
    
    log_message "All bot processes stopped"
}

# Function to start the bot
start_bot() {
    log_message "Starting bot..."
    
    cd "$BOT_DIR" || {
        log_message "ERROR: Cannot change to bot directory $BOT_DIR"
        return 1
    }
    
    # Clear any old log files
    > "$BOT_LOG"
    
    # Start the bot in background
    nohup node dist/index.js > "$BOT_LOG" 2>&1 &
    local bot_pid=$!
    
    # Save PID
    echo "$bot_pid" > "$PID_FILE"
    
    # Wait a moment and check if it started successfully
    sleep 10
    
    if kill -0 "$bot_pid" 2>/dev/null; then
        log_message "Bot started successfully with PID $bot_pid"
        return 0
    else
        log_message "ERROR: Bot failed to start"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Function to check if bot is running
is_bot_running() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            return 0
        else
            rm -f "$PID_FILE"
        fi
    fi
    return 1
}

# Function to monitor bot health
monitor_bot() {
    while true; do
        if ! is_bot_running; then
            log_message "Bot is not running, attempting restart..."
            
            if [ "$RESTART_COUNT" -ge "$MAX_RESTARTS" ]; then
                log_message "ERROR: Maximum restart attempts ($MAX_RESTARTS) reached. Stopping."
                release_lock
                exit 1
            fi
            
            RESTART_COUNT=$((RESTART_COUNT + 1))
            log_message "Restart attempt $RESTART_COUNT/$MAX_RESTARTS"
            
            kill_all_bot_processes
            sleep 10
            
            if start_bot; then
                RESTART_COUNT=0  # Reset counter on successful start
                log_message "Bot restarted successfully"
            else
                log_message "Failed to restart bot"
                sleep 15
            fi
        else
            # Bot is running, check for error patterns in logs
            if [ -f "$BOT_LOG" ]; then
                if grep -q "409.*Conflict.*terminated by other getUpdates" "$BOT_LOG" 2>/dev/null; then
                    log_message "Detected 409 conflict error, restarting bot..."
                    kill_all_bot_processes
                    sleep 10
                    start_bot
                fi
            fi
        fi
        
        sleep 30  # Check every 30 seconds
    done
}

# Cleanup function
cleanup() {
    log_message "Shutting down bot manager..."
    kill_all_bot_processes
    release_lock
    exit 0
}

# Set up signal handlers
trap cleanup SIGINT SIGTERM

# Main execution
case "$1" in
    start)
        acquire_lock
        log_message "Starting robust bot manager..."
        kill_all_bot_processes
        sleep 5
        if start_bot; then
            log_message "Robust bot manager started successfully"
            monitor_bot &
            echo $! > "$BOT_DIR/manager.pid"
        else
            log_message "Failed to start bot"
            release_lock
            exit 1
        fi
        ;;
    stop)
        log_message "Stopping robust bot manager..."
        if [ -f "$BOT_DIR/manager.pid" ]; then
            local manager_pid=$(cat "$BOT_DIR/manager.pid")
            kill "$manager_pid" 2>/dev/null
            rm -f "$BOT_DIR/manager.pid"
        fi
        kill_all_bot_processes
        release_lock
        log_message "Robust bot manager stopped"
        ;;
    restart)
        log_message "Restarting robust bot manager..."
        $0 stop
        sleep 3
        $0 start
        ;;
    status)
        if is_bot_running; then
            local pid=$(cat "$PID_FILE")
            log_message "Bot is running with PID $pid"
            exit 0
        else
            log_message "Bot is not running"
            exit 1
        fi
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
