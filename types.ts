export enum GeminiModel {
  FLASH_2_5 = 'gemini-2.5-flash-latest',
  PRO_3 = 'gemini-3-pro-preview',
  FLASH_3 = 'gemini-3-flash-preview',
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  personality: string;
  avatar: string;
}

export interface KnowledgeItem {
  id: string;
  type: 'text' | 'image' | 'pdf' | 'file';
  originalName?: string;
  contentSummary: string; // The "learned" data
  rawContent?: string; // For text inputs
  timestamp: number;
}

export interface AppSettings {
  apiKeys: string[];
  selectedModel: GeminiModel;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
  agentId?: string;
}