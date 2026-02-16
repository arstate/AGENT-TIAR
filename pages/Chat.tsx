
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../services/firebase';
import { ref, onValue, get, child, push, set, remove, serverTimestamp } from 'firebase/database';
import { GeminiService, fileToGenerativePart } from '../services/geminiService';
import { Agent, GeminiModel, KnowledgeItem, AppSettings, ChatMessage, ChatSession } from '../types';

// --- HELPER: Image Compression ---
// Maintains 100% resolution for AI readability.
// Skips PDF files.
const compressImage = async (file: File): Promise<File> => {
    // If it's not an image (e.g. PDF), return original immediately
    if (!file.type.startsWith('image/')) return file;

    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(file); 
                return;
            }
            
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            canvas.toBlob((blob) => {
                URL.revokeObjectURL(url);
                if (blob) {
                    const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".webp", {
                        type: 'image/webp',
                        lastModified: Date.now(),
                    });
                    resolve(compressedFile);
                } else {
                    resolve(file);
                }
            }, 'image/webp', 0.90); 
        };
        
        img.onerror = (err) => {
            URL.revokeObjectURL(url);
            resolve(file); 
        };
        
        img.src = url;
    });
};

// --- HELPER: Download Image ---
const downloadImage = (base64Src: string) => {
    const link = document.createElement('a');
    link.href = base64Src;
    // Guess extension
    const ext = base64Src.startsWith('data:image/png') ? '.png' : '.jpg';
    link.download = `agenai-download-${Date.now()}${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// --- COMPONENT: BlobImage or PDF Icon ---
const FileDisplay = ({ base64Src, onPreview }: { base64Src: string, onPreview: (url: string) => void }) => {
    // Check if PDF
    const isPdf = base64Src.startsWith('data:application/pdf');

    if (isPdf) {
         return (
             <div className="flex items-center space-x-2 bg-black/20 p-2 rounded border border-white/10 max-w-[200px]">
                 <svg className="w-8 h-8 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                     <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v.5zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z" />
                 </svg>
                 <span className="text-xs text-white truncate">PDF Attached</span>
             </div>
         );
    }

    // Default to Image handling
    return <BlobImage base64Src={base64Src} onPreview={onPreview} />;
};

const BlobImage = ({ base64Src, onPreview }: { base64Src: string, onPreview: (url: string) => void }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);

    useEffect(() => {
        let isMounted = true;
        fetch(base64Src)
            .then(res => res.blob())
            .then(blob => {
                if(isMounted) {
                    const url = URL.createObjectURL(blob);
                    setBlobUrl(url);
                }
            })
            .catch(() => {
                if(isMounted) setBlobUrl(base64Src);
            });

        return () => {
            isMounted = false;
            if (blobUrl && blobUrl.startsWith('blob:')) {
                URL.revokeObjectURL(blobUrl);
            }
        };
    }, [base64Src]);

    if (!blobUrl) return null;

    return (
        <div className="block relative group cursor-zoom-in inline-block">
            <img 
                onClick={() => onPreview(blobUrl)}
                src={blobUrl} 
                alt="attachment" 
                className="max-w-full h-auto rounded-lg max-h-60 border border-black/20"
                loading="lazy"
            />
            
            {/* Download Button Overlay */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    downloadImage(base64Src);
                }}
                className="absolute bottom-2 right-2 bg-slate-900/80 hover:bg-black text-white p-1.5 rounded-full shadow-lg opacity-80 hover:opacity-100 transition-all border border-slate-600"
                title="Download Image"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
            </button>

            <div className="absolute inset-0 pointer-events-none rounded-lg ring-1 ring-inset ring-black/10"></div>
        </div>
    );
};

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
  const [chatFiles, setChatFiles] = useState<File[]>([]); 
  const [isTyping, setIsTyping] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [compressionStatus, setCompressionStatus] = useState('');

  // UI State
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // Controls Mobile View: False = List, True = Chat
  const [showMobileChat, setShowMobileChat] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Load Agents
  useEffect(() => {
    const agentsUnsub = onValue(ref(db, 'agents'), (snap) => {
        const data = snap.val();
        if (data) {
            const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
            setAgents(list);
            if (list.length > 0 && !selectedAgentId) setSelectedAgentId(list[0].id);
        }
    });
    return () => { agentsUnsub(); };
  }, [selectedAgentId]);

  // 2. Load Knowledge & Sessions
  useEffect(() => {
    if (!selectedAgentId) {
        setKnowledge([]);
        setSessions([]);
        return;
    }
    const knowledgeUnsub = onValue(ref(db, `knowledge/${selectedAgentId}`), (snap) => {
        const data = snap.val();
        if (data) {
             const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
             setKnowledge(list);
        } else { setKnowledge([]); }
    });

    const sessionsRef = ref(db, `chats/${selectedAgentId}`);
    const sessionsUnsub = onValue(sessionsRef, (snap) => {
        const data = snap.val();
        if (data) {
            const list: ChatSession[] = Object.keys(data).map(k => ({
                id: k,
                name: data[k].name || 'General Chat',
                createdAt: data[k].createdAt || Date.now()
            })).sort((a,b) => b.createdAt - a.createdAt);
            setSessions(list);
            if (list.length > 0 && !selectedSessionId) setSelectedSessionId(list[0].id);
            else if (list.length === 0) setSelectedSessionId(null);
        } else {
            setSessions([]);
            setSelectedSessionId(null);
        }
    });
    return () => { knowledgeUnsub(); sessionsUnsub(); };
  }, [selectedAgentId]);

  // 3. Load Messages
  useEffect(() => {
    if (!selectedAgentId || !selectedSessionId) {
        setMessages([]);
        return;
    }
    const messagesRef = ref(db, `chats/${selectedAgentId}/${selectedSessionId}/messages`);
    const unsub = onValue(messagesRef, (snap) => {
        const data = snap.val();
        if (data) {
            const list: ChatMessage[] = Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a,b) => a.timestamp - b.timestamp);
            setMessages(list);
        } else { setMessages([]); }
    });
    return () => unsub();
  }, [selectedAgentId, selectedSessionId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isTyping, chatFiles, compressionStatus]);

  const handleCreateSession = async () => {
      if (!selectedAgentId || !newSessionName.trim()) return;
      const newRef = push(ref(db, `chats/${selectedAgentId}`));
      await set(newRef, { name: newSessionName, createdAt: serverTimestamp() });
      setSelectedSessionId(newRef.key);
      setShowMobileChat(true); // Open chat on mobile
      setNewSessionName('');
      setIsCreatingSession(false);
  };

  const handleDeleteSession = async () => {
      if (!selectedAgentId || !selectedSessionId) return;
      if (confirm("Are you sure you want to delete this entire chat history?")) {
          await remove(ref(db, `chats/${selectedAgentId}/${selectedSessionId}`));
          setSelectedSessionId(null);
          // Don't necessarily close chat, maybe show empty or go back? 
          // Going back to list seems safer.
          setShowMobileChat(false);
      }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
          const newFiles = Array.from(e.target.files!);
          setChatFiles(prev => [...prev, ...newFiles]);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
      if (e.clipboardData.files.length > 0) {
          const filesArray = Array.from(e.clipboardData.files); // Accept all types from paste for now
          if (filesArray.length > 0) {
              e.preventDefault();
              setChatFiles(prev => [...prev, ...filesArray]);
          }
      }
  };

  const handleRemoveFile = (index: number) => {
      setChatFiles(prev => prev.filter((_, i) => i !== index));
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
        setCompressionStatus('Processing files...');
        try {
            // Compress images, skip PDFs
            const compressedFilesPromise = rawFilesToSend.map(f => compressImage(f));
            filesForGemini = await Promise.all(compressedFilesPromise);
            
            const imagePromises = filesForGemini.map(async (file) => {
                const part = await fileToGenerativePart(file);
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            });
            base64Images = await Promise.all(imagePromises);
        } catch (e) {
            console.error("File processing error", e);
            setCompressionStatus('Error processing files.');
            setIsTyping(false);
            return;
        }
        setCompressionStatus('');
    }

    await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
        role: 'user',
        text: userMsgText,
        images: base64Images || null,
        timestamp: serverTimestamp()
    });

    // Fetch Settings
    let settings: AppSettings | null = null;
    try {
        const snapshot = await get(child(ref(db), 'settings'));
        if (snapshot.exists()) settings = snapshot.val();
    } catch (e) { console.error(e); }

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

    // Construct Context with Image IDs for the AI
    const contextString = knowledge.length > 0 
        ? knowledge.map(k => {
            let str = `Content: ${k.contentSummary}`;
            if (k.imageData && k.id) {
                str = `[IMAGE_ID: ${k.id}] ${str}`; // Prepend Image ID so AI knows it's available
            }
            return str;
        }).join('\n\n') 
        : "No specific knowledge base trained for this agent yet.";

    const historyForAi = messages.map(m => {
        const parts: any[] = [{ text: m.text }];
        if (m.images) {
            m.images.forEach(img => {
                const match = img.match(/^data:(.*?);base64,(.*)$/);
                if (match) {
                     parts.push({
                         inlineData: { mimeType: match[1], data: match[2] }
                     });
                }
            });
        }
        return { role: m.role, parts };
    });
    
    const gemini = new GeminiService(apiKeys);

    try {
        let responseText = await gemini.chatWithAgent(
            model,
            currentAgent.role + (currentAgent.personality ? ` Personality: ${currentAgent.personality}` : ''),
            contextString,
            historyForAi,
            userMsgText,
            filesForGemini
        );

        // --- PARSE RESPONSE FOR IMAGES ---
        const modelImagesToSend: string[] = [];
        const sendImageRegex = /\[\[SEND_IMAGE:\s*(.+?)\]\]/g;
        let match;
        
        // Find all image tags
        while ((match = sendImageRegex.exec(responseText)) !== null) {
            const imageId = match[1];
            // Find the image in local knowledge state
            const kItem = knowledge.find(k => k.id === imageId);
            if (kItem && kItem.imageData) {
                modelImagesToSend.push(kItem.imageData);
            }
        }

        // Remove the tags from the visible text
        responseText = responseText.replace(sendImageRegex, '').trim();

        if (!responseText && modelImagesToSend.length > 0) {
            responseText = "Sent an image."; // Fallback if AI only sends image tag
        }

        await push(ref(db, `chats/${selectedAgentId}/${currentSessionId}/messages`), {
            role: 'model',
            text: responseText,
            images: modelImagesToSend.length > 0 ? modelImagesToSend : null,
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

  const formatMessageText = (text: string) => {
    if (!text) return '';
    return text.replace(/^\s*[\*\-]\s+/gm, '• ').replace(/\*\*/g, '').replace(/__/g, '').replace(/^\s*#+\s*/gm, '').replace(/`/g, '');
  };

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(formatMessageText(text)).then(() => {
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const activeAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col md:flex-row gap-6 relative">
      {/* Sidebar List (Agents & Sessions) */}
      <div className={`md:w-1/4 w-full bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col shadow-xl ${showMobileChat ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 bg-slate-700/50 border-b border-slate-700">
            <h3 className="font-bold text-white flex items-center gap-2">
                 Agents History
            </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {agents.map(agent => (
                <div key={agent.id} className="space-y-1">
                    <button
                        onClick={() => {
                            setSelectedAgentId(agent.id);
                            setShowMobileChat(true); // Switch to Chat View on Mobile
                        }}
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
                    {selectedAgentId === agent.id && (
                        <div className="ml-6 border-l-2 border-slate-600 pl-2 space-y-1 my-2">
                             <div className="flex justify-between items-center px-2 mb-2">
                                <span className="text-[10px] text-slate-500 uppercase tracking-widest">Chats</span>
                                <button onClick={(e) => { e.stopPropagation(); setIsCreatingSession(!isCreatingSession); }} className="text-blue-400 hover:text-white"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg></button>
                            </div>
                            {isCreatingSession && (
                                <div className="flex gap-1 p-1">
                                    <input autoFocus className="bg-slate-900 text-xs text-white p-1 rounded w-full border border-slate-600" placeholder="Chat Name..." value={newSessionName} onChange={e => setNewSessionName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateSession()} />
                                    <button onClick={handleCreateSession} className="text-green-400 text-xs"><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg></button>
                                </div>
                            )}
                            {sessions.map(session => (
                                <button 
                                    key={session.id} 
                                    onClick={() => {
                                        setSelectedSessionId(session.id);
                                        setShowMobileChat(true); // Switch to Chat View on Mobile
                                    }} 
                                    className={`w-full text-left text-xs p-2 rounded truncate flex items-center ${selectedSessionId === session.id ? 'bg-blue-500/10 text-blue-300' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/50'}`}
                                >
                                    {session.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden relative shadow-2xl ${showMobileChat ? 'flex' : 'hidden md:flex'}`}>
        <div className="p-4 bg-[#075E54] flex items-center justify-between shadow-md z-10">
             <div className="flex items-center space-x-3">
                {/* Mobile Back Button */}
                <button 
                    onClick={() => setShowMobileChat(false)}
                    className="md:hidden mr-1 text-white/80 hover:text-white p-1 rounded-full hover:bg-white/10"
                    title="Back to Agents"
                >
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                </button>

                {activeAgent && (
                    <>
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${activeAgent.avatar || 'bg-gray-500'}`}>{activeAgent.name[0]}</div>
                        <div>
                            <h3 className="font-bold text-white">{activeAgent.name}</h3>
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                                <p className="text-xs text-green-100 opacity-80">online</p>
                            </div>
                        </div>
                    </>
                )}
             </div>
             {selectedSessionId && (
                 <button onClick={handleDeleteSession} className="text-white/70 hover:text-red-300 transition-colors p-2 rounded-full hover:bg-black/10">
                     <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                 </button>
             )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#0b141a]" style={{ backgroundImage: "url('https://user-images.githubusercontent.com/15075759/28719144-86dc0f70-73b1-11e7-911d-60d70fcded21.png')", backgroundBlendMode: 'soft-light' }}>
            {messages.map((msg, i) => (
                <div key={msg.id || i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[80%] rounded-lg px-4 py-2 shadow-sm text-sm whitespace-pre-wrap group relative ${msg.role === 'user' ? 'bg-[#005c4b] text-[#e9edef] rounded-tr-none' : 'bg-[#202c33] text-[#e9edef] rounded-tl-none'}`}>
                        {msg.images && msg.images.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-2">
                                {msg.images.map((imgSrc, idx) => (
                                    <div key={idx}><FileDisplay base64Src={imgSrc} onPreview={setPreviewImage} /></div>
                                ))}
                            </div>
                        )}
                        {formatMessageText(msg.text)}
                        <div className="text-[10px] text-right opacity-50 mt-1 flex justify-end items-center gap-2">
                            <span>{msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}</span>
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

        <div className="p-3 bg-[#202c33] flex flex-col gap-2 relative">
            {chatFiles.length > 0 && (
                <div className="flex gap-3 px-2 pb-2 overflow-x-auto">
                    {chatFiles.map((file, idx) => (
                        <div key={idx} className="relative group flex-shrink-0">
                            <div className="w-16 h-16 rounded-xl overflow-hidden border border-slate-600 bg-slate-800 shadow-lg relative flex items-center justify-center">
                                {file.type.includes('pdf') ? (
                                    <span className="text-red-400 font-bold text-xs">PDF</span>
                                ) : (
                                    <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover" />
                                )}
                            </div>
                            <button onClick={() => handleRemoveFile(idx)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                        </div>
                    ))}
                </div>
            )}
            <div className="flex items-end space-x-2 bg-[#2a3942] rounded-2xl p-2 border border-slate-700/50 focus-within:border-slate-500 transition-colors">
                <input type="file" multiple accept="image/*, application/pdf" ref={fileInputRef} className="hidden" onChange={handleFileSelect} />
                <button onClick={() => fileInputRef.current?.click()} className="text-[#8696a0] p-2 hover:bg-[#374248] rounded-full transition-colors mb-0.5" title="Attach Image or PDF">
                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path transform="rotate(-45, 12, 12)" d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 015 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 005 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
                </button>
                <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder={activeAgent ? "Type a message..." : "Select an agent first"} disabled={!activeAgent || isTyping} className="flex-1 bg-transparent text-white px-2 py-3 outline-none placeholder-[#8696a0] min-h-[44px] max-h-32" autoComplete="off" />
                <button onClick={handleSend} disabled={(!input.trim() && chatFiles.length === 0) || !activeAgent || isTyping} className={`p-2 rounded-full transition-all mb-0.5 ${input.trim() || chatFiles.length > 0 ? 'text-[#00a884] bg-[#00a884]/10 hover:bg-[#00a884]/20' : 'text-[#8696a0]'}`}><svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg></button>
            </div>
        </div>

        {/* Modal for Images (PDFs don't preview here) */}
        {previewImage && (
            <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setPreviewImage(null)}>
                <img src={previewImage} alt="Full Preview" className="max-w-full max-h-[90vh] rounded-lg shadow-2xl object-contain" />
            </div>
        )}
      </div>
    </div>
  );
};

export default Chat;
