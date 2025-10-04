import 'dotenv/config';
import { bot } from './telegram/bot.js';
const isWebhook = Boolean(process.env.WEBHOOK_DOMAIN);
async function main() {
    if (isWebhook) {
        const domain = process.env.WEBHOOK_DOMAIN;
        const port = Number(process.env.PORT ?? 3000);
        await bot.launch({
            webhook: { domain, port },
        });
        // eslint-disable-next-line no-console
        console.log(`Bot running in webhook mode on port ${port}`);
    }
    else {
        await bot.launch();
        // eslint-disable-next-line no-console
        console.log('Bot started in long-polling mode');
    }
}
main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
});
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
//# sourceMappingURL=index.js.map