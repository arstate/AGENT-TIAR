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

  private getClient(): GoogleGenAI {
    if (this.apiKeys.length === 0) {
      throw new Error("No API Keys configured.");
    }
    // Simple rotation: try next key if needed, or random
    const key = this.apiKeys[this.currentKeyIndex % this.apiKeys.length];
    // In a real app, we would process.env.API_KEY, but here we use user provided keys
    return new GoogleGenAI({ apiKey: key });
  }

  private rotateKey() {
    this.currentKeyIndex++;
  }

  async analyzeContent(
    modelName: GeminiModel,
    prompt: string,
    files?: File[]
  ): Promise<string> {
    try {
      const ai = this.getClient();
      
      const parts: any[] = [{ text: prompt }];

      if (files && files.length > 0) {
        for (const file of files) {
          const part = await fileToGenerativePart(file);
          parts.push(part);
        }
      }

      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
      });

      return response.text || "No analysis generated.";
    } catch (error) {
      console.error("Gemini API Error:", error);
      // If error suggests quota limit, rotate and retry could be implemented here
      this.rotateKey(); 
      throw error;
    }
  }

  async chatWithAgent(
    modelName: GeminiModel,
    agentRole: string,
    knowledgeContext: string,
    history: { role: string; parts: { text: string }[] }[],
    newMessage: string
  ): Promise<string> {
    try {
      const ai = this.getClient();
      
      const systemInstruction = `
        You are an AI Agent with the following role: ${agentRole}.
        
        Use the following learned knowledge to answer user queries if relevant:
        ---
        ${knowledgeContext}
        ---
        
        If the knowledge doesn't apply, use your general knowledge but stay in character.
        Answer concisely and helpful, like a WhatsApp reply.
      `;

      // We use generateContent for single turn with history context constructed manually 
      // or use the chat API. Let's use Chat API for better history management.
      const chat = ai.chats.create({
        model: modelName,
        config: {
          systemInstruction: systemInstruction,
        },
        history: history
      });

      const result = await chat.sendMessage({ message: newMessage });
      return result.text || "";

    } catch (error) {
      console.error("Chat Error:", error);
      this.rotateKey();
      throw error;
    }
  }
}