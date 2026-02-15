import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { ref, onValue, get, child, push, set, remove, serverTimestamp } from 'firebase/database';
import { GeminiService, fileToGenerativePart } from '../services/geminiService';
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
  const [chatFiles, setChatFiles] = useState<File[]>([]); // New state for images
  const [isTyping, setIsTyping] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');

  // UI State
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  }, [messages, isTyping, chatFiles]);


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

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
          const newFiles = Array.from(e.target.files!);
          setChatFiles(prev => [...prev, ...newFiles]);
      }
      // Reset input so same file can be selected again if needed
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
      }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      // Handle image paste
      if (e.clipboardData.files.length > 0) {
          const filesArray = Array.from(e.clipboardData.files).filter(file => file.type.startsWith('image/'));
          if (filesArray.length > 0) {
              e.preventDefault(); // Prevent pasting the binary name text
              setChatFiles(prev => [...prev, ...filesArray]);
          }
      }
  };

  const handleRemoveFile = (index: number) => {
      setChatFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    if ((!input.trim() && chatFiles.length === 0) || !selectedAgentId) return;

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
    const filesToSend = [...chatFiles];
    setInput('');
    setChatFiles([]);
    setIsTyping(true);

    // Process images for Firebase storage (Base64)
    let base64Images: string[] | undefined = undefined;
    if (filesToSend.length > 0) {
        const imagePromises = filesToSend.map(async (file) => {
            const part = await fileToGenerativePart(file);
            return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        });
        base64Images = await Promise.all(imagePromises);
    }

    // 1. Save User Message to DB
    await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
        role: 'user',
        text: userMsgText,
        images: base64Images || null,
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

    // 4. Prepare History (Include previous images in context)
    const historyForAi = messages.map(m => {
        const parts: any[] = [{ text: m.text }];
        if (m.images) {
            m.images.forEach(img => {
                const match = img.match(/^data:(.*?);base64,(.*)$/);
                if (match) {
                     parts.push({
                         inlineData: {
                             mimeType: match[1],
                             data: match[2]
                         }
                     });
                }
            });
        }
        return { role: m.role, parts };
    });
    
    // Add current user message (without duplication in history array, passed as 'newMessage' to service)
    // Note: The service handles adding the current message to the conversation call.

    const gemini = new GeminiService(apiKeys);

    try {
        const responseText = await gemini.chatWithAgent(
            model,
            currentAgent.role + (currentAgent.personality ? ` Personality: ${currentAgent.personality}` : ''),
            contextString,
            historyForAi,
            userMsgText,
            filesToSend
        );

        // 5. Save Model Response to DB
        await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
            role: 'model',
            text: responseText,
            timestamp: serverTimestamp()
        });

    } catch (error) {
        console.error(error);
        await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
            role: 'model',
            text: "Error: Failed to connect to AI Agent.",
            timestamp: serverTimestamp()
        });
    } finally {
        setIsTyping(false);
    }
  };

  // Helper to remove strange Markdown symbols for cleaner display
  const formatMessageText = (text: string) => {
    if (!text) return '';
    return text
      // Replace list bullets (* or -) with a clean dot
      .replace(/^\s*[\*\-]\s+/gm, '• ')
      // Remove bold markers (**)
      .replace(/\*\*/g, '')
      // Remove italic markers (__)
      .replace(/__/g, '')
      // Remove header hashes (#)
      .replace(/^\s*#+\s*/gm, '')
      // Remove code backticks (`)
      .replace(/`/g, '');
  };

  // Function to handle copying text
  const handleCopy = (text: string, id: string) => {
    const cleanText = formatMessageText(text);
    navigator.clipboard.writeText(cleanText).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    });
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
      <div className="md:w-1/4 w-full bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col shadow-xl">
        <div className="p-4 bg-slate-700/50 border-b border-slate-700 flex items-center justify-between">
            <h3 className="font-bold text-white flex items-center gap-2">
                 <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                 </svg>
                 Agents
            </h3>
        </div>
        
        {/* Agent List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {agents.length === 0 && <div className="p-4 text-sm text-slate-500 text-center">No agents found.</div>}
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
                                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider flex items-center">
                                    <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                                    </svg>
                                    History
                                </span>
                                <button 
                                    onClick={() => setIsCreatingSession(!isCreatingSession)}
                                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center"
                                >
                                    <svg className="w-3 h-3 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                    </svg>
                                    New
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
                                    <button onClick={handleCreateSession} className="text-green-400 text-xs">
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </button>
                                </div>
                            )}

                            {sessions.map(session => (
                                <button
                                    key={session.id}
                                    onClick={() => setSelectedSessionId(session.id)}
                                    className={`w-full text-left text-xs p-2 rounded truncate flex items-center ${selectedSessionId === session.id ? 'bg-blue-500/10 text-blue-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
                                >
                                    <svg className="w-3 h-3 mr-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                                    </svg>
                                    {session.name}
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
                                <div className="flex items-center">
                                    <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse mr-1"></div>
                                    <p className="text-xs text-green-100 opacity-80">online</p>
                                </div>
                                {selectedSessionId && (
                                    <span className="text-xs bg-black/20 px-2 rounded-full text-white/90">
                                        {sessions.find(s => s.id === selectedSessionId)?.name}
                                    </span>
                                )}
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="text-white flex items-center">
                         <svg className="w-5 h-5 mr-2 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                         </svg>
                        Select an agent from the list
                    </div>
                )}
             </div>

             {/* Delete Chat Button */}
             {selectedSessionId && (
                 <button 
                    onClick={handleDeleteSession}
                    title="Delete Chat History"
                    className="text-white/70 hover:text-red-300 transition-colors p-2 rounded-full hover:bg-black/10"
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
                    <div className="bg-[#1f2c34] text-[#8696a0] text-sm px-4 py-2 rounded-lg shadow text-center border border-slate-800">
                        <div className="flex justify-center mb-2">
                             <svg className="w-6 h-6 text-[#00a884]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                        </div>
                        Encrypted end-to-end. Agent ready to chat.<br/>
                        <span className="text-xs opacity-70">
                            {knowledge.length > 0 ? `${knowledge.length} knowledge items loaded.` : 'No specific training data.'}
                        </span>
                    </div>
                </div>
            )}
            
            {messages.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-4 py-2 shadow-sm text-sm whitespace-pre-wrap group relative ${
                        msg.role === 'user' 
                        ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' 
                        : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'
                    }`}>
                        {/* Display Images if any */}
                        {msg.images && msg.images.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-2">
                                {msg.images.map((img, idx) => (
                                    <img 
                                        key={idx} 
                                        src={img} 
                                        alt="attachment" 
                                        className="max-w-full h-auto rounded-lg max-h-60 border border-black/20"
                                    />
                                ))}
                            </div>
                        )}

                        {formatMessageText(msg.text)}
                        
                        <div className="text-[10px] text-right opacity-50 mt-1 flex justify-end items-center gap-2">
                            {/* Copy Button for Model messages */}
                            {msg.role === 'model' && (
                                <button 
                                    onClick={() => handleCopy(msg.text, msg.id || i.toString())}
                                    className="hover:text-white transition-colors p-1 rounded"
                                    title="Copy text"
                                >
                                    {copiedId === (msg.id || i.toString()) ? (
                                        <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    ) : (
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                    )}
                                </button>
                            )}

                            <span>
                                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                            </span>
                            
                            {msg.role === 'user' && (
                                <svg className="w-3 h-3 text-blue-300" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                                    <path d="M21 7l-1.41-1.41L9 16.17 4.83 12l-1.42 1.41L9 19 21 7z" /> 
                                    {/* Double Check trick: normally specific path, using single for visual sim */}
                                    <path d="M21.7 7.3l-1.4-1.4-8.8 8.8-2.6-2.6-1.4 1.4 4 4 10.2-10.2z" transform="translate(-5,0)"/>
                                </svg>
                            )}
                        </div>
                    </div>
                </div>
            ))}
            
            {isTyping && (
                <div className="flex justify-start">
                     <div className="bg-[#202c33] text-[#e9edef] rounded-lg px-4 py-2 rounded-tl-none text-sm italic opacity-70 flex items-center gap-1">
                         <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
                         <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-100"></span>
                         <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-200"></span>
                     </div>
                </div>
            )}
            <div ref={bottomRef} />
        </div>

        {/* Input Area */}
        <div className="p-3 bg-[#202c33] flex flex-col gap-2 relative">
            
            {/* Image Previews (Gemini Style) */}
            {chatFiles.length > 0 && (
                <div className="flex gap-3 px-2 pb-2 overflow-x-auto">
                    {chatFiles.map((file, idx) => (
                        <div key={idx} className="relative group flex-shrink-0 animate-fade-in-up">
                            <div className="w-16 h-16 rounded-xl overflow-hidden border border-slate-600 bg-slate-800 shadow-lg relative">
                                <img 
                                    src={URL.createObjectURL(file)} 
                                    alt="preview" 
                                    className="w-full h-full object-cover"
                                />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors"></div>
                            </div>
                            <button
                                onClick={() => handleRemoveFile(idx)}
                                className="absolute -top-2 -right-2 bg-slate-700 text-slate-300 rounded-full p-1 border border-slate-600 shadow-md hover:bg-red-500 hover:text-white transition-all transform hover:scale-110 z-10"
                                title="Remove image"
                            >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-end space-x-2 bg-[#2a3942] rounded-2xl p-2 border border-slate-700/50 focus-within:border-slate-500 transition-colors">
                {/* File Attachment Button */}
                <input 
                    type="file" 
                    multiple 
                    accept="image/*" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileSelect}
                />
                <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="text-[#8696a0] p-2 hover:bg-[#374248] rounded-full transition-colors mb-0.5"
                    title="Attach Image"
                >
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                        <path transform="rotate(-45, 12, 12)" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
                    </svg>
                </button>

                <input 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    placeholder={activeAgent ? "Type a message (Paste images Ctrl+V supported)" : "Select an agent first"}
                    disabled={!activeAgent || isTyping}
                    className="flex-1 bg-transparent text-white px-2 py-3 outline-none placeholder-[#8696a0] min-h-[44px] max-h-32"
                    autoComplete="off"
                />
                
                <button 
                    onClick={handleSend}
                    disabled={(!input.trim() && chatFiles.length === 0) || !activeAgent || isTyping}
                    className={`p-2 rounded-full transition-all mb-0.5 ${input.trim() || chatFiles.length > 0 ? 'text-[#00a884] bg-[#00a884]/10 hover:bg-[#00a884]/20' : 'text-[#8696a0]'}`}
                >
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;