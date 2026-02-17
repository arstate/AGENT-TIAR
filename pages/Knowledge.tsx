
import React, { useState, useEffect, useRef } from 'react';
import { GeminiService, fileToGenerativePart } from '../services/geminiService';
import { db } from '../services/firebase';
import { ref, push, onValue, get, child, remove, update, set } from 'firebase/database';
import { GeminiModel, KnowledgeItem, AppSettings, Agent, TrainingQueueItem } from '../types';

declare const pdfjsLib: any;

// Helper: Compress Image for Database Storage
const compressImageForDb = async (file: File, quality: number = 0.7): Promise<string> => {
    // SECURITY/LOGIC FIX: If quality is 1 (Original), DO NOT use canvas. 
    // Return original Base64 immediately to preserve 100% quality and metadata.
    if (quality >= 1) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                resolve(reader.result as string);
            };
            reader.onerror = (error) => {
                console.error("Error reading file:", error);
                resolve('');
            };
            reader.readAsDataURL(file);
        });
    }

    // Normal Compression Logic
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
                const dataUrl = canvas.toDataURL('image/jpeg', quality); 
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

// Helper: Convert PDF Pages to Images
const convertPdfToImages = async (file: File): Promise<File[]> => {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        const images: File[] = [];

        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 }); // Good balance of quality/size
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;
            
            // Convert to blob then file
            const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
            if (blob) {
                images.push(new File([blob], `${file.name}_page_${i}.jpg`, { type: 'image/jpeg' }));
            }
        }
        return images;
    } catch (e) {
        console.error("PDF Conversion failed", e);
        return [];
    }
};

interface TrainingProgress {
    lastProcessedId: string;
    timestamp: number;
    totalItems: number;
    processedCount: number;
    targetIds?: string[];
}

const Knowledge: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  
  // Input State
  const [files, setFiles] = useState<File[]>([]);
  const [textInput, setTextInput] = useState('');
  const [saveImages, setSaveImages] = useState(true); 
  const [storageMode, setStorageMode] = useState<'separate' | 'combined'>('separate');
  const [selectedQuality, setSelectedQuality] = useState<number>(0.8); // Default 80%

  // Queue State
  const [trainingQueue, setTrainingQueue] = useState<TrainingQueueItem[]>([]);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [currentQueueId, setCurrentQueueId] = useState<string | null>(null);

  // Global Process State
  const [status, setStatus] = useState('');
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>([]);
  const [showRetrainModal, setShowRetrainModal] = useState(false); 
  const [showDeleteModal, setShowDeleteModal] = useState(false); 
  
  // Selection State
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);

  // Progress & Resume State
  const [savedProgress, setSavedProgress] = useState<TrainingProgress | null>(null);
  const stopRetrainRef = useRef(false); 
  
  // Analysis Result State (Ainanalisa) - Shows the LAST completed result
  const [analysisResult, setAnalysisResult] = useState<{agent: string, result: string} | null>(null);

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

  // 3. Queue Processor
  useEffect(() => {
      const processNextInQueue = async () => {
          if (isProcessingQueue || trainingQueue.length === 0) return;

          // Find pending items
          const pending = trainingQueue.find(item => item.status === 'pending');
          if (!pending) return;

          setIsProcessingQueue(true);
          setCurrentQueueId(pending.id);
          setStatus(`Memproses antrean untuk Agent: ${pending.agentName}...`);

          try {
             // Mark as processing
             setTrainingQueue(prev => prev.map(i => i.id === pending.id ? {...i, status: 'processing'} : i));

             await processTrainingItem(pending);

             // Mark as completed
             setTrainingQueue(prev => prev.map(i => i.id === pending.id ? {...i, status: 'completed'} : i));
             // Remove completed from queue after short delay to show success
             setTimeout(() => {
                 setTrainingQueue(prev => prev.filter(i => i.id !== pending.id));
             }, 2000);

          } catch (error: any) {
              console.error("Queue Error:", error);
              setTrainingQueue(prev => prev.map(i => i.id === pending.id ? {...i, status: 'error', errorMsg: error.message} : i));
          } finally {
              setIsProcessingQueue(false);
              setCurrentQueueId(null);
              setStatus('');
          }
      };

      processNextInQueue();
  }, [trainingQueue, isProcessingQueue]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
      setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const getSettings = async (): Promise<AppSettings | null> => {
      try {
        const snapshot = await get(child(ref(db), 'settings'));
        if (snapshot.exists()) return snapshot.val();
      } catch (e) { console.error(e); }
      return null;
  };

  const handleAddToQueue = () => {
      if (!selectedAgentId) return;
      const agent = agents.find(a => a.id === selectedAgentId);
      
      const newItem: TrainingQueueItem = {
          id: Date.now().toString(),
          agentId: selectedAgentId,
          agentName: agent?.name || 'Unknown',
          files: [...files], // Copy files
          textInput: textInput,
          saveImages: saveImages,
          storageMode: storageMode,
          compressionQuality: selectedQuality, // Save the selected quality for this batch
          status: 'pending',
          timestamp: Date.now()
      };

      setTrainingQueue(prev => [...prev, newItem]);
      
      // Reset Input UI
      setFiles([]);
      setTextInput('');
  };

  const processTrainingItem = async (item: TrainingQueueItem) => {
    const settings = await getSettings();
    if (!settings || !settings.apiKeys || settings.apiKeys.length === 0) {
        throw new Error("API Key belum dikonfigurasi.");
    }

    const gemini = new GeminiService(settings.apiKeys);
    const model = settings.selectedModel || GeminiModel.FLASH_3;
    
    // Use the quality setting from the Queue Item
    // Ensure default is 0.7 if undefined, BUT permit 1.0 (No Compression)
    const quality = item.compressionQuality !== undefined ? item.compressionQuality : 0.7;

    // 1. PRE-PROCESS FILES (Handle PDF Conversion)
    let processedFiles: File[] = [];

    for (const file of item.files) {
        if (file.type === 'application/pdf') {
            if (item.saveImages) {
                setStatus(`Mengkonversi PDF: ${file.name}...`);
                const pageImages = await convertPdfToImages(file);
                processedFiles = [...processedFiles, ...pageImages];
            } else {
                processedFiles.push(file); // Keep PDF as is for analysis only
            }
        } else {
            processedFiles.push(file);
        }
    }

    // 2. ANALYZE
    setStatus(`Menganalisa konten untuk ${item.agentName}...`);
    const prompt = `Lakukan analisa mendalam. Ekstrak fakta dan logika bisnis. Keluarkan poin-poin penting dalam Bahasa Indonesia.\n${item.textInput ? `Konteks Pengguna: ${item.textInput}` : ''}`;
    const summary = await gemini.analyzeContent(model, prompt, processedFiles);
    
    setAnalysisResult({ agent: item.agentName, result: summary });

    // 3. SAVE TO DB
    const imageFiles = processedFiles.filter(f => f.type.startsWith('image/'));
    const otherFiles = processedFiles.filter(f => !f.type.startsWith('image/'));

    if (item.storageMode === 'separate') {
        // Save Images Individually
        if (imageFiles.length > 0) {
            for (let i=0; i<imageFiles.length; i++) {
                const img = imageFiles[i];
                setStatus(`Menyimpan gambar ${i+1}/${imageFiles.length}...`);
                // Only compress and save base64 if saveImages is true. Pass specific quality.
                const b64 = item.saveImages ? await compressImageForDb(img, quality) : null;
                
                await push(ref(db, `knowledge/${item.agentId}`), {
                    type: 'image',
                    originalName: img.name,
                    contentSummary: `[File Gambar: ${img.name}]\n${summary}`,
                    rawContent: item.textInput,
                    imageData: b64, 
                    timestamp: Date.now()
                });
            }
        }
        // Save Text/PDF
        if (otherFiles.length > 0 || item.textInput.trim() || (imageFiles.length === 0 && !item.saveImages)) {
                await push(ref(db, `knowledge/${item.agentId}`), {
                type: otherFiles.length > 0 ? 'file' : 'text',
                originalName: otherFiles.length > 0 ? otherFiles.map(f => f.name).join(', ') : 'Input Teks',
                contentSummary: summary,
                rawContent: item.textInput,
                timestamp: Date.now()
            });
        }
    } else {
        // Combined Mode
        setStatus(`Mengompres gambar gabungan...`);
        const allImages = item.saveImages ? await Promise.all(imageFiles.map(img => compressImageForDb(img, quality))) : [];
        
        await push(ref(db, `knowledge/${item.agentId}`), {
            type: 'composite',
            originalName: item.files.length > 0 ? `${item.files.length} File (${item.files[0].name}...)` : 'Entri Gabungan',
            contentSummary: summary,
            rawContent: item.textInput,
            images: allImages.filter(b => !!b),
            timestamp: Date.now()
        });
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
      setStatus("Menghentikan...");
  };

  const executeRetrain = async (resume: boolean = false) => {
    setShowRetrainModal(false); 
    stopRetrainRef.current = false;
    setIsProcessingQueue(true);
    setStatus("Memulai Pelatihan Ulang...");
    
    const targetItems = selectedItemIds.length > 0 
        ? knowledgeList.filter(k => selectedItemIds.includes(k.id)) 
        : knowledgeList;

    const settings = await getSettings();
    if (!settings || !settings.apiKeys || settings.apiKeys.length === 0) {
        setIsProcessingQueue(false);
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
                setStatus("Dijeda.");
                setIsProcessingQueue(false);
                return; 
            }

            const item = targetItems[i];
            setStatus(`Analisa Ulang ${i + 1}/${targetItems.length}: ${item.originalName || 'Item'}...`);

            let filesToAnalyze: File[] = [];
            if (item.imageData) {
                const res = await fetch(item.imageData);
                const blob = await res.blob();
                filesToAnalyze.push(new File([blob], "restored.jpg", { type: blob.type }));
            }
            if (item.images) {
                 for(const b64 of item.images) {
                    const res = await fetch(b64);
                    const blob = await res.blob();
                    filesToAnalyze.push(new File([blob], "restored.jpg", { type: blob.type }));
                 }
            }

            const prompt = `Analisa ulang entri ini. Konteks Pengguna: "${item.rawContent || ""}". Keluarkan dalam Bahasa Indonesia.`;
            const newSummary = await gemini.analyzeContent(model, prompt, filesToAnalyze);
            const finalSummary = (item.type === 'image' && item.originalName) ? `[File Gambar: ${item.originalName}]\n${newSummary}` : newSummary;

            await update(ref(db, `knowledge/${selectedAgentId}/${item.id}`), { contentSummary: finalSummary });
            await update(ref(db, `trainingProgress/${selectedAgentId}`), {
                lastProcessedId: item.id,
                timestamp: Date.now(),
                totalItems: targetItems.length,
                processedCount: i + 1
            });
        }
        
        setStatus('Selesai!');
        await remove(ref(db, `trainingProgress/${selectedAgentId}`));
        setSelectedItemIds([]); 
    } catch (error: any) {
        setStatus(`Error: ${error.message}`);
    } finally {
        setIsProcessingQueue(false);
    }
  };

  const handleBulkDelete = async () => { setShowDeleteModal(true); };
  const confirmBulkDelete = async () => {
      setShowDeleteModal(false);
      try {
          for (const id of selectedItemIds) {
              await remove(ref(db, `knowledge/${selectedAgentId}/${id}`));
          }
          setSelectedItemIds([]);
      } catch (e) { console.error(e); }
  };

  return (
    <div className="space-y-8 animate-fade-in relative">
      {/* --- MODALS (Retrain & Delete) --- */}
      {showRetrainModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-md w-full p-6">
                 <h3 className="text-xl font-bold text-white mb-4">Latih Ulang Agent</h3>
                 <div className="flex justify-end gap-2">
                    <button onClick={() => setShowRetrainModal(false)} className="px-4 py-2 text-slate-300">Batal</button>
                    <button onClick={() => executeRetrain(false)} className="px-4 py-2 bg-blue-600 text-white rounded">Mulai</button>
                 </div>
            </div>
        </div>
      )}
       {showDeleteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl max-w-sm w-full p-6">
                <h3 className="text-xl font-bold text-red-500 mb-2">Hapus Item?</h3>
                <p className="text-slate-300 mb-4">Apakah Anda yakin ingin menghapus {selectedItemIds.length} item?</p>
                <div className="flex justify-end gap-2">
                    <button onClick={() => setShowDeleteModal(false)} className="px-4 py-2 text-slate-300">Batal</button>
                    <button onClick={confirmBulkDelete} className="px-4 py-2 bg-red-600 text-white rounded">Hapus</button>
                </div>
            </div>
        </div>
      )}

      <div className="border-b border-slate-700 pb-4 flex justify-between items-end">
        <div>
            <h2 className="text-3xl font-bold text-white">Analisa AI & Training</h2>
            <p className="text-slate-400 mt-2">Kelola dataset, analisa dokumen, dan pertajam memori agent.</p>
        </div>
        
        {/* Queue Status Widget */}
        {trainingQueue.length > 0 && (
            <div className="bg-slate-800 border border-blue-500/50 rounded-lg p-3 shadow-lg flex items-center gap-3 animate-pulse">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <div>
                    <p className="text-xs text-blue-300 font-bold uppercase tracking-wider">Memproses Antrean</p>
                    <p className="text-sm text-white font-medium">{trainingQueue.filter(i => i.status !== 'completed').length} item tersisa</p>
                </div>
            </div>
        )}
      </div>

      {/* Agent Selector */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
          <label className="block text-sm font-medium text-slate-400 mb-3">Pilih Agent untuk Dilatih</label>
          <div className="flex flex-wrap gap-2">
            {agents.map(agent => (
                <button
                    key={agent.id}
                    onClick={() => { setSelectedAgentId(agent.id); setAnalysisResult(null); setSelectedItemIds([]); }}
                    disabled={isProcessingQueue && currentQueueId !== null} 
                    className={`px-4 py-2 rounded-full border text-sm font-semibold transition-all ${
                        selectedAgentId === agent.id 
                        ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20' 
                        : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500'
                    }`}
                >
                    {agent.name}
                </button>
            ))}
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* INPUT SECTION */}
        <div className="space-y-6">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
                <h3 className="text-xl font-bold mb-4 text-white flex items-center">
                    <svg className="w-5 h-5 mr-2 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                    Input Data Baru
                </h3>
                
                {/* Config Toggles */}
                <div className="mb-6 space-y-3">
                    {/* Storage Mode */}
                    <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-700/50">
                         <div className="flex justify-between items-center mb-2">
                             <span className="text-sm font-medium text-slate-300">Mode Penyimpanan</span>
                             <span className="text-[10px] text-slate-500">{storageMode === 'separate' ? 'Memisahkan halaman PDF' : 'Menggabungkan semua input'}</span>
                         </div>
                         <div className="flex bg-slate-900 rounded p-1 border border-slate-700">
                            <button onClick={() => setStorageMode('separate')} className={`flex-1 py-1.5 rounded text-xs font-bold ${storageMode === 'separate' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Terpisah</button>
                            <button onClick={() => setStorageMode('combined')} className={`flex-1 py-1.5 rounded text-xs font-bold ${storageMode === 'combined' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}>Gabung</button>
                        </div>
                    </div>

                    {/* Image Settings Config Grid */}
                    <div className="grid grid-cols-2 gap-3">
                         {/* Save to DB Toggle */}
                         <div className="bg-slate-900/60 p-3 rounded-lg border border-slate-700/50 flex flex-col justify-between">
                             <div className="mb-2">
                                <span className="block text-sm font-medium text-slate-300">Simpan File?</span>
                                <span className="text-[10px] text-slate-500">Simpan gambar ke DB</span>
                             </div>
                             <div className="flex items-center">
                                 <button
                                    onClick={() => setSaveImages(!saveImages)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${saveImages ? 'bg-green-500' : 'bg-slate-600'}`}
                                >
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${saveImages ? 'translate-x-6' : 'translate-x-1'}`} />
                                </button>
                                <span className="ml-2 text-xs font-bold text-white">{saveImages ? 'YA' : 'TDK'}</span>
                             </div>
                         </div>

                         {/* Quality Selector - BUTTON GROUP (Better for clicking) */}
                         <div className={`bg-slate-900/60 p-3 rounded-lg border border-slate-700/50 flex flex-col justify-between transition-opacity ${!saveImages ? 'opacity-50 pointer-events-none' : ''}`}>
                             <div className="mb-2">
                                <span className="block text-sm font-medium text-slate-300">Kualitas Gambar</span>
                                <span className="text-[10px] text-slate-500">{selectedQuality === 1 ? 'Tanpa Kompresi' : `${selectedQuality * 100}% Kualitas`}</span>
                             </div>
                             
                             <div className="grid grid-cols-4 gap-1">
                                {[
                                    { val: 0.6, label: '60%' },
                                    { val: 0.8, label: '80%' },
                                    { val: 0.9, label: '90%' },
                                    { val: 1.0, label: 'Asli' }
                                ].map((opt) => (
                                    <button
                                        key={opt.val}
                                        onClick={() => setSelectedQuality(opt.val)}
                                        className={`px-1 py-1.5 rounded text-[10px] font-bold border transition-colors ${
                                            selectedQuality === opt.val 
                                            ? 'bg-cyan-600 text-white border-cyan-500 shadow-md' 
                                            : 'bg-slate-800 text-slate-400 border-slate-600 hover:bg-slate-700 hover:text-white'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                             </div>
                         </div>
                    </div>
                </div>

                {/* Upload Area & Thumbnails */}
                <div className="mb-4">
                    <div className="relative border-2 border-dashed border-slate-600 rounded-lg p-6 hover:bg-slate-700/50 transition-colors text-center group mb-4">
                        <input type="file" multiple accept=".pdf,image/*" onChange={handleFileChange} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                        <div>
                            <svg className="mx-auto h-10 w-10 text-slate-400 mb-2 group-hover:text-blue-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                            <p className="text-sm text-slate-300">Klik atau Tarik PDF / Gambar</p>
                        </div>
                    </div>

                    {/* Thumbnails */}
                    {files.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mb-4">
                            {files.map((file, idx) => (
                                <div key={idx} className="relative group aspect-square bg-slate-900 rounded-lg overflow-hidden border border-slate-600">
                                    {file.type.includes('image') ? (
                                        <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex flex-col items-center justify-center text-red-400 p-2">
                                            <svg className="w-8 h-8 mb-1" fill="currentColor" viewBox="0 0 24 24"><path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v.5zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z" /></svg>
                                            <span className="text-[10px] text-center leading-tight truncate w-full">{file.name}</span>
                                        </div>
                                    )}
                                    <button onClick={() => removeFile(idx)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1 opacity-70 hover:opacity-100">
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <textarea value={textInput} onChange={(e) => setTextInput(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none h-32 mb-4" placeholder="Konteks Tambahan / Instruksi..." />

                <button onClick={handleAddToQueue} disabled={!selectedAgentId || (files.length === 0 && !textInput.trim())} className={`w-full py-3 rounded-lg font-bold text-lg flex justify-center items-center transition-all ${!selectedAgentId || (files.length === 0 && !textInput.trim()) ? 'bg-slate-600 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transform hover:scale-[1.02]'}`}>
                    Tambahkan ke Antrean Training
                </button>
                
                {status && <div className="mt-2 text-center text-xs text-yellow-400 font-mono animate-pulse">{status}</div>}
            </div>
            
            {/* Last Result */}
            {analysisResult && (
                <div className="bg-slate-800 p-6 rounded-xl border border-green-500/50 shadow-lg animate-fade-in-up">
                    <div className="flex justify-between items-center mb-2">
                        <h3 className="text-lg font-bold text-green-400">Hasil Analisa</h3>
                        <span className="text-xs bg-slate-900 px-2 py-1 rounded text-slate-400">{analysisResult.agent}</span>
                    </div>
                    <div className="bg-black/30 rounded p-4 text-sm text-slate-200 whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">{analysisResult.result}</div>
                </div>
            )}
        </div>

        {/* Knowledge Base List */}
        <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white flex items-center">
                    <svg className="w-5 h-5 mr-2 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253" /></svg>
                    Basis Pengetahuan {knowledgeList.length > 0 && `(${knowledgeList.length})`}
                </h3>
                <div className="flex gap-2">
                    <button onClick={handleSelectAll} className="text-xs text-blue-400 hover:underline">{selectedItemIds.length === knowledgeList.length ? "Batal Pilih" : "Pilih Semua"}</button>
                    <button onClick={isProcessingQueue ? handleStopRetrain : handleRetrainClick} className={`text-xs px-4 py-2 rounded-lg font-semibold transition-all ${isProcessingQueue ? 'bg-red-600 text-white' : savedProgress ? 'bg-green-600 text-white' : 'bg-slate-700 text-white'}`}>
                        {savedProgress ? "Lanjutkan Training" : "Latih Ulang Semua"}
                    </button>
                </div>
            </div>

            {/* Selection Action Bar */}
            {selectedItemIds.length > 0 && (
                <div className="bg-blue-600 p-3 rounded-lg mb-4 flex justify-between items-center animate-fade-in-up">
                    <span className="text-sm font-bold text-white">{selectedItemIds.length} item dipilih</span>
                    <div className="flex gap-2">
                        <button onClick={handleRetrainClick} className="bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-md text-xs font-bold transition-all">Latih Ulang Terpilih</button>
                        <button onClick={handleBulkDelete} className="bg-red-500 hover:bg-red-400 text-white px-3 py-1.5 rounded-md text-xs font-bold transition-all">Hapus Terpilih</button>
                    </div>
                </div>
            )}
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-4 max-h-[700px] scrollbar-thin">
                {knowledgeList.length === 0 ? (
                    <div className="text-slate-500 text-center py-20 border border-slate-700 rounded-xl border-dashed">Memori agent kosong.</div>
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
                                <h4 className="font-semibold text-slate-200 mb-1 truncate">{item.originalName || 'Entri Pengetahuan'}</h4>
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
