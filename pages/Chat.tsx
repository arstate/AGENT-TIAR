
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { ref, onValue, get, child, push, set, remove, serverTimestamp } from 'firebase/database';
import { GeminiService, fileToGenerativePart } from '../services/geminiService';
import { Agent, GeminiModel, KnowledgeItem, AppSettings, ChatMessage, ChatSession } from '../types';

// --- HELPER: Image Compression ---
const compressImage = async (file: File): Promise<File> => {
    if (!file.type.startsWith('image/')) return file;
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(file); return; }
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((blob) => {
                URL.revokeObjectURL(url);
                if (blob) {
                    const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                        type: 'image/webp',
                        lastModified: Date.now(),
                    });
                    resolve(compressedFile);
                } else { resolve(file); }
            }, 'image/webp', 0.90); 
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
        img.src = url;
    });
};

// Fixed TypeScript error: Added React.FC type to handle the standard 'key' prop correctly.
const BlobImage: React.FC<{ base64Src: string, onPreview: (url: string) => void }> = ({ base64Src, onPreview }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    useEffect(() => {
        let isMounted = true;
        fetch(base64Src).then(res => res.blob()).then(blob => {
            if(isMounted) setBlobUrl(URL.createObjectURL(blob));
        }).catch(() => { if(isMounted) setBlobUrl(base64Src); });
        return () => {
            isMounted = false;
            if (blobUrl && blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);
        };
    }, [base64Src]);
    if (!blobUrl) return <div className="w-40 h-40 bg-slate-700 animate-pulse rounded-lg" />;
    return (
        <div onClick={() => onPreview(blobUrl)} className="block relative group cursor-zoom-in">
            <img src={blobUrl} alt="attachment" className="max-w-full h-auto rounded-lg max-h-60 border border-black/20" loading="lazy" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100">
                <span className="bg-black/50 text-white text-xs px-2 py-1 rounded">View</span>
            </div>
        </div>
    );
};

const Chat: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [chatFiles, setChatFiles] = useState<File[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [compressionStatus, setCompressionStatus] = useState('');
  const [streamingText, setStreamingText] = useState<string | null>(null);

  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const agentsUnsub = onValue(ref(db, 'agents'), (snap) => {
        const data = snap.val();
        if (data) {
            const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
            setAgents(list);
            if (list.length > 0 && !selectedAgentId) setSelectedAgentId(list[0].id);
        }
    });
    return () => agentsUnsub();
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) { setKnowledge([]); setSessions([]); return; }
    const knowledgeUnsub = onValue(ref(db, `knowledge/${selectedAgentId}`), (snap) => {
        const data = snap.val();
        setKnowledge(data ? Object.keys(data).map(k => ({ id: k, ...data[k] })) : []);
    });
    const sessionsUnsub = onValue(ref(db, `chats/${selectedAgentId}`), (snap) => {
        const data = snap.val();
        if (data) {
            const list: ChatSession[] = Object.keys(data).map(k => ({
                id: k, name: data[k].name || 'General Chat', createdAt: data[k].createdAt || Date.now()
            })).sort((a,b) => b.createdAt - a.createdAt);
            setSessions(list);
            if (list.length > 0 && !selectedSessionId) setSelectedSessionId(list[0].id);
            else if (list.length === 0) setSelectedSessionId(null);
        } else { setSessions([]); setSelectedSessionId(null); }
    });
    return () => { knowledgeUnsub(); sessionsUnsub(); };
  }, [selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId || !selectedSessionId) { setMessages([]); return; }
    const unsub = onValue(ref(db, `chats/${selectedAgentId}/${selectedSessionId}/messages`), (snap) => {
        const data = snap.val();
        setMessages(data ? Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a,b) => a.timestamp - b.timestamp) : []);
    });
    return () => unsub();
  }, [selectedAgentId, selectedSessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping, chatFiles, compressionStatus, streamingText]);

  const handleCreateSession = async () => {
      if (!selectedAgentId || !newSessionName.trim()) return;
      const newRef = push(ref(db, `chats/${selectedAgentId}`));
      await set(newRef, { name: newSessionName, createdAt: serverTimestamp() });
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
      if (e.target.files) setChatFiles(prev => [...prev, ...Array.from(e.target.files!)]);
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Fixed reference error: Added handleRemoveFile function to manage file list deletions.
  const handleRemoveFile = (index: number) => {
    setChatFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (e.clipboardData.files.length > 0) {
          const filesArray = Array.from(e.clipboardData.files).filter((file: File) => file.type.startsWith('image/'));
          if (filesArray.length > 0) { e.preventDefault(); setChatFiles(prev => [...prev, ...filesArray]); }
      }
  };

  const handleSend = async () => {
    if ((!input.trim() && chatFiles.length === 0) || !selectedAgentId) return;

    let currentSessionId = selectedSessionId;
    if (!currentSessionId) {
        const newRef = push(ref(db, `chats/${selectedAgentId}`));
        await set(newRef, { name: "New Chat", createdAt: serverTimestamp() });
        currentSessionId = newRef.key;
        setSelectedSessionId(currentSessionId);
    }
    if (!currentSessionId) return;

    const userMsgText = input;
    const rawFilesToSend = [...chatFiles];
    setInput('');
    setChatFiles([]);
    setIsTyping(true);

    let base64Images: string[] | undefined = undefined;
    let filesForGemini: File[] = [];

    if (rawFilesToSend.length > 0) {
        setCompressionStatus('Enhancing images...');
        try {
            filesForGemini = await Promise.all(rawFilesToSend.map(f => compressImage(f)));
            base64Images = await Promise.all(filesForGemini.map(async (file) => {
                const part = await fileToGenerativePart(file);
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            }));
        } catch (e) {
            console.error(e);
            setCompressionStatus('Error processing images.');
            setIsTyping(false);
            return;
        }
        setCompressionStatus('');
    }

    await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
        role: 'user', text: userMsgText, images: base64Images || null, timestamp: serverTimestamp()
    });

    let settings: AppSettings | null = null;
    try {
        const snapshot = await get(child(ref(db), 'settings'));
        if (snapshot.exists()) settings = snapshot.val();
    } catch (e) { console.error(e); }
    
    const currentAgent = agents.find(a => a.id === selectedAgentId);
    if (!currentAgent) return;

    const contextString = knowledge.length > 0 ? knowledge.map(k => k.contentSummary).join('\n\n') : "No knowledge yet.";
    const historyForAi = messages.map(m => {
        const parts: any[] = [{ text: m.text }];
        if (m.images) {
            m.images.forEach(img => {
                const match = img.match(/^data:(.*?);base64,(.*)$/);
                if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            });
        }
        return { role: m.role, parts };
    });
    
    // Updated: GeminiService now manages its own instance using process.env.API_KEY.
    const gemini = new GeminiService();
    let fullResponseText = "";

    try {
        const stream = gemini.chatWithAgentStream(
            settings?.selectedModel || GeminiModel.FLASH_3,
            currentAgent.role + (currentAgent.personality ? ` Personality: ${currentAgent.personality}` : ''),
            contextString,
            historyForAi,
            userMsgText,
            filesForGemini
        );

        setIsTyping(false); // Hide spinner as text starts
        setStreamingText(""); // Start local streaming state

        for await (const chunk of stream) {
            fullResponseText += chunk;
            setStreamingText(fullResponseText);
        }

        // Finalize: save to DB and clear streaming state
        await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
            role: 'model',
            text: fullResponseText,
            timestamp: serverTimestamp()
        });

    } catch (error) {
        console.error(error);
        await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
            role: 'model', text: "Error: Failed to connect to AI Agent.", timestamp: serverTimestamp()
        });
    } finally {
        setStreamingText(null);
        setIsTyping(false);
    }
  };

  const formatMessageText = (text: string) => {
    if (!text) return '';
    return text.replace(/^\s*[\*\-]\s+/gm, '• ').replace(/\*\*/g, '').replace(/__/g, '').replace(/^\s*#+\s*/gm, '').replace(/`/g, '');
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(formatMessageText(text)).then(() => {
        // Feedback logic can be added here
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const activeAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col md:flex-row gap-6 relative">
      {previewImage && (
          <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setPreviewImage(null)}>
              <button className="absolute top-4 right-4 text-white/70 hover:text-white bg-white/10 p-2 rounded-full" onClick={() => setPreviewImage(null)}>
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
              <img src={previewImage} alt="Full Preview" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain" onClick={(e) => e.stopPropagation()} />
          </div>
      )}

      <div className="md:w-1/4 w-full bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col shadow-xl">
        <div className="p-4 bg-slate-700/50 border-b border-slate-700 flex items-center justify-between">
            <h3 className="font-bold text-white flex items-center gap-2">
                 <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                 Agents
            </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {agents.map(agent => (
                <div key={agent.id} className="space-y-1">
                    <button onClick={() => setSelectedAgentId(agent.id)} className={`w-full flex items-center p-3 rounded-lg transition-colors ${selectedAgentId === agent.id ? 'bg-blue-600/20 border border-blue-500' : 'hover:bg-slate-700 border border-transparent'}`}>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm mr-3 ${agent.avatar || 'bg-gray-500'}`}>{agent.name[0]}</div>
                        <div className="text-left overflow-hidden flex-1">
                            <div className="font-semibold text-white truncate">{agent.name}</div>
                            <div className="text-xs text-slate-400 truncate">{agent.role}</div>
                        </div>
                    </button>
                    {selectedAgentId === agent.id && (
                        <div className="ml-6 border-l-2 border-slate-600 pl-2 space-y-1 my-2">
                            <div className="flex justify-between items-center px-2">
                                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">History</span>
                                <button onClick={() => setIsCreatingSession(!isCreatingSession)} className="text-xs text-blue-400 hover:text-blue-300">New</button>
                            </div>
                            {isCreatingSession && (
                                <div className="flex gap-1 p-1">
                                    <input autoFocus className="bg-slate-900 text-xs text-white p-1 rounded w-full border border-slate-600" placeholder="Room Name..." value={newSessionName} onChange={e => setNewSessionName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateSession()} />
                                    <button onClick={handleCreateSession} className="text-green-400"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M5 13l4 4L19 7" /></svg></button>
                                </div>
                            )}
                            {sessions.map(session => (
                                <button key={session.id} onClick={() => setSelectedSessionId(session.id)} className={`w-full text-left text-xs p-2 rounded truncate flex items-center ${selectedSessionId === session.id ? 'bg-blue-500/10 text-blue-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}>
                                    <svg className="w-3 h-3 mr-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                                    {session.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
      </div>

      <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden relative shadow-2xl">
        <div className="p-4 bg-[#075E54] flex items-center justify-between shadow-md z-10">
             <div className="flex items-center space-x-3">
                {activeAgent ? (
                    <>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${activeAgent.avatar || 'bg-gray-500'}`}>{activeAgent.name[0]}</div>
                        <div>
                            <h3 className="font-bold text-white">{activeAgent.name}</h3>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center"><div className="w-2 h-2 bg-green-400 rounded-full animate-pulse mr-1" /><p className="text-xs text-green-100 opacity-80">online</p></div>
                                {selectedSessionId && <span className="text-xs bg-black/20 px-2 rounded-full text-white/90">{sessions.find(s => s.id === selectedSessionId)?.name}</span>}
                            </div>
                        </div>
                    </>
                ) : <div className="text-white">Select an agent from the list</div>}
             </div>
             {selectedSessionId && (
                 <button onClick={handleDeleteSession} title="Delete History" className="text-white/70 hover:text-red-300 p-2 rounded-full hover:bg-black/10">
                     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                 </button>
             )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0b141a]" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", backgroundBlendMode: 'soft-light' }}>
            {messages.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-4 py-2 shadow-sm text-sm whitespace-pre-wrap group relative ${msg.role === 'user' ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'}`}>
                        {msg.images && <div className="mb-2 flex flex-wrap gap-2">{msg.images.map((imgSrc, idx) => <BlobImage key={idx} base64Src={imgSrc} onPreview={setPreviewImage} />)}</div>}
                        {formatMessageText(msg.text)}
                        <div className="text-[10px] text-right opacity-50 mt-1 flex justify-end items-center gap-2">
                            {msg.role === 'model' && (
                                <button onClick={() => handleCopy(msg.text)} className="hover:text-white p-1 rounded">
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                </button>
                            )}
                            <span>{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}</span>
                        </div>
                    </div>
                </div>
            ))}
            
            {/* Real-time Streaming Message Bubble */}
            {streamingText !== null && (
                <div className="flex justify-start">
                    <div className="max-w-[80%] rounded-lg px-4 py-2 shadow-sm text-sm whitespace-pre-wrap bg-[#202c33] text-[#e9edef] rounded-tl-none border-l-2 border-blue-500/30">
                        {formatMessageText(streamingText)}
                        {streamingText === "" && (
                            <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1 align-middle" />
                        )}
                        <div className="text-[10px] text-right opacity-50 mt-1 italic">Typing...</div>
                    </div>
                </div>
            )}
            
            {compressionStatus && (
                <div className="flex justify-end pr-4">
                     <div className="bg-[#005c4b] text-[#e9edef] text-xs px-3 py-1 rounded-full animate-pulse flex items-center gap-2">
                        <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                        {compressionStatus}
                     </div>
                </div>
            )}

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

        <div className="p-3 bg-[#202c33] flex flex-col gap-2 relative">
            {chatFiles.length > 0 && (
                <div className="flex gap-3 px-2 pb-2 overflow-x-auto">
                    {chatFiles.map((file, idx) => (
                        <div key={idx} className="relative flex-shrink-0">
                            <div className="w-16 h-16 rounded-xl overflow-hidden border border-slate-600 shadow-lg">
                                <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover" />
                            </div>
                            <button onClick={() => handleRemoveFile(idx)} className="absolute -top-2 -right-2 bg-slate-700 text-slate-300 rounded-full p-1 shadow-md hover:bg-red-500 transition-all"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-end space-x-2 bg-[#2a3942] rounded-2xl p-2 border border-slate-700/50 focus-within:border-slate-500">
                <input type="file" multiple accept="image/*" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                <button onClick={() => fileInputRef.current?.click()} className="text-[#8696a0] p-2 hover:bg-[#374248] rounded-full transition-colors mb-0.5" title="Attach Image">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path transform="rotate(-45, 12, 12)" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
                </button>
                <input 
                    value={input} 
                    onChange={(e) => setInput(e.target.value)} 
                    onKeyDown={handleKeyDown} 
                    onPaste={handlePaste} 
                    placeholder={activeAgent ? "Type a message..." : "Select an agent first"} 
                    disabled={!activeAgent || isTyping || streamingText !== null} 
                    className="flex-1 bg-transparent text-white px-2 py-3 outline-none min-h-[44px]" 
                />
                <button onClick={handleSend} disabled={(!input.trim() && chatFiles.length === 0) || !activeAgent || isTyping || streamingText !== null} className={`p-2 rounded-full transition-all mb-0.5 ${input.trim() || chatFiles.length > 0 ? 'text-[#00a884] bg-[#00a884]/10' : 'text-[#8696a0]'}`}>
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Chat;