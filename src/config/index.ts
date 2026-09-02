export interface GatewayConfig {
  port: number;
  host: string;
  redisUrl: string;
  openaiApiBase: string;
  anthropicApiBase: string;
  sqliteDbPath: string;
  jsonlDir: string;
  skillsDir: string;
  personalityDir: string;
  dataDir: string;
  imAdapter: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuChatId: string;
  feishuVerificationToken: string;
  feishuEncryptKey: string;
  logLevel: string;
}

function env(key: string, fallback: string): string {
  const val = process.env[key];
  return val ?? fallback;
}

export function loadConfig(): GatewayConfig {
  return {
    port: parseInt(env('GATEWAY_PORT', '9800'), 10),
    host: env('GATEWAY_HOST', '127.0.0.1'),
    redisUrl: env('REDIS_URL', 'redis://127.0.0.1:6379'),
    openaiApiBase: env('OPENAI_API_BASE', 'https://api.openai.com'),
    anthropicApiBase: env('ANTHROPIC_API_BASE', 'https://api.anthropic.com'),
    sqliteDbPath: env('SQLITE_DB_PATH', './data/memory.db'),
    jsonlDir: env('JSONL_DIR', './data/messages'),
    skillsDir: env('SKILLS_DIR', './data/skills'),
    personalityDir: env('PERSONALITY_DIR', './data/personality'),
    dataDir: env('DATA_DIR', './data'),
    imAdapter: env('IM_ADAPTER', 'mock'),
    feishuAppId: env('FEISHU_APP_ID', ''),
    feishuAppSecret: env('FEISHU_APP_SECRET', ''),
    feishuChatId: env('FEISHU_CHAT_ID', ''),
    feishuVerificationToken: env('FEISHU_VERIFICATION_TOKEN', ''),
    feishuEncryptKey: env('FEISHU_ENCRYPT_KEY', ''),
    logLevel: env('LOG_LEVEL', 'info'),
  };
}
