import { CopilotBot } from './bot';

async function main() {
  console.log('🚀 Starting GitHub Copilot Telegram Bot...');

  const bot = new CopilotBot();
  bot.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n⚠️  Received ${signal}, shutting down...`);
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});

