
import React, { useState, useEffect, useRef } from 'react';
import { GeminiService, fileToGenerativePart } from '../services/geminiService';
import { db } from '../services/firebase';
import { ref, push, onValue, get, child, remove, update, set } from 'firebase/database';
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

interface TrainingProgress {
    lastProcessedId: string;
    timestamp: number;
    totalItems: number;
    processedCount: number;
}

const Knowledge: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  
  const [files, setFiles] = useState<File[]>([]);
  const [textInput, setTextInput] = useState('');
  const [saveImages, setSaveImages] = useState(true); // Default to saving images
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingType, setProcessingType] = useState<'analyze' | 'retrain' | null>(null); // Track operation type
  const [status, setStatus] = useState('');
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>([]);
  const [showRetrainModal, setShowRetrainModal] = useState(false); // Modal visibility state
  
  // Progress & Resume State
  const [savedProgress, setSavedProgress] = useState<TrainingProgress | null>(null);
  const stopRetrainRef = useRef(false); // Ref to signal loop interruption
  
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

  // 2. Load Knowledge & Progress specific to Selected Agent
  useEffect(() => {
    if (!selectedAgentId) {
        setKnowledgeList([]);
        setSavedProgress(null);
        return;
    }

    // Load Knowledge
    const kRef = ref(db, `knowledge/${selectedAgentId}`);
    const unsubKnowledge = onValue(kRef, (snapshot) => {
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

    // Load Saved Progress
    const progressRef = ref(db, `trainingProgress/${selectedAgentId}`);
    const unsubProgress = onValue(progressRef, (snapshot) => {
        const data = snapshot.val();
        setSavedProgress(data || null);
    });

    return () => {
        unsubKnowledge();
        unsubProgress();
    };
  }, [selectedAgentId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
      setAnalysisResult(null); // Reset previous analysis
    }
  };

  // Helper to fetch settings
  const getSettings = async (): Promise<AppSettings | null> => {
      try {
        const snapshot = await get(child(ref(db), 'settings'));
        if (snapshot.exists()) {
            return snapshot.val();
        }
      } catch (e) {
        console.error("Error fetching settings:", e);
      }
      return null;
  };

  const handleAnalyzeAndLearn = async () => {
    if (!selectedAgentId) {
        alert("Please select an Agent to train first.");
        return;
    }

    setIsProcessing(true);
    setProcessingType('analyze');
    setStatus('Fetching system settings...');
    setAnalysisResult(null);

    const settings = await getSettings();
    if (!settings || !settings.apiKeys || settings.apiKeys.length === 0) {
        alert("Please configure API Keys in Settings first!");
        setStatus("Error: No API Keys configured.");
        setIsProcessing(false);
        setProcessingType(null);
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
                let b64 = undefined;

                if (saveImages) {
                    setStatus(`Saving image ${i + 1} of ${imageFiles.length}: ${img.name}...`);
                    b64 = await compressImageForDb(img);
                } else {
                    setStatus(`Processing image ${i + 1} of ${imageFiles.length} (Analysis Only)...`);
                }
                
                // We append the filename to the summary so the AI knows WHICH image this is
                // e.g. "Front View.jpg - Context: This is a house..."
                const specificSummary = `[Image File: ${img.name}]\n${summary}`;

                await push(ref(db, `knowledge/${selectedAgentId}`), {
                    type: 'image',
                    originalName: img.name,
                    contentSummary: specificSummary,
                    rawContent: textInput,
                    imageData: b64 || null, // Store image data only if toggle is ON
                    timestamp: Date.now()
                });
            }
        }

        // 4. Save Master Text/PDF Entry
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
        setProcessingType(null);
    }
  };

  // 1. Opens the confirmation modal
  const handleRetrainClick = () => {
    if (!selectedAgentId || knowledgeList.length === 0) return;
    setShowRetrainModal(true);
  };
  
  // Handle Pause/Stop
  const handleStopRetrain = () => {
      if (confirm("Pause current training? Progress will be saved.")) {
          stopRetrainRef.current = true;
          setStatus("Stopping...");
      }
  };

  // 2. Executes the actual logic (called by Confirm button)
  const executeRetrain = async (resume: boolean = false) => {
    setShowRetrainModal(false); // Close modal
    stopRetrainRef.current = false;
    setIsProcessing(true);
    setProcessingType('retrain');
    setStatus('Initializing Re-training...');

    const settings = await getSettings();
    if (!settings || !settings.apiKeys || settings.apiKeys.length === 0) {
        alert("No API Keys found.");
        setIsProcessing(false);
        setProcessingType(null);
        return;
    }

    const gemini = new GeminiService(settings.apiKeys);
    const model = settings.selectedModel || GeminiModel.FLASH_3;

    try {
        let startIndex = 0;

        // If resuming, find where we left off
        if (resume && savedProgress && savedProgress.lastProcessedId) {
            // Because knowledgeList might be sorted by timestamp, we need to find the index of the ID
            const foundIndex = knowledgeList.findIndex(k => k.id === savedProgress.lastProcessedId);
            if (foundIndex !== -1) {
                startIndex = foundIndex + 1; // Start from next item
            }
        }

        // Reset progress if starting fresh
        if (!resume) {
            await set(ref(db, `trainingProgress/${selectedAgentId}`), {
                lastProcessedId: '',
                timestamp: Date.now(),
                totalItems: knowledgeList.length,
                processedCount: 0
            });
        }

        for (let i = startIndex; i < knowledgeList.length; i++) {
            // Check for Stop Signal
            if (stopRetrainRef.current) {
                setStatus("Training Paused. Progress saved.");
                setIsProcessing(false);
                return; // Exit loop, keeping progress in DB
            }

            const item = knowledgeList[i];
            setStatus(`Re-analyzing ${i + 1}/${knowledgeList.length}: ${item.originalName || 'Text Item'}...`);

            // 1. Prepare Content
            let filesToAnalyze: File[] = [];
            const contextText = item.rawContent || "";

            if (item.imageData && item.type === 'image') {
                try {
                    const res = await fetch(item.imageData);
                    const blob = await res.blob();
                    const file = new File([blob], item.originalName || "image.jpg", { type: blob.type });
                    filesToAnalyze.push(file);
                } catch (e) {
                    console.error("Failed to restore image for analysis", e);
                }
            }

            // 2. Prepare Prompt
            const prompt = `
                Re-analyze this specific database entry.
                Context provided by user: "${contextText}"
                Goal: Extract key facts, visual details (if image), and business logic.
                Output: A structured summary for an AI Agent Knowledge Base.
            `;

            // 3. Call AI
            const newSummary = await gemini.analyzeContent(model, prompt, filesToAnalyze);

            // 4. Update Database
            const finalSummary = item.type === 'image' && item.originalName 
                ? `[Image File: ${item.originalName}]\n${newSummary}`
                : newSummary;

            await update(ref(db, `knowledge/${selectedAgentId}/${item.id}`), {
                contentSummary: finalSummary,
            });

            // 5. UPDATE PROGRESS Checkpoint
            await update(ref(db, `trainingProgress/${selectedAgentId}`), {
                lastProcessedId: item.id,
                timestamp: Date.now(),
                totalItems: knowledgeList.length,
                processedCount: i + 1
            });
        }
        
        // Loop finished successfully
        setStatus('Re-training Complete! All data refreshed.');
        // Clear progress
        await remove(ref(db, `trainingProgress/${selectedAgentId}`));

    } catch (error: any) {
        console.error(error);
        setStatus(`Re-training Error: ${error.message}`);
    } finally {
        setIsProcessing(false);
        setProcessingType(null);
        stopRetrainRef.current = false;
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
    <div className="space-y-8 animate-fade-in relative">
      {/* --- RE-TRAIN MODAL --- */}
      {showRetrainModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all scale-100">
                <div className="p-6">
                    <div className="flex items-center space-x-3 mb-4 text-amber-400">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <h3 className="text-xl font-bold text-white">Re-Train Database</h3>
                    </div>
                    
                    {savedProgress ? (
                        <div className="mb-6 bg-slate-900/80 p-4 rounded-lg border border-slate-700">
                             <p className="text-slate-300 mb-2">
                                 Found saved progress:
                             </p>
                             <div className="w-full bg-slate-700 h-2 rounded-full mb-2">
                                 <div 
                                    className="bg-green-500 h-2 rounded-full" 
                                    style={{ width: `${Math.round((savedProgress.processedCount / savedProgress.totalItems) * 100)}%` }}
                                 ></div>
                             </div>
                             <p className="text-xs text-slate-400">
                                 Processed {savedProgress.processedCount} of {savedProgress.totalItems} items.
                             </p>
                             <div className="mt-4 flex flex-col gap-2">
                                <button
                                    onClick={() => executeRetrain(true)}
                                    className="w-full py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold text-sm"
                                >
                                    Resume from Item {savedProgress.processedCount + 1}
                                </button>
                                <button
                                    onClick={() => executeRetrain(false)}
                                    className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-sm"
                                >
                                    Restart from Beginning (0%)
                                </button>
                             </div>
                        </div>
                    ) : (
                        <p className="text-slate-300 mb-6 leading-relaxed">
                            Are you sure you want to re-analyze <strong>{knowledgeList.length} items</strong>?
                            <br/><br/>
                            <span className="text-xs bg-slate-900/80 p-3 rounded border border-slate-700 block text-slate-400">
                                ⚠️ This will re-process every image and text in this agent's database using your current API quota.
                            </span>
                        </p>
                    )}

                    <div className="flex space-x-3 justify-end mt-4 border-t border-slate-700 pt-4">
                        <button
                            onClick={() => setShowRetrainModal(false)}
                            className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-700 transition-colors font-medium"
                        >
                            Cancel
                        </button>
                        {!savedProgress && (
                            <button
                                onClick={() => executeRetrain(false)}
                                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 text-white font-bold shadow-lg shadow-purple-900/30 flex items-center"
                            >
                                <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                Start Re-Training
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
      )}

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
                    disabled={isProcessing}
                    className={`flex items-center space-x-3 px-4 py-3 rounded-lg border min-w-[200px] transition-all ${
                        selectedAgentId === agent.id 
                        ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500' 
                        : 'bg-slate-900 border-slate-700 hover:bg-slate-700'
                    } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
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
            <div className={`bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl relative overflow-hidden transition-opacity ${isProcessing && processingType === 'retrain' ? 'opacity-50 pointer-events-none' : ''}`}>
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
                    <div className={`relative border-2 border-dashed border-slate-600 rounded-lg p-6 hover:bg-slate-700/50 transition-colors text-center group ${isProcessing ? 'cursor-not-allowed opacity-50 bg-slate-900/50' : ''}`}>
                        <input 
                            type="file" 
                            multiple 
                            accept=".pdf,image/*"
                            onChange={handleFileChange} 
                            disabled={isProcessing}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                        />
                        <div className="pointer-events-none">
                            <svg className="mx-auto h-10 w-10 text-slate-400 mb-2 group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            <p className="text-sm text-slate-300">
                                {files.length > 0 
                                    ? `${files.length} files selected` 
                                    : (isProcessing ? "Processing..." : "Click or Drag PDFs / Images here")}
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
                        disabled={isProcessing}
                        className={`w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-32 ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                        placeholder="e.g., 'This is the new Promo Poster set for March...'"
                    />
                </div>
                
                {/* Save Images Toggle */}
                {files.some(f => f.type.startsWith('image/')) && (
                    <div className={`mb-6 bg-slate-900/50 p-3 rounded-lg border border-slate-700/50 flex items-center justify-between ${isProcessing ? 'opacity-50' : ''}`}>
                        <div>
                            <span className="block text-sm font-bold text-white">Save Images to Database?</span>
                            <span className="text-xs text-slate-400">
                                {saveImages 
                                    ? "ON: Images will be stored. AI can send them to users." 
                                    : "OFF: AI analyzes images but doesn't store the file."}
                            </span>
                        </div>
                        <button
                            onClick={() => !isProcessing && setSaveImages(!saveImages)}
                            disabled={isProcessing}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${saveImages ? 'bg-green-500' : 'bg-slate-600'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${saveImages ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                )}

                <button
                    onClick={handleAnalyzeAndLearn}
                    disabled={isProcessing || !selectedAgentId || (files.length === 0 && !textInput.trim())}
                    className={`w-full py-3 rounded-lg font-bold text-lg shadow-lg flex justify-center items-center transition-all ${
                        isProcessing || !selectedAgentId
                        ? 'bg-slate-600 cursor-not-allowed' 
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transform hover:scale-[1.02]'
                    }`}
                >
                    {isProcessing && processingType === 'analyze' ? (
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
            <div className="flex justify-between items-center mb-2">
                <h3 className="text-xl font-bold text-white flex items-center">
                    <svg className="w-5 h-5 mr-2 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Knowledge Base
                </h3>
                {knowledgeList.length > 0 && selectedAgentId && (
                    <button
                        onClick={isProcessing ? handleStopRetrain : handleRetrainClick}
                        className={`text-xs px-4 py-2 rounded-lg transition-all flex items-center border font-semibold shadow-md active:scale-95 ${
                            isProcessing && processingType === 'retrain'
                            ? 'bg-red-900/50 text-red-300 border-red-800 hover:bg-red-800'
                            : savedProgress
                                ? 'bg-green-600 text-white border-green-500 hover:bg-green-500' // Resume Look
                                : 'bg-purple-600 text-white border-purple-500 hover:bg-purple-500' // Default Look
                        }`}
                        title={savedProgress ? "Continue Previous Training" : "Re-analyze all existing data"}
                    >
                        {isProcessing && processingType === 'retrain' ? (
                            <>
                                <svg className="animate-spin -ml-1 mr-2 h-3 w-3 text-red-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                                {status.includes('Re-analyzing') ? (
                                    <span>Stop ({status.split(':')[0].replace('Re-analyzing ', '')})</span>
                                ) : 'Pause / Stop'}
                            </>
                        ) : (
                            <>
                                {savedProgress ? (
                                    <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                ) : (
                                    <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                )}
                                {savedProgress ? 'Resume Training' : 'Re-Train All Data'}
                            </>
                        )}
                    </button>
                )}
            </div>
            
            <div className={`space-y-4 h-[700px] overflow-y-auto pr-2 scrollbar-thin ${isProcessing && processingType === 'retrain' ? 'opacity-70 pointer-events-none' : ''}`}>
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
