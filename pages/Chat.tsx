import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { ref, onValue } from 'firebase/database';
import { GeminiService } from '../services/geminiService';
import { Agent, GeminiModel, KnowledgeItem } from '../types';

const Chat: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  
  const [messages, setMessages] = useState<{role: 'user'|'model', text: string}[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Load Agents & Knowledge
  useEffect(() => {
    const agentsUnsub = onValue(ref(db, 'agents'), (snap) => {
        const data = snap.val();
        if (data) {
            const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
            setAgents(list);
            if (list.length > 0 && !selectedAgentId) setSelectedAgentId(list[0].id);
        }
    });

    const knowledgeUnsub = onValue(ref(db, 'knowledge'), (snap) => {
        const data = snap.val();
        if (data) {
             const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
             setKnowledge(list);
        }
    });

    return () => { agentsUnsub(); knowledgeUnsub(); };
  }, [selectedAgentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim() || !selectedAgentId) return;

    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setIsTyping(true);

    const settingsStr = localStorage.getItem('agenAiSettings');
    if (!settingsStr) {
        setMessages(prev => [...prev, { role: 'model', text: "Error: Please configure settings first." }]);
        setIsTyping(false);
        return;
    }
    const settings = JSON.parse(settingsStr);
    const apiKeys = settings.apiKeys || [];
    const model = settings.selectedModel || GeminiModel.FLASH_3;

    if (apiKeys.length === 0) {
        setMessages(prev => [...prev, { role: 'model', text: "Error: No API Keys found." }]);
        setIsTyping(false);
        return;
    }

    const currentAgent = agents.find(a => a.id === selectedAgentId);
    if (!currentAgent) return;

    // Construct context from knowledge base
    const contextString = knowledge.map(k => k.contentSummary).join('\n\n');

    // Construct history for Gemini API
    // Gemini chat history format: { role: 'user' | 'model', parts: [{ text: string }] }
    const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
    }));

    const gemini = new GeminiService(apiKeys);

    try {
        const responseText = await gemini.chatWithAgent(
            model,
            currentAgent.role + (currentAgent.personality ? ` Personality: ${currentAgent.personality}` : ''),
            contextString,
            history,
            userMsg
        );

        setMessages(prev => [...prev, { role: 'model', text: responseText }]);
    } catch (error) {
        setMessages(prev => [...prev, { role: 'model', text: "Error: Failed to get response from AI." }]);
        console.error(error);
    } finally {
        setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if(e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSend();
      }
  }

  const activeAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col md:flex-row gap-6">
      
      {/* Agent Selector Sidebar (Mobile friendly) */}
      <div className="md:w-1/4 w-full bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col">
        <div className="p-4 bg-slate-700/50 border-b border-slate-700">
            <h3 className="font-bold text-white">Select Agent</h3>
        </div>
        <div className="overflow-y-auto flex-1 p-2 space-y-2">
            {agents.length === 0 && <div className="p-4 text-sm text-slate-500 text-center">No agents. Go to Agents page to create one.</div>}
            {agents.map(agent => (
                <button
                    key={agent.id}
                    onClick={() => { setSelectedAgentId(agent.id); setMessages([]); }}
                    className={`w-full flex items-center p-3 rounded-lg transition-colors ${selectedAgentId === agent.id ? 'bg-blue-600/20 border border-blue-500' : 'hover:bg-slate-700 border border-transparent'}`}
                >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm mr-3 ${agent.avatar || 'bg-gray-500'}`}>
                        {agent.name[0]}
                    </div>
                    <div className="text-left overflow-hidden">
                        <div className="font-semibold text-white truncate">{agent.name}</div>
                        <div className="text-xs text-slate-400 truncate">{agent.role}</div>
                    </div>
                </button>
            ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden relative shadow-2xl">
        {/* Header */}
        <div className="p-4 bg-[#075E54] flex items-center space-x-3 shadow-md z-10">
             {activeAgent ? (
                 <>
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${activeAgent.avatar || 'bg-gray-500'}`}>
                        {activeAgent.name[0]}
                    </div>
                    <div>
                        <h3 className="font-bold text-white">{activeAgent.name}</h3>
                        <p className="text-xs text-green-100 opacity-80">online</p>
                    </div>
                 </>
             ) : (
                 <div className="text-white">Select an agent to start chat</div>
             )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0b141a]" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", backgroundBlendMode: 'soft-light' }}>
            {messages.length === 0 && (
                <div className="flex justify-center mt-10">
                    <div className="bg-[#1f2c34] text-[#8696a0] text-sm px-4 py-2 rounded-lg shadow text-center">
                        Encrypted end-to-end. Agent ready to chat.
                    </div>
                </div>
            )}
            
            {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-4 py-2 shadow-sm text-sm whitespace-pre-wrap ${
                        msg.role === 'user' 
                        ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' 
                        : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'
                    }`}>
                        {msg.text}
                        <div className="text-[10px] text-right opacity-50 mt-1 flex justify-end items-center gap-1">
                            {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                            {msg.role === 'user' && <span>✓✓</span>}
                        </div>
                    </div>
                </div>
            ))}
            
            {isTyping && (
                <div className="flex justify-start">
                     <div className="bg-[#202c33] text-[#e9edef] rounded-lg px-4 py-2 rounded-tl-none text-sm italic opacity-70">
                         Typing...
                     </div>
                </div>
            )}
            <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 bg-[#202c33] flex items-center space-x-2">
            <button className="text-[#8696a0] p-2 hover:bg-[#374248] rounded-full">
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0a12 12 0 1012 12A12.013 12.013 0 0012 0zm0 22a10 10 0 1110-10 10.011 10.011 0 01-10 10zm5-10a1 1 0 11-1 1 1.001 1.001 0 011-1zM7 12a1 1 0 111 1 1 1 0 01-1-1zm5 0a1 1 0 111 1 1 1 0 01-1-1z" /></svg>
            </button>
            <input 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={activeAgent ? "Type a message" : "Select an agent first"}
                disabled={!activeAgent || isTyping}
                className="flex-1 bg-[#2a3942] text-white rounded-lg px-4 py-2 outline-none focus:bg-[#2a3942] placeholder-[#8696a0]"
            />
            <button 
                onClick={handleSend}
                disabled={!input.trim() || !activeAgent || isTyping}
                className={`p-2 rounded-full ${input.trim() ? 'text-[#00a884]' : 'text-[#8696a0]'}`}
            >
                <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
            </button>
        </div>
      </div>
    </div>
  );
};

export default Chat;