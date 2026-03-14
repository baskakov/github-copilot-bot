import axios, { AxiosInstance } from 'axios';
import { config } from './config';
import { CopilotModel, ConversationMessage } from './types';

const GITHUB_API_BASE = 'https://api.github.com';
const COPILOT_API_BASE = 'https://api.githubcopilot.com';
const MODELS_API_BASE = 'https://models.inference.ai.azure.com'; // fallback

const COPILOT_HEADERS = {
  'editor-version': 'vscode/1.95.0',
  'editor-plugin-version': 'copilot-chat/0.22.4',
  'User-Agent': 'GitHubCopilotChat/0.22.4',
  'Copilot-Integration-Id': 'vscode-chat',
};

interface CopilotSessionToken {
  token: string;
  expiresAt: number; // unix ms
}

interface CopilotModelsResponse {
  data: Array<{
    id: string;
    name?: string;
    vendor?: string;
    version?: string;
    capabilities?: { type?: string; family?: string };
    policy?: { state: string };
  }>;
}

interface GitHubModel {
  name: string;
  friendly_name: string;
  publisher: string;
  model_family: string;
  task: string;
  model_version?: number;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { role: string; content: string }; finish_reason: string }>;
}

export class CopilotService {
  private githubClient: AxiosInstance;
  private sessionToken: CopilotSessionToken | null = null;

  constructor() {
    this.githubClient = axios.create({
      baseURL: GITHUB_API_BASE,
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'GitHubCopilotChat/0.22.4',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  }

  /**
   * Exchange the stored GitHub token for a short-lived Copilot session token.
   * Copilot session tokens expire in ~30 minutes; cached and auto-refreshed.
   */
  private async getCopilotSessionToken(): Promise<string | null> {
    if (this.sessionToken && Date.now() < this.sessionToken.expiresAt - 60_000) {
      return this.sessionToken.token;
    }
    try {
      const res = await this.githubClient.get<{ token: string; expires_at: string }>(
        '/copilot_internal/v2/token'
      );
      const token = res.data.token;
      const expiresAt = new Date(res.data.expires_at).getTime();
      this.sessionToken = { token, expiresAt };
      return token;
    } catch {
      return null;
    }
  }

  private makeCopilotClient(sessionToken: string): AxiosInstance {
    return axios.create({
      baseURL: COPILOT_API_BASE,
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        'Content-Type': 'application/json',
        ...COPILOT_HEADERS,
      },
    });
  }

  private makeFallbackClient(): AxiosInstance {
    return axios.create({
      baseURL: MODELS_API_BASE,
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetches all available chat models.
   * Tries Copilot API first (full catalog: Claude, GPT-4.5, o1, etc.),
   * falls back to GitHub Models API (limited free-tier set).
   */
  async getAvailableModels(): Promise<CopilotModel[]> {
    const sessionToken = await this.getCopilotSessionToken();
    if (sessionToken) {
      try {
        const client = this.makeCopilotClient(sessionToken);
        const res = await client.get<CopilotModelsResponse>('/models');
        const models = res.data?.data ?? [];
        const chatModels = models.filter(
          (m) =>
            m.capabilities?.type === 'chat' ||
            (m.capabilities?.family && m.capabilities.family !== '')
        );
        if (chatModels.length > 0) {
          return chatModels.map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            vendor: m.vendor ?? 'GitHub',
            version: m.version ?? '',
            capabilities: {
              type: m.capabilities?.type ?? 'chat',
              family: m.capabilities?.family ?? '',
            },
          }));
        }
      } catch {
        // fall through to fallback
      }
    }

    // Fallback: GitHub Models API (PAT-compatible, limited set)
    const fallback = this.makeFallbackClient();
    const res = await fallback.get<GitHubModel[]>('/models');
    const models = Array.isArray(res.data) ? res.data : [];
    return models
      .filter((m) => m.task === 'chat-completion')
      .map((m) => ({
        id: m.name,
        name: m.friendly_name ?? m.name,
        vendor: m.publisher ?? 'GitHub',
        version: String(m.model_version ?? ''),
        capabilities: { type: 'chat', family: m.model_family ?? '' },
      }));
  }

  /**
   * Send a chat message. Uses Copilot API if session token is available,
   * otherwise falls back to GitHub Models API.
   */
  async chat(model: string, messages: ConversationMessage[]): Promise<string> {
    const sessionToken = await this.getCopilotSessionToken();
    const client = sessionToken
      ? this.makeCopilotClient(sessionToken)
      : this.makeFallbackClient();

    const res = await client.post<ChatCompletionResponse>('/chat/completions', {
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
      stream: false,
    });

    const content = res.data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty response from API');
    return content;
  }

  async verifyAccess(): Promise<boolean> {
    try {
      await this.githubClient.get('/user');
      return true;
    } catch {
      return false;
    }
  }
}
