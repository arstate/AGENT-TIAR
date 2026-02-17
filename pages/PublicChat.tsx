
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { db } from '../services/firebase';
import { ref, onValue, push, set, serverTimestamp, get, child, update } from 'firebase/database';
import { GeminiService, fileToGenerativePart } from '../services/geminiService';
import { Agent, GeminiModel, KnowledgeItem, AppSettings, ChatMessage } from '../types';

// Reuse Image Helpers from Chat.tsx (Simplified for brevity as they are internal)
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
            if (ctx) {
                ctx.drawImage(img, 0, 0);
                canvas.toBlob((blob) => {
                    URL.revokeObjectURL(url);
                    if (blob) resolve(new File([blob], file.name, { type: 'image/webp', lastModified: Date.now() }));
                    else resolve(file);
                }, 'image/webp', 0.9);
            } else resolve(file);
        };
        img.onerror = () => resolve(file);
        img.src = url;
    });
};

const BlobImage: React.FC<{ base64Src: string }> = ({ base64Src }) => {
    return (
        <img 
            src={base64Src} 
            alt="attachment" 
            className="max-w-full h-auto rounded-lg max-h-60 border border-black/20 cursor-pointer"
            onClick={() => {
                const w = window.open("");
                w?.document.write(`<img src="${base64Src}" style="max-width:100%"/>`);
            }}
        />
    );
};

interface PublicChatProps {
    agentIdProp?: string; // Optional prop if used inside Home
}

const PublicChat: React.FC<PublicChatProps> = ({ agentIdProp }) => {
    const params = useParams();
    // Prioritize prop (from Home), then param (from Router)
    const effectiveAgentId = agentIdProp || params.agentId;
    
    const [agent, setAgent] = useState<Agent | null>(null);
    const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [chatFiles, setChatFiles] = useState<File[]>([]);
    const [isTyping, setIsTyping] = useState(false);
    
    // Device ID (Persistent Session)
    const [deviceId, setDeviceId] = useState<string | null>(null);
    
    // Registration State
    const [isRegistered, setIsRegistered] = useState(false);
    const [regName, setRegName] = useState('');
    const [regPhone, setRegPhone] = useState('');
    const [checkingReg, setCheckingReg] = useState(true);

    const bottomRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [loadingAgent, setLoadingAgent] = useState(true);

    // Initialize Device ID
    useEffect(() => {
        let storedId = localStorage.getItem('device_uuid');
        if (!storedId) {
            storedId = `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem('device_uuid', storedId);
        }
        setDeviceId(storedId);
    }, []);

    // Load Agent Data (Handle ID or Slug)
    useEffect(() => {
        if (!effectiveAgentId) return;

        const findAgent = async () => {
            setLoadingAgent(true);
            try {
                // 1. Try to fetch as direct ID first
                const agentRef = ref(db, `agents/${effectiveAgentId}`);
                const snap = await get(agentRef);
                
                if (snap.exists()) {
                    const data = snap.val();
                    if (data.isPublic || agentIdProp) {
                        setAgent({ id: effectiveAgentId, ...data });
                        setLoadingAgent(false);
                        return; // Found by ID
                    }
                }

                // 2. If not found by ID (or not public), search by SLUG
                const allAgentsRef = ref(db, 'agents');
                const allSnap = await get(allAgentsRef);
                if (allSnap.exists()) {
                    const allData = allSnap.val();
                    const foundKey = Object.keys(allData).find(key => {
                        return allData[key].slug === effectiveAgentId && allData[key].isPublic;
                    });

                    if (foundKey) {
                        setAgent({ id: foundKey, ...allData[foundKey] });
                    } else {
                        setAgent(null);
                    }
                }
            } catch (error) {
                console.error("Error finding agent:", error);
                setAgent(null);
            } finally {
                setLoadingAgent(false);
            }
        };

        findAgent();
    }, [effectiveAgentId, agentIdProp]);

    // Check Registration Status
    useEffect(() => {
        if (!agent || !deviceId) return;
        
        const checkRegistration = async () => {
            const userRef = ref(db, `public_chats/${agent.id}/${deviceId}/userInfo`);
            const snap = await get(userRef);
            if (snap.exists()) {
                setIsRegistered(true);
            } else {
                setIsRegistered(false);
            }
            setCheckingReg(false);
        };
        checkRegistration();
    }, [agent, deviceId]);

    // Load Knowledge (Requires resolved Agent ID)
    useEffect(() => {
        if (!agent) return;
        const knowledgeRef = ref(db, `knowledge/${agent.id}`);
        get(knowledgeRef).then(snap => {
            if(snap.exists()) {
                const data = snap.val();
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
                setKnowledge(list);
            }
        });
    }, [agent]);

    // Load Messages based on Device ID
    useEffect(() => {
        if (!agent || !deviceId) return;
        
        const chatPath = `public_chats/${agent.id}/${deviceId}/messages`;
        const messagesRef = ref(db, chatPath);
        
        const unsub = onValue(messagesRef, (snap) => {
            const data = snap.val();
            if (data) {
                const list = Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a,b) => a.timestamp - b.timestamp);
                setMessages(list);
            } else {
                setMessages([]);
            }
        });
        return () => unsub();
    }, [agent, deviceId]);

    useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, isTyping]);

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!regName.trim() || !regPhone.trim() || !agent || !deviceId) return;

        await update(ref(db, `public_chats/${agent.id}/${deviceId}`), {
            userInfo: {
                name: regName,
                phone: regPhone
            },
            lastActive: serverTimestamp()
        });
        setIsRegistered(true);
    };

    const handleSend = async () => {
        if ((!input.trim() && chatFiles.length === 0) || !agent || !deviceId) return;

        const userMsgText = input;
        const rawFiles = [...chatFiles];
        setInput('');
        setChatFiles([]);
        setIsTyping(true);

        // Path for this device's chat
        const chatPath = `public_chats/${agent.id}/${deviceId}/messages`;

        let base64Images: string[] | undefined;
        let filesForGemini: File[] = [];

        if (rawFiles.length > 0) {
            filesForGemini = await Promise.all(rawFiles.map(compressImage));
            const imgPromises = filesForGemini.map(async f => {
                const part = await fileToGenerativePart(f);
                return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            });
            base64Images = await Promise.all(imgPromises);
        }

        await push(ref(db, chatPath), {
            role: 'user',
            text: userMsgText,
            images: base64Images || null,
            timestamp: serverTimestamp()
        });

        // Update last active
        await update(ref(db, `public_chats/${agent.id}/${deviceId}`), {
            lastActive: serverTimestamp()
        });

        const settingsSnap = await get(child(ref(db), 'settings'));
        const settings: AppSettings = settingsSnap.val();

        if (!settings || !settings.apiKeys) {
             await push(ref(db, chatPath), {
                role: 'model', text: "Error Sistem: Layanan tidak tersedia.", timestamp: serverTimestamp()
            });
            setIsTyping(false);
            return;
        }

        const imageKnowledge = knowledge.filter(k => k.imageData && k.type === 'image');
        const compositeKnowledge = knowledge.filter(k => k.images && k.images.length > 0 && k.type === 'composite');
        const textKnowledge = knowledge.filter(k => (!k.imageData && !k.images) || k.type === 'file' || k.type === 'text');

        const imageContextList = imageKnowledge.map(k => `[IMAGE_ID: ${k.id}] ${k.originalName}: ${k.contentSummary}`).join('\n');
        const compositeContextList = compositeKnowledge.map(k => `[IMAGE_ID: ${k.id}] COLLECTION ${k.originalName}: ${k.contentSummary}`).join('\n');
        const textContextList = textKnowledge.map(k => `[${k.originalName || 'Info'}]: ${k.contentSummary}`).join('\n\n');

        const contextString = `
        === KNOWLEDGE BASE ===
        ${textContextList}
        
        === AVAILABLE IMAGES ===
        ${imageContextList}
        ${compositeContextList}
        `;

        const history = messages.map(m => {
            const parts: any[] = [{ text: m.text }];
            if (m.images) {
                m.images.forEach(img => {
                    const match = img.match(/^data:(.*?);base64,(.*)$/);
                    if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
                });
            }
            return { role: m.role, parts };
        });

        const gemini = new GeminiService(settings.apiKeys);

        // TRANSLATED SYSTEM INSTRUCTION
        const systemInstruction = `
            Anda adalah Agen AI dengan peran berikut: ${agent.role}.
            ${agent.personality ? `Kepribadian Anda adalah: ${agent.personality}` : ''}
            
            Gunakan BAHASA INDONESIA yang baik, sopan, dan profesional dalam setiap jawaban.
            
            Anda memiliki akses ke Basis Pengetahuan (Knowledge Base) di bawah ini. 
            Ini berisi fakta tekstual dan daftar GAMBAR TERSEDIA dengan ID.

            --- KNOWLEDGE BASE START ---
            ${contextString}
            --- KNOWLEDGE BASE END ---
            
            *** INSTRUKSI PENTING UNTUK MENGIRIM GAMBAR ***
            Ketika pengguna meminta foto (contoh: "lihat dapurnya", "minta foto kamar mandi", "brosur mana"):
            1. CARI di daftar 'AVAILABLE IMAGES' dalam Knowledge Base.
            2. COCOKKAN permintaan pengguna dengan 'Filename' atau 'Description'.
            3. JIKA COCOK: Keluarkan tag [[SEND_IMAGE: <image_id>]].
            4. JIKA TIDAK COCOK: Jangan kirim gambar acak. Jelaskan saja bahwa Anda tidak memiliki foto spesifik tersebut.
            
            Tetap pada karakter. Jawab dengan ringkas dan membantu.
        `;

        try {
            let responseText = await gemini.chatWithAgent(
                settings.selectedModel || GeminiModel.FLASH_3,
                systemInstruction,
                "", // Context in system instruction
                history,
                userMsgText,
                filesForGemini
            );

            const modelImagesToSend: string[] = [];
            const sendImageRegex = /\[\[SEND_IMAGE:\s*(.+?)\]\]/g;
            let match;
            while ((match = sendImageRegex.exec(responseText)) !== null) {
                const id = match[1];
                const k = knowledge.find(i => i.id === id);
                if (k) {
                    if (k.imageData) modelImagesToSend.push(k.imageData);
                    if (k.images) modelImagesToSend.push(...k.images);
                }
            }
            responseText = responseText.replace(sendImageRegex, '').trim();

            if (!responseText && modelImagesToSend.length > 0) {
                responseText = "Berikut fotonya kak:"; 
            }

            await push(ref(db, chatPath), {
                role: 'model',
                text: responseText,
                images: modelImagesToSend.length > 0 ? modelImagesToSend : null,
                timestamp: serverTimestamp()
            });
        } catch (e) {
            console.error(e);
             await push(ref(db, chatPath), {
                role: 'model', text: "Maaf, terjadi kesalahan saat menghubungkan ke server.", timestamp: serverTimestamp()
            });
        } finally {
            setIsTyping(false);
        }
    };

    if (loadingAgent || checkingReg) {
         return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                 <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            </div>
         );
    }

    if (!agent) {
        return (
            <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-slate-400 p-4 text-center">
                <svg className="w-16 h-16 mb-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <h1 className="text-2xl font-bold text-white mb-2">Agent Tidak Ditemukan</h1>
                <p>Agent ini sedang offline atau tidak tersedia.</p>
            </div>
        );
    }

    // REGISTRATION FORM OVERLAY
    if (!isRegistered) {
        return (
            <div className="fixed inset-0 bg-[#0f172a] flex items-center justify-center p-4 z-50">
                <div className="bg-slate-800 border border-slate-700 p-6 rounded-2xl shadow-2xl max-w-md w-full relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-emerald-500"></div>
                    <div className="text-center mb-6">
                        <div className={`w-16 h-16 rounded-full mx-auto flex items-center justify-center text-white font-bold text-2xl shadow-lg mb-4 ${agent.avatar || 'bg-blue-600'}`}>
                            {agent.name[0]}
                        </div>
                        <h2 className="text-xl font-bold text-white">Selamat Datang di {agent.name}</h2>
                        <p className="text-slate-400 text-sm mt-1">Silakan perkenalkan diri Anda untuk mulai mengobrol.</p>
                    </div>
                    
                    <form onSubmit={handleRegister} className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Nama Anda</label>
                            <input 
                                type="text" 
                                required
                                value={regName}
                                onChange={e => setRegName(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none"
                                placeholder="Contoh: Budi Santoso"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-400 mb-1 uppercase tracking-wider">Nomor WhatsApp</label>
                            <input 
                                type="tel" 
                                required
                                value={regPhone}
                                onChange={e => setRegPhone(e.target.value)}
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:border-blue-500 outline-none"
                                placeholder="Contoh: 08123456789"
                            />
                        </div>
                        
                        <div className="bg-blue-900/20 p-3 rounded-lg border border-blue-500/20 flex gap-3 items-start">
                            <svg className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                            </svg>
                            <p className="text-xs text-blue-200">
                                <span className="font-bold">Pemberitahuan Privasi:</span> Nomor HP tidak akan tersebar. Nomor HP hanya untuk Admin menghubungi Anda via WhatsApp jika diperlukan.
                            </p>
                        </div>

                        <button 
                            type="submit" 
                            className="w-full bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white font-bold py-3 rounded-xl shadow-lg transform transition-transform hover:scale-[1.02]"
                        >
                            Mulai Chat
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-[#0f172a] flex flex-col">
            {/* Header */}
            <div className="bg-[#1e293b] p-4 flex items-center justify-between shadow-md z-10 border-b border-slate-700">
                <div className="flex items-center gap-3">
                     <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg ${agent.avatar || 'bg-blue-600'}`}>
                         {agent.name[0]}
                     </div>
                     <div>
                         <h1 className="font-bold text-white text-lg leading-tight">{agent.name}</h1>
                         <div className="flex items-center gap-1.5">
                            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                            <span className="text-xs text-slate-400">Online</span>
                         </div>
                     </div>
                </div>
            </div>

            {/* Chat Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900" style={{ backgroundImage: "radial-gradient(#1e293b 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                {messages.length === 0 && (
                    <div className="text-center py-10 opacity-50">
                        <p className="text-slate-400">Mulai percakapan dengan {agent.name}!</p>
                    </div>
                )}
                {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-lg text-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-tl-none'}`}>
                            {msg.images && msg.images.length > 0 && (
                                <div className="mb-2 flex flex-wrap gap-2">
                                    {msg.images.map((img, idx) => <BlobImage key={idx} base64Src={img} />)}
                                </div>
                            )}
                            {msg.text}
                            <div className={`text-[10px] text-right mt-1 opacity-60 ${msg.role === 'user' ? 'text-blue-200' : 'text-slate-400'}`}>
                                {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '...'}
                            </div>
                        </div>
                    </div>
                ))}
                {isTyping && (
                    <div className="flex justify-start">
                         <div className="bg-slate-800 border border-slate-700 px-4 py-3 rounded-2xl rounded-tl-none flex gap-1">
                             <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                             <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-75"></div>
                             <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce delay-150"></div>
                         </div>
                    </div>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Input Area */}
            <div className="p-4 bg-[#1e293b] border-t border-slate-700">
                {chatFiles.length > 0 && (
                    <div className="flex gap-2 mb-2 overflow-x-auto pb-2">
                        {chatFiles.map((f, i) => (
                            <div key={i} className="relative w-12 h-12 flex-shrink-0 bg-slate-700 rounded border border-slate-600 flex items-center justify-center">
                                <span className="text-[10px] text-white truncate px-1">{f.name}</span>
                                <button onClick={() => setChatFiles(prev => prev.filter((_, idx) => idx !== i))} className="absolute -top-1 -right-1 bg-red-500 rounded-full p-0.5 text-white"><svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
                            </div>
                        ))}
                    </div>
                )}
                <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-xl border border-slate-700 focus-within:border-blue-500 transition-colors">
                    <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*" onChange={(e) => e.target.files && setChatFiles(prev => [...prev, ...Array.from(e.target.files!)])} />
                    <button onClick={() => fileInputRef.current?.click()} className="p-2 text-slate-400 hover:text-white transition-colors">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    </button>
                    <input 
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ketik pesan..."
                        className="flex-1 bg-transparent text-white placeholder-slate-500 outline-none"
                    />
                    <button 
                        onClick={handleSend}
                        disabled={!input.trim() && chatFiles.length === 0}
                        className={`p-2 rounded-lg transition-colors ${input.trim() || chatFiles.length > 0 ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PublicChat;
