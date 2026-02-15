export enum GeminiModel {
  // Mapping '2.5' option to a valid recent Flash model (2.0 Flash Exp or 1.5 Flash Latest)
  // 'gemini-2.5-flash-latest' is not a standard public endpoint yet, causing 404.
  // Using 'gemini-2.0-flash-exp' as a robust alternative for "Next Gen Flash" 
  // or 'gemini-flash-latest' for stable.
  FLASH_2_5 = 'gemini-2.0-flash-exp', 
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
  agentId?: string; // Reference to which agent owns this knowledge
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
  id?: string;
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  name: string;
  createdAt: number;
}