
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
    targetIds?: string[]; // New: store which IDs were being retrained
}

const Knowledge: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  
  const [files, setFiles] = useState<File[]>([]);
  const [textInput, setTextInput] = useState('');
  const [saveImages, setSaveImages] = useState(true); 
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingType, setProcessingType] = useState<'analyze' | 'retrain' | null>(null); 
  const [status, setStatus] = useState('');
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>([]);
  const [showRetrainModal, setShowRetrainModal] = useState(false); 
  const [showDeleteModal, setShowDeleteModal] = useState(false); // Custom Delete Modal
  
  // Selection State
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [storageMode, setStorageMode] = useState<'separate' | 'combined'>('separate');

  // Progress & Resume State
  const [savedProgress, setSavedProgress] = useState<TrainingProgress | null>(null);
  const stopRetrainRef = useRef(false); 
  
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

  // 2. Load Knowledge & Progress
  useEffect(() => {
    if (!selectedAgentId) {
        setKnowledgeList([]);
        setSavedProgress(null);
        setSelectedItemIds([]);
        return;
    }

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
      setAnalysisResult(null); 
    }
  };

  const getSettings = async (): Promise<AppSettings | null> => {
      try {
        const snapshot = await get(child(ref(db), 'settings'));
        if (snapshot.exists()) return snapshot.val();
      } catch (e) { console.error(e); }
      return null;
  };

  const handleAnalyzeAndLearn = async () => {
    if (!selectedAgentId) return;
    setIsProcessing(true);
    setProcessingType('analyze');
    setStatus('Initializing AI Analysis...');

    const settings = await getSettings();
    if (!settings || !settings.apiKeys || settings.apiKeys.length === 0) {
        alert("Please configure API Keys in Settings first!");
        setIsProcessing(false);
        return;
    }

    const gemini = new GeminiService(settings.apiKeys);
    const model = settings.selectedModel || GeminiModel.FLASH_3;

    try {
        const prompt = `Perform a deep analysis. Extract facts and business logic. Output points.\n${textInput ? `User Context: ${textInput}` : ''}`;
        const summary = await gemini.analyzeContent(model, prompt, files);
        setAnalysisResult(summary);

        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        const otherFiles = files.filter(f => !f.type.startsWith('image/'));

        if (storageMode === 'separate') {
            if (imageFiles.length > 0) {
                for (const img of imageFiles) {
                    const b64 = saveImages ? await compressImageForDb(img) : null;
                    await push(ref(db, `knowledge/${selectedAgentId}`), {
                        type: 'image',
                        originalName: img.name,
                        contentSummary: `[Image File: ${img.name}]\n${summary}`,
                        rawContent: textInput,
                        imageData: b64, 
                        timestamp: Date.now()
                    });
                }
            }
            if (otherFiles.length > 0 || textInput.trim() || imageFiles.length === 0) {
                 await push(ref(db, `knowledge/${selectedAgentId}`), {
                    type: otherFiles.length > 0 ? 'file' : 'text',
                    originalName: otherFiles.length > 0 ? otherFiles.map(f => f.name).join(', ') : 'Text Input',
                    contentSummary: summary,
                    rawContent: textInput,
                    timestamp: Date.now()
                });
            }
        } else {
             const allImages = saveImages ? await Promise.all(imageFiles.map(img => compressImageForDb(img))) : [];
             await push(ref(db, `knowledge/${selectedAgentId}`), {
                type: 'composite',
                originalName: files.length > 0 ? `${files.length} Files` : 'Combined Entry',
                contentSummary: summary,
                rawContent: textInput,
                images: allImages.filter(b => !!b),
                timestamp: Date.now()
            });
        }

        setStatus('Complete!');
        setTextInput('');
        setFiles([]);
    } catch (error: any) {
        setStatus(`Error: ${error.message}`);
    } finally {
        setIsProcessing(false);
    }
  };

  const toggleSelection = (id: string) => {
      setSelectedItemIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  const handleSelectAll = () => {
      if (selectedItemIds.length === knowledgeList.length) setSelectedItemIds([]);
      else setSelectedItemIds(knowledgeList.map(k => k.id));
  };

  const handleRetrainClick = () => {
    if (!selectedAgentId || knowledgeList.length === 0) return;
    setShowRetrainModal(true);
  };

  const handleStopRetrain = () => {
      stopRetrainRef.current = true;
      setStatus("Stopping...");
  };

  const executeRetrain = async (resume: boolean = false) => {
    setShowRetrainModal(false); 
    stopRetrainRef.current = false;
    setIsProcessing(true);
    setProcessingType('retrain');
    
    // Determine target list
    const targetItems = selectedItemIds.length > 0 
        ? knowledgeList.filter(k => selectedItemIds.includes(k.id)) 
        : knowledgeList;

    const settings = await getSettings();
    if (!settings || !settings.apiKeys || settings.apiKeys.length === 0) {
        setIsProcessing(false);
        return;
    }

    const gemini = new GeminiService(settings.apiKeys);
    const model = settings.selectedModel || GeminiModel.FLASH_3;

    try {
        let startIndex = 0;
        if (resume && savedProgress && savedProgress.lastProcessedId) {
            const foundIndex = targetItems.findIndex(k => k.id === savedProgress.lastProcessedId);
            if (foundIndex !== -1) startIndex = foundIndex + 1;
        }

        if (!resume) {
            await set(ref(db, `trainingProgress/${selectedAgentId}`), {
                lastProcessedId: '',
                timestamp: Date.now(),
                totalItems: targetItems.length,
                processedCount: 0,
                targetIds: selectedItemIds.length > 0 ? selectedItemIds : null
            });
        }

        for (let i = startIndex; i < targetItems.length; i++) {
            if (stopRetrainRef.current) {
                setStatus("Paused.");
                setIsProcessing(false);
                return; 
            }

            const item = targetItems[i];
            setStatus(`Re-analyzing ${i + 1}/${targetItems.length}: ${item.originalName || 'Item'}...`);

            let filesToAnalyze: File[] = [];
            if (item.imageData) {
                const res = await fetch(item.imageData);
                const blob = await res.blob();
                filesToAnalyze.push(new File([blob], item.originalName || "img.jpg", { type: blob.type }));
            }
            if (item.images) {
                for (const b64 of item.images) {
                    const res = await fetch(b64);
                    const blob = await res.blob();
                    filesToAnalyze.push(new File([blob], "img.jpg", { type: blob.type }));
                }
            }

            const prompt = `Re-analyze entry. User Context: "${item.rawContent || ""}"`;
            const newSummary = await gemini.analyzeContent(model, prompt, filesToAnalyze);
            const finalSummary = (item.type === 'image' && item.originalName) ? `[Image File: ${item.originalName}]\n${newSummary}` : newSummary;

            await update(ref(db, `knowledge/${selectedAgentId}/${item.id}`), { contentSummary: finalSummary });
            await update(ref(db, `trainingProgress/${selectedAgentId}`), {
                lastProcessedId: item.id,
                timestamp: Date.now(),
                totalItems: targetItems.length,
                processedCount: i + 1
            });
        }
        
        setStatus('Complete!');
        await remove(ref(db, `trainingProgress/${selectedAgentId}`));
        setSelectedItemIds([]); // Clear selection after re-training specific items
    } catch (error: any) {
        setStatus(`Error: ${error.message}`);
    } finally {
        setIsProcessing(false);
        setProcessingType(null);
    }
  };

  const handleBulkDelete = async () => {
      setShowDeleteModal(true);
  };

  const confirmBulkDelete = async () => {
      setShowDeleteModal(false);
      setIsProcessing(true);
      setStatus("Deleting...");
      try {
          for (const id of selectedItemIds) {
              await remove(ref(db, `knowledge/${selectedAgentId}/${id}`));
          }
          setSelectedItemIds([]);
          setStatus("Deleted successfully.");
      } catch (e) {
          console.error(e);
      } finally {
          setIsProcessing(false);
      }
  };

  return (
    <div className="space-y-8 animate-fade-in relative">
      {/* --- RE-TRAIN MODAL --- */}
      {showRetrainModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-md w-full overflow-hidden transform transition-all scale-100">
                <div className="p-6">
                    <div className="flex items-center space-x-3 mb-4 text-amber-400">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                        <h3 className="text-xl font-bold text-white">Re-Train AI Agent</h3>
                    </div>
                    
                    {savedProgress ? (
                        <div className="mb-6 bg-slate-900/80 p-4 rounded-lg border border-slate-700">
                             <p className="text-slate-300 mb-2 font-semibold">Resume Training?</p>
                             <div className="w-full bg-slate-700 h-2 rounded-full mb-2">
                                 <div className="bg-green-500 h-2 rounded-full transition-all" style={{ width: `${Math.round((savedProgress.processedCount / savedProgress.totalItems) * 100)}%` }}></div>
                             </div>
                             <p className="text-xs text-slate-400">Processed {savedProgress.processedCount} of {savedProgress.totalItems} items.</p>
                             <div className="mt-4 flex flex-col gap-2">
                                <button onClick={() => executeRetrain(true)} className="w-full py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold text-sm">Resume from Last Stop</button>
                                <button onClick={() => executeRetrain(false)} className="w-full py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-sm">Restart from Beginning</button>
                             </div>
                        </div>
                    ) : (
                        <p className="text-slate-300 mb-6 leading-relaxed">
                            {selectedItemIds.length > 0 
                                ? `Are you sure you want to re-analyze the ${selectedItemIds.length} selected items?` 
                                : `Are you sure you want to re-analyze ALL ${knowledgeList.length} items?`}
                            <br/><br/>
                            <span className="text-xs bg-slate-900/80 p-3 rounded border border-slate-700 block text-slate-400">
                                This will use your API quota to refresh the agent's memory.
                            </span>
                        </p>
                    )}

                    {!savedProgress && (
                        <div className="flex space-x-3 justify-end mt-4 border-t border-slate-700 pt-4">
                            <button onClick={() => setShowRetrainModal(false)} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700 font-medium">Cancel</button>
                            <button onClick={() => executeRetrain(false)} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-lg">Start Re-Training</button>
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* --- DELETE MODAL --- */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-sm w-full overflow-hidden">
                <div className="p-6">
                    <div className="flex items-center space-x-3 mb-4 text-red-500">
                        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        <h3 className="text-xl font-bold text-white">Confirm Deletion</h3>
                    </div>
                    <p className="text-slate-300 mb-6">
                        Delete <strong>{selectedItemIds.length}</strong> items? This will remove them permanently from the agent's knowledge base.
                    </p>
                    <div className="flex space-x-3 justify-end">
                        <button onClick={() => setShowDeleteModal(false)} className="px-4 py-2 rounded-lg text-slate-300 hover:bg-slate-700">Cancel</button>
                        <button onClick={confirmBulkDelete} className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold">Delete Forever</button>
                    </div>
                </div>
            </div>
        </div>
      )}

      <div className="border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white">AI Analysis & Training</h2>
        <p className="text-slate-400 mt-2">Manage datasets, analyze documents, and refine agent memory.</p>
      </div>

      {/* Agent Selector (Name Only UI) */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <label className="block text-sm font-medium text-slate-400 mb-3">Select Agent to Train</label>
          <div className="flex flex-wrap gap-2">
            {agents.map(agent => (
                <button
                    key={agent.id}
                    onClick={() => { setSelectedAgentId(agent.id); setAnalysisResult(null); setSelectedItemIds([]); }}
                    disabled={isProcessing}
                    className={`px-4 py-2 rounded-full border text-sm font-semibold transition-all ${
                        selectedAgentId === agent.id 
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' 
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'
                    } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                    {agent.name}
                </button>
            ))}
            {agents.length === 0 && <p className="text-slate-500 italic text-sm">No agents found.</p>}
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
            <div className={`bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl transition-opacity ${isProcessing && processingType === 'retrain' ? 'opacity-50 pointer-events-none' : ''}`}>
                <h3 className="text-xl font-bold mb-4 text-white flex items-center">
                    <svg className="w-5 h-5 mr-2 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    Input New Data
                </h3>
                
                <div className="mb-6 p-4 bg-slate-900/60 rounded-lg border border-slate-700/50">
                    <label className="block text-sm font-medium text-slate-300 mb-3">Storage Mode</label>
                    <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700">
                        <button onClick={() => setStorageMode('separate')} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${storageMode === 'separate' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Separate Files</button>
                        <button onClick={() => setStorageMode('combined')} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${storageMode === 'combined' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Single Entry</button>
                    </div>
                </div>

                <div className="mb-4">
                    <div className={`relative border-2 border-dashed border-slate-600 rounded-lg p-6 hover:bg-slate-700/50 transition-colors text-center group`}>
                        <input type="file" multiple accept=".pdf,image/*" onChange={handleFileChange} disabled={isProcessing} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        <div>
                            <svg className="mx-auto h-10 w-10 text-slate-400 mb-2 group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            <p className="text-sm text-slate-300">{files.length > 0 ? `${files.length} selected` : "Click or Drag Files"}</p>
                        </div>
                    </div>
                </div>

                <textarea value={textInput} onChange={(e) => setTextInput(e.target.value)} disabled={isProcessing} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-32 mb-4" placeholder="Additional Context / Instructions..." />

                <button onClick={handleAnalyzeAndLearn} disabled={isProcessing || !selectedAgentId || (files.length === 0 && !textInput.trim())} className={`w-full py-3 rounded-lg font-bold text-lg flex justify-center items-center transition-all ${isProcessing ? 'bg-slate-600' : 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white'}`}>
                    {isProcessing && processingType === 'analyze' ? 'Processing...' : 'Analyze & Learn Data'}
                </button>
            </div>
            
            {analysisResult && (
                <div className="bg-slate-800 p-6 rounded-xl border border-green-500/50 shadow-lg animate-fade-in-up">
                    <h3 className="text-lg font-bold text-green-400 mb-2">Analysis Result</h3>
                    <div className="bg-black/30 rounded p-4 text-sm text-slate-200 whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">{analysisResult}</div>
                </div>
            )}
        </div>

        {/* Knowledge Base List */}
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white flex items-center">
                    <svg className="w-5 h-5 mr-2 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253" /></svg>
                    Knowledge Base {knowledgeList.length > 0 && `(${knowledgeList.length})`}
                </h3>
                <div className="flex gap-2">
                    <button onClick={handleSelectAll} className="text-xs text-blue-400 hover:underline">{selectedItemIds.length === knowledgeList.length ? "Deselect All" : "Select All"}</button>
                    <button onClick={isProcessing ? handleStopRetrain : handleRetrainClick} className={`text-xs px-4 py-2 rounded-lg font-semibold transition-all ${isProcessing && processingType === 'retrain' ? 'bg-red-600 text-white' : savedProgress ? 'bg-green-600 text-white' : 'bg-slate-700 text-white'}`}>
                        {isProcessing && processingType === 'retrain' ? "Pause Training" : savedProgress ? "Resume Progress" : "Re-Train All"}
                    </button>
                </div>
            </div>

            {/* Selection Action Bar */}
            {selectedItemIds.length > 0 && (
                <div className="bg-blue-600 p-3 rounded-lg mb-4 flex justify-between items-center animate-fade-in-up">
                    <span className="text-sm font-bold text-white">{selectedItemIds.length} items selected</span>
                    <div className="flex gap-2">
                        <button onClick={handleRetrainClick} className="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-md text-xs font-bold transition-all">Retrain Selected</button>
                        <button onClick={handleBulkDelete} className="bg-red-500 hover:bg-red-400 text-white px-3 py-1.5 rounded-md text-xs font-bold transition-all">Delete Selected</button>
                    </div>
                </div>
            )}
            
            <div className={`flex-1 overflow-y-auto pr-2 space-y-4 max-h-[700px] scrollbar-thin transition-opacity ${isProcessing && processingType === 'retrain' ? 'opacity-50 pointer-events-none' : ''}`}>
                {knowledgeList.length === 0 ? (
                    <div className="text-slate-500 text-center py-20 border border-slate-700 rounded-xl border-dashed">Agent memory is empty.</div>
                ) : (
                    knowledgeList.map(item => (
                        <div key={item.id} onClick={() => toggleSelection(item.id)} className={`bg-slate-800 p-4 rounded-lg border transition-all cursor-pointer relative group ${selectedItemIds.includes(item.id) ? 'border-blue-500 bg-blue-500/5' : 'border-slate-700 hover:border-slate-500'}`}>
                            {/* Checkbox Overlay */}
                            <div className={`absolute top-4 left-4 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${selectedItemIds.includes(item.id) ? 'bg-blue-600 border-blue-600' : 'bg-slate-900 border-slate-600'}`}>
                                {selectedItemIds.includes(item.id) && <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                            </div>

                            <div className="ml-8">
                                <div className="flex justify-between items-start mb-2">
                                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${item.type === 'composite' ? 'bg-amber-900/50 text-amber-200' : 'bg-blue-900/50 text-blue-200'}`}>
                                        {item.type}
                                    </span>
                                    <span className="text-xs text-slate-500">{new Date(item.timestamp).toLocaleDateString()}</span>
                                </div>
                                <h4 className="font-semibold text-slate-200 mb-1 truncate">{item.originalName || 'Knowledge Entry'}</h4>
                                <p className="text-sm text-slate-400 line-clamp-2 bg-slate-900/30 p-2 rounded">{item.contentSummary}</p>
                                
                                <div className="mt-2 flex gap-2">
                                    {item.imageData && <img src={item.imageData} className="h-10 w-10 rounded object-cover border border-slate-700" />}
                                    {item.images && item.images.slice(0, 3).map((img, idx) => <img key={idx} src={img} className="h-10 w-10 rounded object-cover border border-slate-700" />)}
                                    {item.images && item.images.length > 3 && <div className="h-10 w-10 bg-slate-700 rounded flex items-center justify-center text-[10px] text-slate-400">+{item.images.length - 3}</div>}
                                </div>
                            </div>
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
