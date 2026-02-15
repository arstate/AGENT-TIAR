import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { ref, onValue, get, child, push, set, remove, serverTimestamp } from 'firebase/database';
import { GeminiService } from '../services/geminiService';
import { Agent, GeminiModel, KnowledgeItem, AppSettings, ChatMessage, ChatSession } from '../types';

const Chat: React.FC = () => {
  // Data State
  const [agents, setAgents] = useState<Agent[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  
  // Selection State
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  
  // Chat State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);

  // 1. Load Agents on Mount
  useEffect(() => {
    const agentsUnsub = onValue(ref(db, 'agents'), (snap) => {
        const data = snap.val();
        if (data) {
            const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
            setAgents(list);
            // Default select first agent if none selected
            if (list.length > 0 && !selectedAgentId) {
                setSelectedAgentId(list[0].id);
            }
        }
    });

    return () => { agentsUnsub(); };
  }, [selectedAgentId]);

  // 2. Load Knowledge AND Sessions when Agent Selected
  useEffect(() => {
    if (!selectedAgentId) {
        setKnowledge([]);
        setSessions([]);
        return;
    }

    // Load Knowledge specific to this agent
    const knowledgeUnsub = onValue(ref(db, `knowledge/${selectedAgentId}`), (snap) => {
        const data = snap.val();
        if (data) {
             const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
             setKnowledge(list);
        } else {
            setKnowledge([]);
        }
    });

    // Load Sessions
    const sessionsRef = ref(db, `chats/${selectedAgentId}`);
    const sessionsUnsub = onValue(sessionsRef, (snap) => {
        const data = snap.val();
        if (data) {
            const list: ChatSession[] = Object.keys(data).map(k => ({
                id: k,
                name: data[k].name || 'General Chat',
                createdAt: data[k].createdAt || Date.now()
            })).sort((a,b) => b.createdAt - a.createdAt); // Newest first
            
            setSessions(list);
            
            // If no session selected, select the first one, or reset if list is empty
            if (list.length > 0 && !selectedSessionId) {
                setSelectedSessionId(list[0].id);
            } else if (list.length === 0) {
                setSelectedSessionId(null);
            }
        } else {
            setSessions([]);
            setSelectedSessionId(null);
        }
    });

    return () => { knowledgeUnsub(); sessionsUnsub(); };
  }, [selectedAgentId]);

  // 3. Load Messages when Session Selected
  useEffect(() => {
    if (!selectedAgentId || !selectedSessionId) {
        setMessages([]);
        return;
    }

    const messagesRef = ref(db, `chats/${selectedAgentId}/${selectedSessionId}/messages`);
    const unsub = onValue(messagesRef, (snap) => {
        const data = snap.val();
        if (data) {
            const list: ChatMessage[] = Object.keys(data).map(k => ({
                id: k,
                ...data[k]
            })).sort((a,b) => a.timestamp - b.timestamp); // Oldest first for chat history
            setMessages(list);
        } else {
            setMessages([]);
        }
    });

    return () => unsub();
  }, [selectedAgentId, selectedSessionId]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);


  // Actions
  const handleCreateSession = async () => {
      if (!selectedAgentId || !newSessionName.trim()) return;
      const newRef = push(ref(db, `chats/${selectedAgentId}`));
      await set(newRef, {
          name: newSessionName,
          createdAt: serverTimestamp()
      });
      setSelectedSessionId(newRef.key);
      setNewSessionName('');
      setIsCreatingSession(false);
  };

  const handleDeleteSession = async () => {
      if (!selectedAgentId || !selectedSessionId) return;
      if (confirm("Are you sure you want to delete this entire chat history?")) {
          await remove(ref(db, `chats/${selectedAgentId}/${selectedSessionId}`));
          setSelectedSessionId(null);
      }
  };

  const handleSend = async () => {
    if (!input.trim() || !selectedAgentId) return;

    // Use current session or create a default one if none exists
    let currentSessionId = selectedSessionId;
    if (!currentSessionId) {
        const newRef = push(ref(db, `chats/${selectedAgentId}`));
        await set(newRef, {
            name: "New Chat",
            createdAt: serverTimestamp()
        });
        currentSessionId = newRef.key;
        setSelectedSessionId(currentSessionId);
    }

    if (!currentSessionId) return; // Should not happen

    const userMsgText = input;
    setInput('');
    setIsTyping(true);

    // 1. Save User Message to DB
    await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
        role: 'user',
        text: userMsgText,
        timestamp: serverTimestamp()
    });

    // 2. Fetch Settings
    let settings: AppSettings | null = null;
    try {
        const snapshot = await get(child(ref(db), 'settings'));
        if (snapshot.exists()) {
            settings = snapshot.val();
        }
    } catch (e) {
        console.error("Error fetching settings:", e);
    }

    if (!settings || !settings.apiKeys || settings.apiKeys.length === 0) {
        await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
            role: 'model',
            text: "Error: Please configure API Keys in Settings first.",
            timestamp: serverTimestamp()
        });
        setIsTyping(false);
        return;
    }
    
    const apiKeys = settings.apiKeys;
    const model = settings.selectedModel || GeminiModel.FLASH_3;

    const currentAgent = agents.find(a => a.id === selectedAgentId);
    if (!currentAgent) return;

    // 3. Prepare Context
    // Only use knowledge associated with this agent
    const contextString = knowledge.length > 0 
        ? knowledge.map(k => k.contentSummary).join('\n\n') 
        : "No specific knowledge base trained for this agent yet.";

    // 4. Prepare History
    const historyForAi = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }]
    }));
    
    historyForAi.push({
        role: 'user',
        parts: [{ text: userMsgText }]
    });

    const gemini = new GeminiService(apiKeys);

    try {
        const responseText = await gemini.chatWithAgent(
            model,
            currentAgent.role + (currentAgent.personality ? ` Personality: ${currentAgent.personality}` : ''),
            contextString,
            historyForAi.slice(0, -1),
            userMsgText
        );

        // 5. Save Model Response to DB
        await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
            role: 'model',
            text: responseText,
            timestamp: serverTimestamp()
        });

    } catch (error) {
        await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
            role: 'model',
            text: "Error: Failed to connect to AI Agent.",
            timestamp: serverTimestamp()
        });
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
      
      {/* Sidebar: Agents & Sessions */}
      <div className="md:w-1/4 w-full bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col">
        <div className="p-4 bg-slate-700/50 border-b border-slate-700">
            <h3 className="font-bold text-white">Agents</h3>
        </div>
        
        {/* Agent List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {agents.map(agent => (
                <div key={agent.id} className="space-y-1">
                    {/* Agent Button */}
                    <button
                        onClick={() => setSelectedAgentId(agent.id)}
                        className={`w-full flex items-center p-3 rounded-lg transition-colors ${selectedAgentId === agent.id ? 'bg-blue-600/20 border border-blue-500' : 'hover:bg-slate-700 border border-transparent'}`}
                    >
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm mr-3 ${agent.avatar || 'bg-gray-500'}`}>
                            {agent.name[0]}
                        </div>
                        <div className="text-left overflow-hidden flex-1">
                            <div className="font-semibold text-white truncate">{agent.name}</div>
                            <div className="text-xs text-slate-400 truncate">{agent.role}</div>
                        </div>
                    </button>

                    {/* Sessions List (Only if agent selected) */}
                    {selectedAgentId === agent.id && (
                        <div className="ml-6 border-l-2 border-slate-600 pl-2 space-y-1 my-2">
                            <div className="flex justify-between items-center px-2">
                                <span className="text-xs text-slate-400 font-bold uppercase">Rooms</span>
                                <button 
                                    onClick={() => setIsCreatingSession(!isCreatingSession)}
                                    className="text-xs text-blue-400 hover:text-blue-300"
                                >
                                    + New
                                </button>
                            </div>
                            
                            {isCreatingSession && (
                                <div className="flex gap-1 p-1">
                                    <input 
                                        autoFocus
                                        className="bg-slate-900 text-xs text-white p-1 rounded w-full border border-slate-600"
                                        placeholder="Room Name..."
                                        value={newSessionName}
                                        onChange={e => setNewSessionName(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleCreateSession()}
                                    />
                                    <button onClick={handleCreateSession} className="text-green-400 text-xs">✓</button>
                                </div>
                            )}

                            {sessions.map(session => (
                                <button
                                    key={session.id}
                                    onClick={() => setSelectedSessionId(session.id)}
                                    className={`w-full text-left text-xs p-2 rounded truncate ${selectedSessionId === session.id ? 'bg-blue-500/10 text-blue-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
                                >
                                    # {session.name}
                                </button>
                            ))}
                            {sessions.length === 0 && (
                                <div className="text-xs text-slate-600 italic px-2">No history yet</div>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden relative shadow-2xl">
        {/* Header */}
        <div className="p-4 bg-[#075E54] flex items-center justify-between shadow-md z-10">
             <div className="flex items-center space-x-3">
                {activeAgent ? (
                    <>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${activeAgent.avatar || 'bg-gray-500'}`}>
                            {activeAgent.name[0]}
                        </div>
                        <div>
                            <h3 className="font-bold text-white">{activeAgent.name}</h3>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-green-100 opacity-80">online</p>
                                {selectedSessionId && (
                                    <span className="text-xs bg-black/20 px-2 rounded-full text-white/90">
                                        {sessions.find(s => s.id === selectedSessionId)?.name}
                                    </span>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-white">Select an agent</div>
                )}
             </div>

             {/* Delete Chat Button */}
             {selectedSessionId && (
                 <button 
                    onClick={handleDeleteSession}
                    title="Delete Chat History"
                    className="text-white/70 hover:text-red-300 transition-colors p-2"
                 >
                     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                     </svg>
                 </button>
             )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0b141a]" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", backgroundBlendMode: 'soft-light' }}>
            {messages.length === 0 && (
                <div className="flex justify-center mt-10">
                    <div className="bg-[#1f2c34] text-[#8696a0] text-sm px-4 py-2 rounded-lg shadow text-center">
                        Encrypted end-to-end. Agent ready to chat.<br/>
                        <span className="text-xs opacity-70">
                            {knowledge.length > 0 ? `${knowledge.length} knowledge items loaded.` : 'No specific training data.'}
                        </span>
                    </div>
                </div>
            )}
            
            {messages.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-4 py-2 shadow-sm text-sm whitespace-pre-wrap ${
                        msg.role === 'user' 
                        ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' 
                        : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'
                    }`}>
                        {msg.text}
                        <div className="text-[10px] text-right opacity-50 mt-1 flex justify-end items-center gap-1">
                            {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
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