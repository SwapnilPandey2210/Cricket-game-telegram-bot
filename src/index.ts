import 'dotenv/config';
import { bot } from './telegram/bot.js';
import { execSync } from 'child_process';
import { writeFileSync, existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

const isWebhook = Boolean(process.env.WEBHOOK_DOMAIN);
const LOCK_FILE = join(process.cwd(), 'bot.lock');
const PID_FILE = join(process.cwd(), 'bot.pid');

// Process management functions
async function killExistingBots() {
  try {
    console.log('🔍 Checking for existing bot processes...');
    
    // Kill any existing node processes running bot
    const result = execSync('ps aux | grep "node.*dist/index.js" | grep -v grep | awk \'{print $2}\'', { encoding: 'utf8' });
    const pids = result.trim().split('\n').filter(pid => pid);
    
    if (pids.length > 0) {
      console.log(`🔄 Found ${pids.length} existing bot process(es), killing them...`);
      pids.forEach(pid => {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
          console.log(`✅ Killed process ${pid}`);
        } catch (e) {
          // Process might already be dead
        }
      });
      // Wait a bit for processes to die
      console.log('⏳ Waiting 3 seconds for processes to die...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('✅ No existing bot processes found');
    }
  } catch (error) {
    console.log('ℹ️ No existing processes to kill');
  }
}

function createLockFile() {
  try {
    const pid = process.pid;
    writeFileSync(PID_FILE, pid.toString());
    writeFileSync(LOCK_FILE, Date.now().toString());
    console.log(`🔒 Created lock file with PID: ${pid}`);
  } catch (error) {
    console.error('❌ Failed to create lock file:', error);
  }
}

function removeLockFile() {
  try {
    if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE);
    if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
    console.log('🔓 Removed lock files');
  } catch (error) {
    console.error('❌ Failed to remove lock file:', error);
  }
}

function checkLockFile() {
  if (existsSync(LOCK_FILE)) {
    try {
      const lockTime = parseInt(readFileSync(LOCK_FILE, { encoding: 'utf8' }));
      const now = Date.now();
      const age = now - lockTime;
      
      // If lock file is older than 5 minutes, consider it stale
      if (age > 300000) {
        console.log('⚠️ Stale lock file detected, removing...');
        removeLockFile();
        return false;
      }
      
      console.log('⚠️ Lock file exists, another instance might be running');
      return true;
    } catch (error) {
      console.log('ℹ️ Could not read lock file, proceeding...');
      return false;
    }
  }
  return false;
}

async function main() {
  try {
    // Check for existing lock file
    if (checkLockFile()) {
      console.log('⚠️ Lock file exists, removing stale lock...');
      removeLockFile();
    }
    
    // Create lock file
    createLockFile();
    
    if (isWebhook) {
      const domain = process.env.WEBHOOK_DOMAIN!;
      const port = Number(process.env.PORT ?? 3000);
      await bot.launch({
        webhook: { domain, port },
      });
      // eslint-disable-next-line no-console
      console.log(`Bot running in webhook mode on port ${port}`);
    } else {
      // Comprehensive startup with robust error handling
      let startupAttempts = 0;
      const maxAttempts = 3; // Reduced attempts for faster recovery
      
      while (startupAttempts < maxAttempts) {
        try {
          startupAttempts++;
          console.log(`🚀 Bot startup attempt ${startupAttempts}/${maxAttempts}`);
          
          // Clear webhook with error handling
          try {
            await bot.telegram.deleteWebhook();
            console.log('✅ Webhook cleared successfully');
          } catch (webhookError: any) {
            console.log('ℹ️ Webhook clear failed (non-critical):', webhookError.message);
          }
          
          // Clear pending updates with error handling
          try {
            await bot.telegram.getUpdates(-1, 0, 0, []);
            console.log('✅ Pending updates cleared successfully');
          } catch (updateError: any) {
            console.log('ℹ️ Update clear failed (non-critical):', updateError.message);
          }
          
          // Additional wait before launch
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Launch the bot
          await bot.launch();
          console.log('✅ Bot started successfully in long-polling mode');
          break;
          
        } catch (error: any) {
          console.error(`❌ Startup attempt ${startupAttempts} failed:`, error.message);
          
          if (error.response?.error_code === 409) {
            console.log('🔄 Session conflict detected, waiting and retrying...');
            const waitTime = Math.min(20000 * startupAttempts, 60000); // Longer waits, max 60s
            console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          
          // For non-409 errors, wait a bit and retry
          if (startupAttempts < maxAttempts) {
            const waitTime = 10000 * startupAttempts;
            console.log(`⏳ Retrying in ${waitTime/1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }
          
          // If we've exhausted all attempts, throw the error
          throw new Error(`Failed to start bot after ${maxAttempts} attempts. Last error: ${error.message}`);
        }
      }
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('❌ Failed to start bot:', error);
    removeLockFile();
    process.exit(1);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

// Graceful shutdown handling
async function gracefulShutdown(signal: string) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  try {
    await bot.stop(signal);
    removeLockFile();
    console.log('✅ Bot stopped successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during shutdown:', error);
    removeLockFile();
    process.exit(1);
  }
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});
