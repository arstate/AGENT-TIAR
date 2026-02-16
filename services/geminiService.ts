
import { GoogleGenAI } from "@google/genai";
import { GeminiModel } from "../types";

// Helper to convert File to Base64
export const fileToGenerativePart = async (file: File): Promise<{ inlineData: { data: string; mimeType: string } }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (!result) {
        reject(new Error("Failed to read file"));
        return;
      }
      const base64String = result.split(',')[1];
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
      
      if (!apiKey || !apiKey.trim()) continue;

      try {
        // If we are on a retry (i > 0), notify the UI about the rotation
        if (i > 0) {
          window.dispatchEvent(new CustomEvent('api-key-rotate', { 
            detail: { index: indexToCheck + 1 } 
          }));
        }

        const ai = new GoogleGenAI({ apiKey });
        const result = await operation(ai);
        
        // If successful, update the sticky index to this working key
        this.currentKeyIndex = indexToCheck;
        return result;
      } catch (error: any) {
        console.warn(`Attempt failed with API Key index ${indexToCheck}:`, error.message);
        lastError = error;
        // Continue to the next iteration (next key)
      }
    }

    // If we exit the loop, all keys failed
    console.error("All API keys failed.", lastError);
    throw lastError || new Error("All API keys failed.");
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
        
        You have access to a Knowledge Base provided below. 
        It contains textual facts and a list of AVAILABLE IMAGES with IDs.

        --- KNOWLEDGE BASE START ---
        ${knowledgeContext}
        --- KNOWLEDGE BASE END ---
        
        *** CRITICAL INSTRUCTION FOR SENDING IMAGES ***
        When a user asks to see a photo (e.g., "show me the kitchen", "minta foto kamar mandi", "brosur mana"):
        1. SEARCH the 'AVAILABLE IMAGES' list in the Knowledge Base.
        2. MATCH the user's specific request to the 'Filename' or 'Description'.
           - If user asks for "Bathroom", look for files named "bathroom.jpg" or descriptions mentioning "shower", "toilet", "kamar mandi".
           - If user asks for "Promo", look for "promo.jpg" or "flyer".
        3. IF A MATCH IS FOUND: Output the tag [[SEND_IMAGE: <image_id>]].
        4. IF NO EXACT MATCH IS FOUND: Do NOT send a random image. Just explain you don't have that specific photo.
        5. You can send multiple images if relevant (e.g. [[SEND_IMAGE: id1]] [[SEND_IMAGE: id2]]).
        
        Stay in character. Answer concisely and helpful, like a professional admin on WhatsApp.
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

      // Pass message as an object with 'message' property
      const result = await chat.sendMessage({ message: currentParts });
      return result.text || "";
    });
  }
}
