import { UserSession } from './types';

export class SessionManager {
  private sessions = new Map<number, UserSession>();

  getSession(userId: number): UserSession {
    if (!this.sessions.has(userId)) {
      this.sessions.set(userId, {
        selectedModel: null,
        history: [],
        awaitingModelSelection: false,
      });
    }
    // Non-null assertion is safe here because we just set it above
    return this.sessions.get(userId)!;
  }

  setModel(userId: number, modelId: string): void {
    const session = this.getSession(userId);
    session.selectedModel = modelId;
    session.awaitingModelSelection = false;
    session.history = []; // Reset history when switching models
  }

  addMessage(
    userId: number,
    role: 'user' | 'assistant' | 'system',
    content: string
  ): void {
    const session = this.getSession(userId);
    session.history.push({ role, content });

    // Keep history at a reasonable size (last 40 messages = 20 turns)
    if (session.history.length > 40) {
      session.history = session.history.slice(-40);
    }
  }

  clearHistory(userId: number): void {
    const session = this.getSession(userId);
    session.history = [];
  }

  setAwaitingModelSelection(userId: number, value: boolean): void {
    const session = this.getSession(userId);
    session.awaitingModelSelection = value;
  }

  deleteSession(userId: number): void {
    this.sessions.delete(userId);
  }
}

