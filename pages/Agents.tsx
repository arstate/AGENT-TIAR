import React, { useEffect, useState } from 'react';
import { ref, onValue, push, remove } from 'firebase/database';
import { db } from '../services/firebase';
import { Agent } from '../types';

const Agents: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [personality, setPersonality] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const agentsRef = ref(db, 'agents');
    const unsubscribe = onValue(agentsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list: Agent[] = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));
        setAgents(list);
      } else {
        setAgents([]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleAddAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !role) return;

    // Random simple avatar color
    const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];

    await push(ref(db, 'agents'), {
      name,
      role,
      personality,
      avatar: randomColor,
    });

    setName('');
    setRole('');
    setPersonality('');
  };

  const deleteAgent = async (id: string) => {
    await remove(ref(db, `agents/${id}`));
  };

  return (
    <div className="space-y-6">
       <div className="border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white">AI Agents Team</h2>
        <p className="text-slate-400 mt-2">Create specialized agents to handle different tasks.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create Agent Form */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 sticky top-6">
            <h3 className="text-lg font-bold mb-4 text-white">Create New Agent</h3>
            <form onSubmit={handleAddAgent} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Agent Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 outline-none"
                  placeholder="e.g., Support Bot"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Role / Job Description</label>
                <input
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 outline-none"
                  placeholder="e.g., Expert Javascript Developer"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Personality</label>
                <textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:border-blue-500 outline-none h-24 resize-none"
                  placeholder="e.g., Friendly, concise, professional, uses emojis..."
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-2 px-4 rounded-lg transition-colors"
              >
                + Add Agent
              </button>
            </form>
          </div>
        </div>

        {/* Agent List */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <div className="text-slate-400">Loading agents...</div>
          ) : agents.length === 0 ? (
             <div className="text-slate-500 italic p-4 bg-slate-800/50 rounded-lg border border-slate-700">No agents defined yet.</div>
          ) : (
            agents.map((agent) => (
              <div key={agent.id} className="bg-slate-800 p-5 rounded-xl border border-slate-700 flex items-start space-x-4 hover:border-slate-600 transition-colors">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg ${agent.avatar || 'bg-gray-500'}`}>
                  {agent.name.substring(0, 1).toUpperCase()}
                </div>
                <div className="flex-1">
                  <div className="flex justify-between items-start">
                    <h4 className="text-lg font-bold text-white">{agent.name}</h4>
                    <button
                      onClick={() => deleteAgent(agent.id)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-blue-400 text-sm font-medium mb-1">{agent.role}</p>
                  {agent.personality && (
                     <p className="text-slate-400 text-sm italic">"{agent.personality}"</p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default Agents;