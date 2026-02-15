import React, { useState, useEffect } from 'react';
import { GeminiService } from '../services/geminiService';
import { db } from '../services/firebase';
import { ref, push, onValue, get, child, remove } from 'firebase/database';
import { GeminiModel, KnowledgeItem, AppSettings, Agent } from '../types';

const Knowledge: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  
  const [files, setFiles] = useState<File[]>([]);
  const [textInput, setTextInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>([]);

  // 1. Load Agents
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
        if (list.length > 0 && !selectedAgentId) {
            setSelectedAgentId(list[0].id);
        }
      } else {
        setAgents([]);
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. Load Knowledge specific to Selected Agent
  useEffect(() => {
    if (!selectedAgentId) {
        setKnowledgeList([]);
        return;
    }

    const kRef = ref(db, `knowledge/${selectedAgentId}`);
    const unsub = onValue(kRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const list = Object.keys(data).map(key => ({
                id: key,
                agentId: selectedAgentId,
                ...data[key]
            })).sort((a,b) => b.timestamp - a.timestamp);
            setKnowledgeList(list);
        } else {
            setKnowledgeList([]);
        }
    });
    return () => unsub();
  }, [selectedAgentId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleLearn = async () => {
    if (!selectedAgentId) {
        alert("Please select an Agent to train first.");
        return;
    }

    setIsProcessing(true);
    setStatus('Fetching settings...');

    // Fetch settings from Firebase
    let settings: AppSettings | null = null;
    try {
        const snapshot = await get(child(ref(db), 'settings'));
        if (snapshot.exists()) {
            settings = snapshot.val();
        }
    } catch (e) {
        console.error("Error fetching settings:", e);
        setStatus("Error: Could not connect to database.");
        setIsProcessing(false);
        return;
    }

    if (!settings || !settings.apiKeys || settings.apiKeys.length === 0) {
        alert("Please configure API Keys in Settings first!");
        setStatus("Error: No API Keys configured.");
        setIsProcessing(false);
        return;
    }

    setStatus('Initializing AI...');

    const gemini = new GeminiService(settings.apiKeys);
    const model = settings.selectedModel || GeminiModel.FLASH_3;

    try {
        let contentToAnalyze = textInput;

        // Prompt strategy: Ask AI to extract facts
        const prompt = `
            Analyze the following content (text or attachments). 
            Extract key facts, rules, business logic, or important information.
            Summarize it into a clean, knowledge-base format that an AI agent can use to answer questions later.
            Do not include conversational filler, just the raw useful information.
            
            ${textInput ? `Additional User Context: ${textInput}` : ''}
        `;

        setStatus(files.length > 0 ? `Analyzing ${files.length} files with ${model}...` : 'Analyzing text...');
        
        const summary = await gemini.analyzeContent(model, prompt, files);

        setStatus('Saving to Realtime Database...');

        // Save result to Firebase under the SPECIFIC AGENT ID
        await push(ref(db, `knowledge/${selectedAgentId}`), {
            type: files.length > 0 ? 'file' : 'text',
            originalName: files.length > 0 ? files.map(f => f.name).join(', ') : 'Manual Input',
            contentSummary: summary,
            rawContent: textInput,
            timestamp: Date.now()
        });

        setStatus('Success! Knowledge added to Agent.');
        setTextInput('');
        setFiles([]);
        
    } catch (error: any) {
        console.error(error);
        setStatus(`Error: ${error.message || 'Analysis failed'}`);
    } finally {
        setIsProcessing(false);
    }
  };

  const handleDeleteKnowledge = async (knowledgeId: string) => {
    if (!selectedAgentId) return;
    
    if (window.confirm("Are you sure you want to delete this learned data? The agent will forget this information.")) {
        try {
            await remove(ref(db, `knowledge/${selectedAgentId}/${knowledgeId}`));
        } catch (error) {
            console.error("Error deleting knowledge:", error);
            alert("Failed to delete data.");
        }
    }
  };

  const currentAgent = agents.find(a => a.id === selectedAgentId);

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white">Train Your Agent</h2>
        <p className="text-slate-400 mt-2">Upload specific documents or instructions for a specific agent.</p>
      </div>

      {/* Agent Selector */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <label className="block text-sm font-medium text-slate-400 mb-2">Select Agent to Train</label>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {agents.length === 0 && <p className="text-slate-500 italic">No agents found. Create one first.</p>}
            {agents.map(agent => (
                <button
                    key={agent.id}
                    onClick={() => setSelectedAgentId(agent.id)}
                    className={`flex items-center space-x-3 px-4 py-3 rounded-lg border min-w-[200px] transition-all ${
                        selectedAgentId === agent.id 
                        ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500' 
                        : 'bg-slate-900 border-slate-700 hover:bg-slate-700'
                    }`}
                >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs ${agent.avatar || 'bg-gray-500'}`}>
                        {agent.name[0]}
                    </div>
                    <div className="text-left">
                        <div className="font-semibold text-white text-sm">{agent.name}</div>
                        <div className="text-xs text-slate-400 truncate w-24">{agent.role}</div>
                    </div>
                </button>
            ))}
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Input Section */}
        <div className="space-y-6">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl relative overflow-hidden">
                {/* Visual indicator of which agent is being trained */}
                {currentAgent && (
                    <div className="absolute top-0 right-0 p-2 bg-blue-600/10 rounded-bl-xl border-b border-l border-blue-500/30">
                        <span className="text-xs text-blue-300 font-mono">Training: {currentAgent.name}</span>
                    </div>
                )}

                <h3 className="text-xl font-bold mb-4 text-white">Input Data</h3>
                
                {/* File Drop Area */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                        Files (Images, PDF, Text)
                    </label>
                    <div className="relative border-2 border-dashed border-slate-600 rounded-lg p-6 hover:bg-slate-700/50 transition-colors text-center">
                        <input 
                            type="file" 
                            multiple 
                            onChange={handleFileChange} 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="pointer-events-none">
                            <svg className="mx-auto h-10 w-10 text-slate-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                            <p className="text-sm text-slate-300">
                                {files.length > 0 
                                    ? `${files.length} files selected` 
                                    : "Click or drag files here"}
                            </p>
                            {files.length > 0 && (
                                <ul className="text-xs text-slate-500 mt-2">
                                    {files.map((f, i) => <li key={i}>{f.name}</li>)}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>

                {/* Text Area */}
                <div className="mb-6">
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                        Or Paste Text / Instructions
                    </label>
                    <textarea 
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-32"
                        placeholder="Paste business rules, FAQs, or any text here..."
                    />
                </div>

                <button
                    onClick={handleLearn}
                    disabled={isProcessing || !selectedAgentId || (files.length === 0 && !textInput.trim())}
                    className={`w-full py-3 rounded-lg font-bold text-lg shadow-lg flex justify-center items-center ${
                        isProcessing || !selectedAgentId
                        ? 'bg-slate-600 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white'
                    }`}
                >
                    {isProcessing ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Processing...
                        </>
                    ) : (
                        'Analyze & Learn'
                    )}
                </button>
                {status && <p className={`mt-3 text-center text-sm ${status.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>{status}</p>}
            </div>
        </div>

        {/* Learned Data List */}
        <div className="space-y-4">
            <h3 className="text-xl font-bold text-white mb-2">
                Knowledge for: <span className="text-blue-400">{currentAgent?.name || '...'}</span>
            </h3>
            <div className="space-y-4 h-[600px] overflow-y-auto pr-2">
                {knowledgeList.length === 0 ? (
                    <div className="text-slate-500 text-center py-10 border border-slate-700 rounded-xl border-dashed">
                        {selectedAgentId ? "This agent hasn't learned anything yet." : "Select an agent to see their knowledge."}
                    </div>
                ) : (
                    knowledgeList.map(item => (
                        <div key={item.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700 group hover:border-slate-500 transition-colors relative">
                            <div className="flex justify-between items-start mb-2">
                                <span className={`text-xs px-2 py-1 rounded font-bold uppercase ${item.type === 'file' ? 'bg-purple-900 text-purple-200' : 'bg-blue-900 text-blue-200'}`}>
                                    {item.type}
                                </span>
                                <div className="flex items-center space-x-3">
                                    <span className="text-xs text-slate-500">
                                        {new Date(item.timestamp).toLocaleDateString()}
                                    </span>
                                    <button 
                                        onClick={() => handleDeleteKnowledge(item.id)}
                                        title="Delete Data"
                                        className="text-slate-600 hover:text-red-500 transition-colors"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <h4 className="font-semibold text-slate-200 mb-1 pr-6">{item.originalName || 'Text Snippet'}</h4>
                            <p className="text-sm text-slate-400 line-clamp-4 bg-slate-900/50 p-2 rounded">
                                {item.contentSummary}
                            </p>
                        </div>
                    ))
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default Knowledge;