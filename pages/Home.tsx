
import React, { useEffect, useState } from 'react';
import { db } from '../services/firebase';
import { ref, onValue } from 'firebase/database';
import { Agent } from '../types';
import { Link } from 'react-router-dom';

const Home: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const agentsRef = ref(db, 'agents');
    const unsubscribe = onValue(agentsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: Agent[] = Object.keys(data)
          .map((key) => ({ id: key, ...data[key] }))
          .filter((agent) => agent.isPublic); // Only show Public agents
        setAgents(list);
      } else {
        setAgents([]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Jika tidak ada agent online, tampilkan halaman kosong (atau pesan minimalis)
  if (agents.length === 0) {
    return (
      <div className="min-h-screen bg-[#0f172a] flex flex-col items-center justify-center text-slate-500 p-4">
        <div className="w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4">
             <svg className="w-8 h-8 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
             </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-400">No Agents Online</h1>
        <p className="text-sm mt-2">Please check back later.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-12 text-center">
           <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400 tracking-tight mb-4">
             AI Agents Directory
           </h1>
           <p className="text-slate-400 text-lg">Chat with our specialized AI assistants available online.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents.map((agent) => (
            <Link 
              to={`/chat/${agent.id}`} 
              key={agent.id}
              className="group bg-slate-800/50 hover:bg-slate-800 border border-slate-700 hover:border-blue-500/50 rounded-2xl p-6 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1 relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 p-4 opacity-50 group-hover:opacity-100 transition-opacity">
                  <svg className="w-6 h-6 text-slate-600 group-hover:text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
              </div>

              <div className="flex items-start gap-4 mb-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-xl shadow-lg ${agent.avatar || 'bg-blue-600'} group-hover:scale-110 transition-transform duration-300`}>
                  {agent.name.substring(0, 1).toUpperCase()}
                </div>
                <div>
                   <h2 className="text-xl font-bold text-white group-hover:text-blue-400 transition-colors">{agent.name}</h2>
                   <div className="flex items-center gap-2 mt-1">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                      <span className="text-xs text-green-400 font-medium">Online Now</span>
                   </div>
                </div>
              </div>

              <p className="text-slate-400 text-sm line-clamp-3 mb-6 min-h-[60px]">
                {agent.role}
              </p>

              <div className="w-full py-3 bg-slate-900/50 group-hover:bg-blue-600 rounded-xl text-center text-sm font-bold text-slate-300 group-hover:text-white transition-colors">
                Start Conversation
              </div>
            </Link>
          ))}
        </div>
        
        <footer className="mt-20 text-center text-slate-600 text-sm">
            &copy; {new Date().getFullYear()} AgenAI Platform. All rights reserved.
        </footer>
      </div>
    </div>
  );
};

export default Home;
