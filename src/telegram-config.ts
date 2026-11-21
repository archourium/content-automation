type TelegramConnection = { token: string; chat: string };

export function readTelegramConnection(environment: NodeJS.ProcessEnv): TelegramConnection | undefined {
  if (environment.TELEGRAM_CONNECTION) {
    let connection: TelegramConnection | undefined;
    try {
      connection = JSON.parse(environment.TELEGRAM_CONNECTION);
    } catch {
      throw new Error('Invalid Telegram connection. Run Telegram setup again.');
    }
    if (typeof connection?.token !== 'string' || !/^\d+:[A-Za-z0-9_-]+$/.test(connection.token) ||
        typeof connection.chat !== 'string' || !/^\d+$/.test(connection.chat)) {
      throw new Error('Invalid Telegram connection. Run Telegram setup again.');
    }
    return { token: connection.token, chat: connection.chat };
  }

  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chat } = environment;
  return token && chat ? { token, chat } : undefined;
}
