
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
  isPublic?: boolean; // New: Determines if agent is accessible via public link
}

export interface KnowledgeItem {
  id: string;
  agentId?: string; // Reference to which agent owns this knowledge
  type: 'text' | 'image' | 'pdf' | 'file' | 'composite';
  originalName?: string;
  contentSummary: string; // The "learned" data
  rawContent?: string; // For text inputs
  imageData?: string; // Base64 string of the stored image (Single)
  images?: string[]; // New: Base64 strings for multiple images (Combined)
  timestamp: number;
}

export interface AppSettings {
  apiKeys: string[];
  selectedModel: GeminiModel;
  compressionQuality?: number; // 0.1 to 1.0
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

export interface TrainingQueueItem {
  id: string;
  agentId: string;
  agentName: string;
  files: File[];
  textInput: string;
  saveImages: boolean; // Whether to save files to DB
  storageMode: 'separate' | 'combined';
  compressionQuality: number; // Specific quality for this batch
  status: 'pending' | 'processing' | 'completed' | 'error';
  errorMsg?: string;
  timestamp: number;
}
