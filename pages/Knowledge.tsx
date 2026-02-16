
import React, { useState, useEffect } from 'react';
import { GeminiService, fileToGenerativePart } from '../services/geminiService';
import { db } from '../services/firebase';
import { ref, push, onValue, get, child, remove } from 'firebase/database';
import { GeminiModel, KnowledgeItem, AppSettings, Agent } from '../types';

// Helper: Compress Image for Database Storage
const compressImageForDb = async (file: File): Promise<string> => {
    if (!file.type.startsWith('image/')) return '';
    return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            // Resize if too large (max 1000px width/height) to save DB space
            const maxDim = 1000;
            let width = img.width;
            let height = img.height;
            if (width > maxDim || height > maxDim) {
                if (width > height) {
                    height = Math.round((height * maxDim) / width);
                    width = maxDim;
                } else {
                    width = Math.round((width * maxDim) / height);
                    height = maxDim;
                }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if(ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                // Convert to JPEG with compression
                const dataUrl = canvas.toDataURL('image/jpeg', 0.7); 
                resolve(dataUrl); 
            } else {
                resolve('');
            }
            URL.revokeObjectURL(url);
        };
        img.onerror = () => resolve('');
        img.src = url;
    });
};

const Knowledge: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  
  const [files, setFiles] = useState<File[]>([]);
  const [textInput, setTextInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>([]);
  
  // Analysis Result State (Ainanalisa)
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

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
      setAnalysisResult(null); // Reset previous analysis
    }
  };

  const handleAnalyzeAndLearn = async () => {
    if (!selectedAgentId) {
        alert("Please select an Agent to train first.");
        return;
    }

    setIsProcessing(true);
    setStatus('Fetching system settings...');
    setAnalysisResult(null);

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

    setStatus('Initializing AI Analysis...');

    const gemini = new GeminiService(settings.apiKeys);
    const model = settings.selectedModel || GeminiModel.FLASH_3;

    try {
        // Prompt strategy: Ask AI to extract facts
        const prompt = `
            Perform a deep analysis of the provided content (PDF, Images, or Text).
            
            Goal: Extract key facts, business logic, data points, or structural information.
            Output: A structured summary that serves as a "Knowledge Base" entry for an AI Agent.
            
            Format: Clear, concise points. Do not use conversational filler.
            
            ${textInput ? `User Context/Notes: ${textInput}` : ''}
        `;

        setStatus(files.length > 0 ? `Analyzing ${files.length} files (PDF/Images) with ${model}...` : 'Analyzing text...');
        
        // 1. Analyze ALL content together to get the shared context/facts
        const summary = await gemini.analyzeContent(model, prompt, files);
        setAnalysisResult(summary); // Show "Ainanalisa" result

        setStatus('Processing data for storage...');

        // 2. Separate files by type
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        const otherFiles = files.filter(f => !f.type.startsWith('image/'));

        // 3. Save ALL Images individually
        // This ensures "unlimited" images can be stored and retrieved by ID
        if (imageFiles.length > 0) {
            for (let i = 0; i < imageFiles.length; i++) {
                const img = imageFiles[i];
                setStatus(`Saving image ${i + 1} of ${imageFiles.length}: ${img.name}...`);
                
                const b64 = await compressImageForDb(img);
                
                // We append the filename to the summary so the AI knows WHICH image this is
                // e.g. "Front View.jpg - Context: This is a house..."
                const specificSummary = `[Image File: ${img.name}]\n${summary}`;

                await push(ref(db, `knowledge/${selectedAgentId}`), {
                    type: 'image',
                    originalName: img.name,
                    contentSummary: specificSummary,
                    rawContent: textInput,
                    imageData: b64,
                    timestamp: Date.now()
                });
            }
        }

        // 4. Save Master Text/PDF Entry
        // If there were PDFs or Text, save a dedicated entry for the "Facts" without an image attached
        // This ensures the textual knowledge exists even if we didn't upload images, 
        // OR if we did upload images, this serves as the "Master Document" reference.
        if (otherFiles.length > 0 || textInput.trim() || imageFiles.length === 0) {
             setStatus('Saving analysis text...');
             await push(ref(db, `knowledge/${selectedAgentId}`), {
                type: otherFiles.length > 0 ? 'file' : 'text',
                originalName: otherFiles.length > 0 ? otherFiles.map(f => f.name).join(', ') : 'Text Input',
                contentSummary: summary,
                rawContent: textInput,
                timestamp: Date.now()
            });
        }

        setStatus('Analysis Complete & All Data Saved!');
        setTextInput('');
        setFiles([]);
        
    } catch (error: any) {
        console.error(error);
        setStatus(`Analysis Error: ${error.message || 'Failed'}`);
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
    <div className="space-y-8 animate-fade-in">
      <div className="border-b border-slate-700 pb-4 flex justify-between items-end">
        <div>
            <h2 className="text-3xl font-bold text-white">AI Analysis & Training</h2>
            <p className="text-slate-400 mt-2">Upload PDFs, Images, or Text. The AI can memorize multiple images and send them to users!</p>
        </div>
      </div>

      {/* Agent Selector */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <label className="block text-sm font-medium text-slate-400 mb-2">Select Agent to Train</label>
          <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
            {agents.length === 0 && <p className="text-slate-500 italic">No agents found. Create one in 'Agents' tab.</p>}
            {agents.map(agent => (
                <button
                    key={agent.id}
                    onClick={() => { setSelectedAgentId(agent.id); setAnalysisResult(null); }}
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
                {/* Visual indicator */}
                {currentAgent && (
                    <div className="absolute top-0 right-0 p-2 bg-blue-600/10 rounded-bl-xl border-b border-l border-blue-500/30">
                        <span className="text-xs text-blue-300 font-mono">Target: {currentAgent.name}</span>
                    </div>
                )}

                <h3 className="text-xl font-bold mb-4 text-white flex items-center">
                    <svg className="w-5 h-5 mr-2 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    Input Data
                </h3>
                
                {/* File Drop Area */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                        Upload Files (PDF, Images)
                    </label>
                    <div className="relative border-2 border-dashed border-slate-600 rounded-lg p-6 hover:bg-slate-700/50 transition-colors text-center group">
                        <input 
                            type="file" 
                            multiple 
                            accept=".pdf,image/*"
                            onChange={handleFileChange} 
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                        />
                        <div className="pointer-events-none">
                            <svg className="mx-auto h-10 w-10 text-slate-400 mb-2 group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-sm text-slate-300">
                                {files.length > 0 
                                    ? `${files.length} files selected` 
                                    : "Click or Drag PDFs / Images here"}
                            </p>
                            {files.length > 0 && (
                                <ul className="text-xs text-blue-300 mt-2">
                                    {files.map((f, i) => <li key={i}>{f.name}</li>)}
                                </ul>
                            )}
                        </div>
                    </div>
                </div>

                {/* Text Area */}
                <div className="mb-6">
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                        Additional Context / Text
                    </label>
                    <textarea 
                        value={textInput}
                        onChange={(e) => setTextInput(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-32"
                        placeholder="e.g., 'This is the new Promo Poster set for March...'"
                    />
                </div>

                <button
                    onClick={handleAnalyzeAndLearn}
                    disabled={isProcessing || !selectedAgentId || (files.length === 0 && !textInput.trim())}
                    className={`w-full py-3 rounded-lg font-bold text-lg shadow-lg flex justify-center items-center transition-all ${
                        isProcessing || !selectedAgentId
                        ? 'bg-slate-600 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transform hover:scale-[1.02]'
                    }`}
                >
                    {isProcessing ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {status || 'Analyzing & Learning...'}
                        </>
                    ) : (
                        'Analyze & Learn Data'
                    )}
                </button>
            </div>
            
            {/* Analysis Result (Ainanalisa View) */}
            {analysisResult && (
                <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-6 rounded-xl border border-green-500/50 shadow-lg animate-fade-in-up">
                    <h3 className="text-lg font-bold text-green-400 mb-2 flex items-center">
                        <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Analysis Result
                    </h3>
                    <div className="bg-black/30 rounded p-4 text-sm text-slate-200 whitespace-pre-wrap font-mono border border-slate-700/50 max-h-60 overflow-y-auto">
                        {analysisResult}
                    </div>
                    <p className="text-xs text-slate-500 mt-2 italic text-right">This data and images have been saved to the agent's knowledge base.</p>
                </div>
            )}
        </div>

        {/* Learned Data List */}
        <div className="space-y-4">
            <h3 className="text-xl font-bold text-white mb-2 flex items-center">
                <svg className="w-5 h-5 mr-2 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                Knowledge Base
            </h3>
            <div className="space-y-4 h-[700px] overflow-y-auto pr-2 scrollbar-thin">
                {knowledgeList.length === 0 ? (
                    <div className="text-slate-500 text-center py-10 border border-slate-700 rounded-xl border-dashed">
                        {selectedAgentId ? "This agent hasn't learned anything yet." : "Select an agent to see their knowledge."}
                    </div>
                ) : (
                    knowledgeList.map(item => (
                        <div key={item.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700 group hover:border-slate-500 transition-colors relative">
                            <div className="flex justify-between items-start mb-2">
                                <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${item.type === 'file' ? 'bg-purple-900/50 text-purple-200 border border-purple-700' : 'bg-blue-900/50 text-blue-200 border border-blue-700'}`}>
                                    {item.type}
                                </span>
                                <div className="flex items-center space-x-3">
                                    <span className="text-xs text-slate-500">
                                        {new Date(item.timestamp).toLocaleDateString()}
                                    </span>
                                    <button 
                                        onClick={() => handleDeleteKnowledge(item.id)}
                                        title="Delete Data"
                                        className="text-slate-600 hover:text-red-500 transition-colors opacity-50 hover:opacity-100"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <h4 className="font-semibold text-slate-200 mb-1 pr-6 flex items-center">
                                {item.originalName || 'Text Snippet'}
                                {item.type === 'file' && item.originalName?.toLowerCase().includes('.pdf') && (
                                     <span className="ml-2 text-[10px] bg-red-900/40 text-red-300 px-1 rounded">PDF</span>
                                )}
                            </h4>
                            <p className="text-sm text-slate-400 line-clamp-4 bg-slate-900/50 p-2 rounded border border-slate-700/50">
                                {item.contentSummary}
                            </p>
                            {item.imageData && (
                                <div className="mt-2">
                                    <img src={item.imageData} alt="Saved" className="h-16 rounded border border-slate-600 object-cover" />
                                </div>
                            )}
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
