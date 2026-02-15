
export enum GeminiModel {
  FLASH_2_5 = 'gemini-2.5-flash-preview', 
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
  images?: string[]; // Base64 strings of attached images
  timestamp: number;
}

export interface ChatSession {
  id: string;
  name: string;
  createdAt: number;
}
