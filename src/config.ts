import dotenv from 'dotenv';

dotenv.config();

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  telegramBotToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  githubToken: requireEnv('GITHUB_TOKEN'),
  githubOrg: process.env['GITHUB_ORG'] ?? 'Bask-Agency',
  allowedUserIds: (process.env['ALLOWED_USER_IDS'] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .map(Number),
};

