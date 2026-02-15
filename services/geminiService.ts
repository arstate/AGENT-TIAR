
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
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
  // Constructor simplified as API key must be obtained exclusively from environment variable.
  constructor() {}

  // Added robust error handling and retry logic as recommended for API stability.
  private async executeWithRetry<T>(operation: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      throw new Error("API Key is missing from the environment configuration.");
    }

    let lastError: any;
    const maxRetries = 3;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Guidelines: Create a new instance right before making an API call.
        const ai = new GoogleGenAI({ apiKey });
        return await operation(ai);
      } catch (error: any) {
        console.warn(`Attempt ${i + 1} failed:`, error.message);
        lastError = error;
        // Exponential backoff
        if (i < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
        }
      }
    }
    throw lastError || new Error("Gemini API request failed after retries.");
  }

  async analyzeContent(
    modelName: GeminiModel,
    prompt: string,
    files?: File[]
  ): Promise<string> {
    const parts: any[] = [{ text: prompt }];
    if (files && files.length > 0) {
      for (const file of files) {
        const part = await fileToGenerativePart(file);
        parts.push(part);
      }
    }

    return this.executeWithRetry(async (ai) => {
      // Guidelines: Use ai.models.generateContent with both model name and prompt parts.
      const response = await ai.models.generateContent({
        model: modelName,
        contents: { parts },
      });
      // Guidelines: Use .text property directly.
      return response.text || "No analysis generated.";
    });
  }

  async *chatWithAgentStream(
    modelName: GeminiModel,
    agentRole: string,
    knowledgeContext: string,
    history: { role: string; parts: any[] }[],
    newMessage: string,
    files?: File[]
  ) {
    const systemInstruction = `
        You are an AI Agent with the following role: ${agentRole}.
        
        Use the following learned knowledge to answer user queries if relevant:
        ---
        ${knowledgeContext}
        ---
        
        If the knowledge doesn't apply, use your general knowledge but stay in character.
        Answer concisely and helpful, like a WhatsApp reply.
      `;

    const currentParts: any[] = [{ text: newMessage }];
    if (files && files.length > 0) {
        for (const file of files) {
            const part = await fileToGenerativePart(file);
            currentParts.push(part);
        }
    }

    const stream = await this.executeWithRetry(async (ai) => {
      // Guidelines: System instruction passed via config in chats.create.
      const chat = ai.chats.create({
        model: modelName,
        config: { systemInstruction: systemInstruction },
        history: history
      });
      // Guidelines: chat.sendMessageStream must use named parameter 'message'.
      return await chat.sendMessageStream({ message: currentParts });
    });

    for await (const chunk of stream) {
      const c = chunk as GenerateContentResponse;
      // Guidelines: Access the .text property of GenerateContentResponse.
      yield c.text || "";
    }
  }

  async chatWithAgent(
    modelName: GeminiModel,
    agentRole: string,
    knowledgeContext: string,
    history: { role: string; parts: any[] }[],
    newMessage: string,
    files?: File[]
  ): Promise<string> {
    let fullText = "";
    const stream = this.chatWithAgentStream(modelName, agentRole, knowledgeContext, history, newMessage, files);
    for await (const chunk of stream) {
      fullText += chunk;
    }
    return fullText;
  }
}