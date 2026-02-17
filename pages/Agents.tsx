
import React, { useEffect, useState } from 'react';
import { ref, onValue, push, remove, update } from 'firebase/database';
import { db } from '../services/firebase';
import { Agent } from '../types';

const Agents: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [personality, setPersonality] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [slug, setSlug] = useState(''); // New state for custom link
  const [loading, setLoading] = useState(true);
  
  // State to track editing mode
  const [editingId, setEditingId] = useState<string | null>(null);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !role) return;

    // Simple slug validation: replace spaces with dashes, lowercase
    const cleanSlug = slug.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    const agentData = {
      name,
      role,
      personality,
      isPublic,
      slug: cleanSlug || null // If empty, save as null
    };

    if (editingId) {
      // Update existing agent
      const agentRef = ref(db, `agents/${editingId}`);
      await update(agentRef, agentData);
      setEditingId(null);
    } else {
      // Create new agent
      const colors = ['bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-yellow-500'];
      const randomColor = colors[Math.floor(Math.random() * colors.length)];

      await push(ref(db, 'agents'), {
        ...agentData,
        avatar: randomColor,
      });
    }

    // Reset form
    resetForm();
  };

  const resetForm = () => {
    setName('');
    setRole('');
    setPersonality('');
    setIsPublic(false);
    setSlug('');
    setEditingId(null);
  };

  const handleEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setName(agent.name);
    setRole(agent.role);
    setPersonality(agent.personality);
    setIsPublic(agent.isPublic || false);
    setSlug(agent.slug || '');
  };

  const handleCancelEdit = () => {
    resetForm();
  };

  const deleteAgent = async (id: string) => {
    if (confirm('Are you sure you want to delete this agent?')) {
      await remove(ref(db, `agents/${id}`));
      if (editingId === id) {
        resetForm();
      }
    }
  };

  const copyPublicLink = (agent: Agent) => {
      // Use slug if available, otherwise use ID
      const linkId = agent.slug || agent.id;
      const url = `${window.location.origin}/#/chat/${linkId}`;
      navigator.clipboard.writeText(url);
      alert("Link copied: " + url);
  };

  return (
    <div className="space-y-6">
       <div className="border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white">AI Agents Team</h2>
        <p className="text-slate-400 mt-2">Create and manage specialized agents.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Create/Edit Agent Form */}
        <div className="lg:col-span-1">
          <div className={`p-6 rounded-xl border sticky top-6 transition-colors ${editingId ? 'bg-blue-900/20 border-blue-500' : 'bg-slate-800 border-slate-700'}`}>
            <h3 className="text-lg font-bold mb-4 text-white flex items-center">
              {editingId ? 'Edit Agent' : 'Create New Agent'}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Basic Info */}
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
                  placeholder="e.g., Friendly, concise..."
                />
              </div>

              {/* ONLINE CONFIGURATION SECTION */}
              <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-700/50 pb-2">
                      <div>
                          <span className="block text-sm font-bold text-green-400">Pengaturan Agent Online</span>
                          <span className="text-[10px] text-slate-500">Publish to Public Directory</span>
                      </div>
                      <button 
                        type="button"
                        onClick={() => setIsPublic(!isPublic)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isPublic ? 'bg-green-500' : 'bg-slate-600'}`}
                      >
                          <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPublic ? 'translate-x-6' : 'translate-x-1'}`} />
                      </button>
                  </div>

                  {isPublic && (
                      <div className="animate-fade-in">
                          <label className="block text-xs font-medium text-slate-400 mb-1">Isi Link Agent (Custom Slug)</label>
                          <div className="flex items-center">
                              <span className="bg-slate-800 border border-r-0 border-slate-600 text-slate-500 text-xs px-2 py-2.5 rounded-l-lg">
                                  .../#/chat/
                              </span>
                              <input
                                type="text"
                                value={slug}
                                onChange={(e) => setSlug(e.target.value)}
                                className="flex-1 bg-slate-800 border border-slate-600 rounded-r-lg px-3 py-2 text-white text-sm focus:border-green-500 outline-none font-mono"
                                placeholder={editingId || "my-agent-name"}
                              />
                          </div>
                          <p className="text-[10px] text-slate-500 mt-1">
                              Preview: {window.location.origin}/#/chat/{slug || (editingId ? editingId : '...')}
                          </p>
                      </div>
                  )}
              </div>
              
              <div className="flex gap-2">
                <button
                  type="submit"
                  className={`flex-1 font-bold py-2 px-4 rounded-lg transition-colors ${editingId ? 'bg-green-600 hover:bg-green-500' : 'bg-blue-600 hover:bg-blue-500'} text-white`}
                >
                  {editingId ? 'Update Agent' : '+ Add Agent'}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    className="bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold py-2 px-4 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
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
              <div key={agent.id} className={`p-5 rounded-xl border flex flex-col md:flex-row items-start space-y-4 md:space-y-0 md:space-x-4 transition-all ${editingId === agent.id ? 'bg-slate-800 border-blue-500 ring-1 ring-blue-500' : 'bg-slate-800 border-slate-700 hover:border-slate-600'}`}>
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-lg flex-shrink-0 ${agent.avatar || 'bg-gray-500'}`}>
                  {agent.name.substring(0, 1).toUpperCase()}
                </div>
                <div className="flex-1 w-full">
                  <div className="flex justify-between items-start">
                    <div>
                        <h4 className="text-lg font-bold text-white flex items-center gap-2">
                            {agent.name}
                            {agent.isPublic && <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded border border-green-500/30">ONLINE</span>}
                        </h4>
                        <p className="text-blue-400 text-sm font-medium mb-1">{agent.role}</p>
                    </div>
                    <div className="flex space-x-1">
                      <button onClick={() => handleEdit(agent)} title="Edit Agent" className="text-slate-500 hover:text-blue-400 p-2 rounded hover:bg-slate-700/50 transition-colors">
                         <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                      </button>
                      <button onClick={() => deleteAgent(agent.id)} title="Delete Agent" className="text-slate-500 hover:text-red-400 p-2 rounded hover:bg-slate-700/50 transition-colors">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  </div>
                  
                  {agent.isPublic && (
                      <div className="mt-3 bg-black/30 rounded p-2 flex items-center justify-between gap-2 border border-slate-700/50">
                          <code className="text-xs text-slate-400 truncate flex-1 font-mono">
                              {window.location.origin}/#/chat/{agent.slug || agent.id}
                          </code>
                          <button onClick={() => copyPublicLink(agent)} className="text-xs bg-slate-700 hover:bg-slate-600 text-white px-2 py-1 rounded transition-colors flex-shrink-0">
                              Copy Link
                          </button>
                      </div>
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
