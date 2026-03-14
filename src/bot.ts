import TelegramBot from 'node-telegram-bot-api';
import { config } from './config';
import { CopilotService } from './copilotService';
import { SessionManager } from './sessionManager';
import { CopilotModel } from './types';

const SYSTEM_PROMPT =
  'You are a helpful AI assistant powered by GitHub Copilot. ' +
  'Answer clearly and concisely. Use markdown formatting when helpful.';

// Telegram message length limit
const TG_MAX_LENGTH = 4096;

/**
 * Split a long message into chunks that fit in Telegram's limit.
 */
function splitMessage(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, TG_MAX_LENGTH));
    remaining = remaining.slice(TG_MAX_LENGTH);
  }
  return chunks;
}

/**
 * Build an inline keyboard with model buttons.
 * Groups models into rows of 2.
 */
function buildModelKeyboard(
  models: CopilotModel[]
): TelegramBot.InlineKeyboardMarkup {
  const rows: TelegramBot.InlineKeyboardButton[][] = [];
  for (let i = 0; i < models.length; i += 2) {
    const row: TelegramBot.InlineKeyboardButton[] = [];
    const a = models[i];
    if (a) {
      row.push({
        text: `${a.name}${a.capabilities.family ? ` (${a.capabilities.family})` : ''}`,
        callback_data: `model:${a.id}`,
      });
    }
    const b = models[i + 1];
    if (b) {
      row.push({
        text: `${b.name}${b.capabilities.family ? ` (${b.capabilities.family})` : ''}`,
        callback_data: `model:${b.id}`,
      });
    }
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

export class CopilotBot {
  private bot: TelegramBot;
  private copilot: CopilotService;
  private sessions: SessionManager;
  private modelsCache: CopilotModel[] = [];
  private modelsCachedAt = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.bot = new TelegramBot(config.telegramBotToken, { polling: true });
    this.copilot = new CopilotService();
    this.sessions = new SessionManager();
  }

  private isAllowed(userId: number): boolean {
    if (config.allowedUserIds.length === 0) return false;
    return config.allowedUserIds.includes(userId);
  }

  private async getModels(): Promise<CopilotModel[]> {
    const now = Date.now();
    if (this.modelsCache.length > 0 && now - this.modelsCachedAt < this.CACHE_TTL_MS) {
      return this.modelsCache;
    }
    this.modelsCache = await this.copilot.getAvailableModels();
    this.modelsCachedAt = now;
    return this.modelsCache;
  }

  private async sendModelSelection(chatId: number, userId: number): Promise<void> {
    this.sessions.setAwaitingModelSelection(userId, true);
    let models: CopilotModel[];
    try {
      models = await this.getModels();
    } catch (err) {
      await this.bot.sendMessage(
        chatId,
        '❌ Failed to fetch available models from GitHub Copilot. ' +
          'Please check your GITHUB_TOKEN and org Copilot access.'
      );
      return;
    }

    if (models.length === 0) {
      await this.bot.sendMessage(
        chatId,
        '⚠️ No chat models are available for the organisation. ' +
          `Make sure Copilot is enabled for *${config.githubOrg}*.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const keyboard = buildModelKeyboard(models);
    await this.bot.sendMessage(chatId, '🤖 *Select an AI model to use:*', {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  start(): void {
    console.log(`✅ Bot started. Allowed user IDs: [${config.allowedUserIds.join(', ')}]`);

    // ── /start ──────────────────────────────────────────────────────────────
    this.bot.onText(/\/start/, async (msg) => {
      const userId = msg.from?.id;
      const chatId = msg.chat.id;
      if (!userId || !this.isAllowed(userId)) {
        await this.bot.sendMessage(chatId, '🚫 Access denied.');
        return;
      }

      await this.bot.sendMessage(
        chatId,
        `👋 Welcome to the *GitHub Copilot Bot* (${config.githubOrg})!\n\n` +
          'Use /model to select an AI model, then just type your message.\n\n' +
          '*Commands:*\n' +
          '• /model — choose AI model\n' +
          '• /clear — clear conversation history\n' +
          '• /info — show current session info\n' +
          '• /help — show this message',
        { parse_mode: 'Markdown' }
      );

      await this.sendModelSelection(chatId, userId);
    });

    // ── /model ───────────────────────────────────────────────────────────────
    this.bot.onText(/\/model/, async (msg) => {
      const userId = msg.from?.id;
      const chatId = msg.chat.id;
      if (!userId || !this.isAllowed(userId)) {
        await this.bot.sendMessage(chatId, '🚫 Access denied.');
        return;
      }
      await this.sendModelSelection(chatId, userId);
    });

    // ── /clear ───────────────────────────────────────────────────────────────
    this.bot.onText(/\/clear/, async (msg) => {
      const userId = msg.from?.id;
      const chatId = msg.chat.id;
      if (!userId || !this.isAllowed(userId)) {
        await this.bot.sendMessage(chatId, '🚫 Access denied.');
        return;
      }
      this.sessions.clearHistory(userId);
      await this.bot.sendMessage(chatId, '🗑️ Conversation history cleared.');
    });

    // ── /info ────────────────────────────────────────────────────────────────
    this.bot.onText(/\/info/, async (msg) => {
      const userId = msg.from?.id;
      const chatId = msg.chat.id;
      if (!userId || !this.isAllowed(userId)) {
        await this.bot.sendMessage(chatId, '🚫 Access denied.');
        return;
      }
      const session = this.sessions.getSession(userId);
      const model = session.selectedModel ?? '_none selected_';
      const turns = Math.floor(session.history.length / 2);
      await this.bot.sendMessage(
        chatId,
        `ℹ️ *Session info*\n\n` +
          `• *Organisation:* ${config.githubOrg}\n` +
          `• *Model:* \`${model}\`\n` +
          `• *Conversation turns:* ${turns}`,
        { parse_mode: 'Markdown' }
      );
    });

    // ── /help ────────────────────────────────────────────────────────────────
    this.bot.onText(/\/help/, async (msg) => {
      const userId = msg.from?.id;
      const chatId = msg.chat.id;
      if (!userId || !this.isAllowed(userId)) {
        await this.bot.sendMessage(chatId, '🚫 Access denied.');
        return;
      }
      await this.bot.sendMessage(
        chatId,
        '*GitHub Copilot Bot — Help*\n\n' +
          '• /model — select an AI model (inline buttons)\n' +
          '• /clear — reset conversation history\n' +
          '• /info — show selected model and session info\n' +
          '• /help — show this help message\n\n' +
          'Once a model is selected, just send any message to chat with GitHub Copilot.',
        { parse_mode: 'Markdown' }
      );
    });

    // ── Callback: model selection buttons ────────────────────────────────────
    this.bot.on('callback_query', async (query) => {
      const userId = query.from.id;
      const chatId = query.message?.chat.id;
      const data = query.data;

      if (!chatId) return;
      if (!this.isAllowed(userId)) {
        await this.bot.answerCallbackQuery(query.id, { text: '🚫 Access denied.' });
        return;
      }

      if (data?.startsWith('model:')) {
        const modelId = data.slice('model:'.length);
        const models = await this.getModels().catch(() => [] as CopilotModel[]);
        const model = models.find((m) => m.id === modelId);

        this.sessions.setModel(userId, modelId);

        const displayName = model ? `${model.name}` : modelId;
        await this.bot.answerCallbackQuery(query.id, {
          text: `✅ Model set to ${displayName}`,
        });
        await this.bot.editMessageText(
          `✅ *Model selected:* \`${displayName}\`\n\nYou can now start chatting! Send /model anytime to switch.`,
          {
            chat_id: chatId,
            message_id: query.message?.message_id,
            parse_mode: 'Markdown',
          }
        );
      }
    });

    // ── Incoming user message ─────────────────────────────────────────────────
    this.bot.on('message', async (msg) => {
      // Ignore commands — they are handled above
      if (!msg.text || msg.text.startsWith('/')) return;

      const userId = msg.from?.id;
      const chatId = msg.chat.id;

      if (!userId || !this.isAllowed(userId)) {
        await this.bot.sendMessage(chatId, '🚫 Access denied.');
        return;
      }

      const session = this.sessions.getSession(userId);

      if (!session.selectedModel) {
        await this.bot.sendMessage(
          chatId,
          '⚠️ No model selected. Please use /model to choose one first.'
        );
        await this.sendModelSelection(chatId, userId);
        return;
      }

      // Show typing indicator
      await this.bot.sendChatAction(chatId, 'typing');

      // Add user message to history
      this.sessions.addMessage(userId, 'user', msg.text);

      const messagesWithSystem = [
        { role: 'system' as const, content: SYSTEM_PROMPT },
        ...session.history,
      ];

      try {
        const reply = await this.copilot.chat(session.selectedModel, messagesWithSystem);

        // Add assistant reply to history
        this.sessions.addMessage(userId, 'assistant', reply);

        // Send reply, splitting if it's too long
        const chunks = splitMessage(reply);
        for (const chunk of chunks) {
          await this.bot.sendMessage(chatId, chunk, {
            parse_mode: 'Markdown',
          });
        }
      } catch (err: unknown) {
        console.error('Copilot API error:', err);

        // Remove the failed user message so history stays consistent
        const hist = session.history;
        if (hist.at(-1)?.role === 'user') {
          hist.pop();
        }

        const errMsg =
          err instanceof Error ? err.message : 'Unknown error';
        await this.bot.sendMessage(
          chatId,
          `❌ *Error talking to Copilot:*\n\`${errMsg}\`\n\nTry /model to re-select a model or /clear to reset history.`,
          { parse_mode: 'Markdown' }
        );
      }
    });

    // ── Global error handlers ─────────────────────────────────────────────────
    this.bot.on('polling_error', (err) => {
      console.error('Polling error:', err.message);
    });

    this.bot.on('error', (err) => {
      console.error('Bot error:', err.message);
    });
  }

  async stop(): Promise<void> {
    await this.bot.stopPolling();
  }
}

