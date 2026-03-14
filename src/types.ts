// Types shared across the bot

export interface CopilotModel {
  id: string;
  name: string;
  vendor: string;
  version: string;
  capabilities: {
    type: string;
    family: string;
  };
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface UserSession {
  selectedModel: string | null;
  history: ConversationMessage[];
  awaitingModelSelection: boolean;
}

