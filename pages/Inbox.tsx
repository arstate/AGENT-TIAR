
import React, { useState, useEffect, useRef } from 'react';
import { db } from '../services/firebase';
import { ref, onValue, get, update, remove } from 'firebase/database';
import { Agent, ChatMessage } from '../types';

interface UserSession {
  key: string; // unique key combo agentId_deviceId
  agentId: string;
  agentName: string;
  agentAvatar: string;
  deviceId: string;
  userInfo?: {
    name: string;
    phone: string;
  };
  lastActive: number;
  isRead?: boolean; // New Flag for status
  messages: ChatMessage[];
}

// Helper for image display (simplified read-only)
const BlobImage: React.FC<{ base64Src: string }> = ({ base64Src }) => {
    return (
        <img 
            src={base64Src} 
            alt="attachment" 
            className="max-w-full h-auto rounded-lg max-h-48 border border-black/20 cursor-pointer"
            onClick={() => {
                const w = window.open("");
                w?.document.write(`<img src="${base64Src}" style="max-width:100%"/>`);
            }}
        />
    );
};

const Inbox: React.FC = () => {
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [agentsMap, setAgentsMap] = useState<Record<string, Agent>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  // 1. Load Agents to map IDs to Names/Avatars
  useEffect(() => {
    const fetchAgents = async () => {
        const snap = await get(ref(db, 'agents'));
        if (snap.exists()) {
            setAgentsMap(snap.val());
        }
    };
    fetchAgents();
  }, []);

  // 2. Load Public Chats
  useEffect(() => {
    const chatsRef = ref(db, 'public_chats');
    const unsub = onValue(chatsRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) {
            setSessions([]);
            setLoading(false);
            return;
        }

        const allSessions: UserSession[] = [];

        // Structure: public_chats / {agentId} / {deviceId} / { ...data }
        Object.keys(data).forEach(agentId => {
            const deviceGroups = data[agentId];
            const agentInfo = agentsMap[agentId];
            
            Object.keys(deviceGroups).forEach(deviceId => {
                const sessionData = deviceGroups[deviceId];
                
                // Convert messages object to array
                let msgList: ChatMessage[] = [];
                if (sessionData.messages) {
                    msgList = Object.keys(sessionData.messages)
                        .map(k => ({ id: k, ...sessionData.messages[k] }))
                        .sort((a,b) => a.timestamp - b.timestamp);
                }

                allSessions.push({
                    key: `${agentId}_${deviceId}`,
                    agentId,
                    agentName: agentInfo?.name || 'Unknown Agent',
                    agentAvatar: agentInfo?.avatar || 'bg-gray-500',
                    deviceId,
                    userInfo: sessionData.userInfo,
                    lastActive: sessionData.lastActive || 0,
                    isRead: sessionData.isRead === undefined ? true : sessionData.isRead, // Default to read if old data
                    messages: msgList
                });
            });
        });

        // Sort by last active (newest first)
        allSessions.sort((a, b) => b.lastActive - a.lastActive);
        setSessions(allSessions);
        setLoading(false);
        
        // Update selected session if it exists (for live updates)
        if (selectedSession) {
            const updated = allSessions.find(s => s.key === selectedSession.key);
            if (updated) setSelectedSession(updated);
            else setSelectedSession(null); // If deleted
        }
    });

    return () => unsub();
  }, [agentsMap, selectedSession]); // Dependency on selectedSession needed to keep chat live

  useEffect(() => {
      if (selectedSession) {
          bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }
  }, [selectedSession]);

  const handleWhatsAppClick = (phone: string, name: string) => {
      // Clean phone number: replace 08 with 628, remove non-digits
      let cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.startsWith('0')) {
          cleanPhone = '62' + cleanPhone.substring(1);
      }
      const text = `Halo kak ${name}, saya dari Admin AgenAI...`;
      window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleMarkAsRead = async () => {
      if (!selectedSession) return;
      
      const chatRef = ref(db, `public_chats/${selectedSession.agentId}/${selectedSession.deviceId}`);
      await update(chatRef, {
          isRead: true
      });
  };

  const handleDeleteChat = async () => {
      if (!selectedSession) return;
      if (confirm("Apakah Anda yakin ingin menghapus chat ini? Data user (Nama/HP) juga akan dihapus, dan user akan diminta mendaftar ulang.")) {
          // Removes the entire session node
          await remove(ref(db, `public_chats/${selectedSession.agentId}/${selectedSession.deviceId}`));
          setSelectedSession(null);
      }
  };

  if (loading) {
      return <div className="p-8 text-center text-slate-400">Memuat kotak masuk...</div>;
  }

  return (
    <div className="h-[calc(100vh-140px)] flex flex-col md:flex-row gap-6">
      {/* Sidebar List */}
      <div className={`md:w-1/3 w-full bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col shadow-xl ${selectedSession ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-4 bg-slate-700/50 border-b border-slate-700">
            <h3 className="font-bold text-white flex items-center gap-2">
                 <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                 </svg>
                 Riwayat Chat Publik
            </h3>
        </div>
        <div className="flex-1 overflow-y-auto">
            {sessions.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">Belum ada percakapan publik.</div>
            ) : (
                sessions.map(session => (
                    <button
                        key={session.key}
                        onClick={() => setSelectedSession(session)}
                        className={`w-full text-left p-4 border-b border-slate-700/50 hover:bg-slate-700 transition-colors flex gap-3 ${selectedSession?.key === session.key ? 'bg-blue-900/20 border-l-4 border-l-blue-500' : ''}`}
                    >
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold shrink-0 ${session.agentAvatar} relative`}>
                            {session.agentName[0]}
                            {/* UNREAD BADGE */}
                            {session.isRead === false && (
                                <span className="absolute top-0 right-0 block h-3 w-3 rounded-full bg-green-500 ring-2 ring-slate-800 transform translate-x-1 -translate-y-1"></span>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-start mb-1">
                                <h4 className={`truncate text-sm ${session.isRead === false ? 'font-extrabold text-white' : 'font-bold text-slate-300'}`}>
                                    {session.userInfo?.name || 'Tamu Anonim'}
                                </h4>
                                <div className="flex flex-col items-end">
                                    <span className="text-[10px] text-slate-400">
                                        {new Date(session.lastActive).toLocaleDateString(undefined, {month:'short', day:'numeric'})}
                                    </span>
                                    {session.isRead === false && (
                                        <span className="text-[9px] bg-green-600 text-white px-1.5 rounded mt-0.5 font-bold">BARU</span>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 mb-1">
                                <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                <span className="text-xs text-slate-300 truncate">{session.userInfo?.phone || 'Tanpa No HP'}</span>
                            </div>
                            <p className="text-xs text-slate-500 truncate">
                                dengan <span className="text-blue-400">{session.agentName}</span>
                            </p>
                        </div>
                    </button>
                ))
            )}
        </div>
      </div>

      {/* Detail Chat View */}
      <div className={`flex-1 bg-slate-800 rounded-xl border border-slate-700 flex flex-col overflow-hidden relative shadow-2xl ${selectedSession ? 'flex' : 'hidden md:flex'}`}>
         {!selectedSession ? (
             <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
                 <svg className="w-16 h-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                 </svg>
                 <p>Pilih percakapan untuk melihat detail</p>
             </div>
         ) : (
             <>
                {/* Chat Header */}
                <div className="p-4 bg-slate-900 border-b border-slate-700 flex justify-between items-center shadow-lg">
                    <div className="flex items-center gap-3">
                         <button onClick={() => setSelectedSession(null)} className="md:hidden text-slate-400 hover:text-white mr-2">
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                         </button>
                         <div>
                             <h2 className="font-bold text-white text-lg flex items-center gap-2">
                                {selectedSession.userInfo?.name || 'Tamu Anonim'}
                                {selectedSession.isRead === false && <span className="bg-green-600 text-white text-[10px] px-2 py-0.5 rounded-full animate-pulse">Pesan Baru</span>}
                             </h2>
                             <div className="flex items-center gap-2 text-sm text-slate-400">
                                 <span>{selectedSession.userInfo?.phone || '-'}</span>
                                 {selectedSession.userInfo?.phone && (
                                     <button 
                                        onClick={() => handleWhatsAppClick(selectedSession.userInfo!.phone, selectedSession.userInfo!.name)}
                                        className="bg-green-600 hover:bg-green-500 text-white text-[10px] px-2 py-0.5 rounded flex items-center gap-1"
                                     >
                                         <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.463 1.065 2.876 1.213 3.074.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg>
                                         WA
                                     </button>
                                 )}
                             </div>
                         </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                         <div className="flex gap-2">
                             {/* DELETE BUTTON */}
                             <button
                                onClick={handleDeleteChat}
                                className="flex items-center gap-1.5 bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md"
                                title="Hapus Chat & Reset User"
                             >
                                 <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                 </svg>
                             </button>

                             {/* MARK AS READ BUTTON */}
                             {selectedSession.isRead === false && (
                                 <button 
                                    onClick={handleMarkAsRead}
                                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-md animate-pulse"
                                 >
                                     <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                     </svg>
                                     Tandai Dibaca
                                 </button>
                             )}
                         </div>
                         <div className="text-xs text-slate-500 uppercase tracking-widest mt-1">Berbicara Dengan</div>
                         <div className="text-sm font-bold text-blue-400">{selectedSession.agentName}</div>
                    </div>
                </div>

                {/* Messages Area (Read Only) */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-900" style={{ backgroundImage: "radial-gradient(#1e293b 1px, transparent 1px)", backgroundSize: "20px 20px" }}>
                    {selectedSession.messages.length === 0 ? (
                        <div className="text-center py-10 opacity-30 text-white">Percakapan kosong.</div>
                    ) : (
                        selectedSession.messages.map((msg, i) => (
                            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm text-sm whitespace-pre-wrap ${msg.role === 'user' ? 'bg-[#005c4b] text-white rounded-tr-none' : 'bg-slate-700 text-slate-200 rounded-tl-none'}`}>
                                    {msg.images && msg.images.length > 0 && (
                                        <div className="mb-2 flex flex-wrap gap-2">
                                            {msg.images.map((img, idx) => <BlobImage key={idx} base64Src={img} />)}
                                        </div>
                                    )}
                                    {msg.text}
                                    <div className="text-[10px] text-right mt-1 opacity-50">
                                        {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                    <div ref={bottomRef} />
                </div>
             </>
         )}
      </div>
    </div>
  );
};

export default Inbox;
