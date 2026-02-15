import { GoogleGenAI } from "@google/genai";
import { GeminiModel } from "../types";

// Helper to convert File to Base64
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve({
        inlineData: {
          data: base64String,
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export class GeminiService {
  private apiKeys: string[];
  private currentKeyIndex: number = 0;

  constructor(apiKeys: string[]) {
    this.apiKeys = apiKeys;
  }

  // Wrapper to execute API calls with retry logic across all available keys
  private async executeWithRetry<T>(operation: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
    if (!this.apiKeys || this.apiKeys.length === 0) {
      throw new Error("No API Keys configured. Please add them in Settings.");
    }

    let lastError: any;
    
    // Iterate through all keys starting from the current index
    for (let i = 0; i < this.apiKeys.length; i++) {
      const indexToCheck = (this.currentKeyIndex + i) % this.apiKeys.length;
      const apiKey = this.apiKeys[indexToCheck];
      
      try {
        const ai = new GoogleGenAI({ apiKey });
        const result = await operation(ai);
        
        // If successful, update the sticky index to this working key
        this.currentKeyIndex = indexToCheck;
        return result;
      } catch (error: any) {
        console.warn(`Attempt failed with API Key ending in ...${apiKey.slice(-4)}:`, error.message);
        lastError = error;
        // Continue to the next iteration (next key)
      }
    }

    // If we exit the loop, all keys failed
    console.error("All API keys failed.");
    throw lastError;
  }

  async analyzeContent(
    modelName: GeminiModel,
    prompt: string,
    files?: File[]
  ): Promise<string> {
    // Prepare content parts outside the retry loop to avoid reprocessing
    const parts: any[] = [{ text: prompt }];

    if (files && files.length > 0) {
      for (const file of files) {
        const part = await fileToGenerativePart(file);
        parts.push(part);
      }
    }

    return this.executeWithRetry(async (ai) => {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
      });

      return response.text || "No analysis generated.";
    });
  }

  async chatWithAgent(
    modelName: GeminiModel,
    agentRole: string,
    knowledgeContext: string,
    history: { role: string; parts: any[] }[],
    newMessage: string,
    files?: File[]
  ): Promise<string> {
    
    const systemInstruction = `
        You are an AI Agent with the following role: ${agentRole}.
        
        Use the following learned knowledge to answer user queries if relevant:
        ---
        ${knowledgeContext}
        ---
        
        If the knowledge doesn't apply, use your general knowledge but stay in character.
        Answer concisely and helpful, like a WhatsApp reply.
      `;

    // Prepare current message parts (text + images)
    const currentParts: any[] = [{ text: newMessage }];
    
    if (files && files.length > 0) {
        for (const file of files) {
            const part = await fileToGenerativePart(file);
            currentParts.push(part);
        }
    }

    return this.executeWithRetry(async (ai) => {
      const chat = ai.chats.create({
        model: modelName,
        config: {
          systemInstruction: systemInstruction,
        },
        history: history
      });

      const result = await chat.sendMessage(currentParts);
      return result.text || "";
    });
  }
}