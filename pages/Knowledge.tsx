import React, { useState, useEffect } from 'react';
import { GeminiService } from '../services/geminiService';
import { db } from '../services/firebase';
import { ref, push, onValue } from 'firebase/database';
import { GeminiModel, KnowledgeItem } from '../types';

const Knowledge: React.FC = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [textInput, setTextInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('');
  const [knowledgeList, setKnowledgeList] = useState<KnowledgeItem[]>([]);

  // Load existing knowledge
  useEffect(() => {
    const kRef = ref(db, 'knowledge');
    const unsub = onValue(kRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            const list = Object.keys(data).map(key => ({
                id: key,
                ...data[key]
            })).sort((a,b) => b.timestamp - a.timestamp);
            setKnowledgeList(list);
        } else {
            setKnowledgeList([]);
        }
    });
    return () => unsub();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleLearn = async () => {
    const settingsStr = localStorage.getItem('agenAiSettings');
    if (!settingsStr) {
        alert("Please configure API Keys in Settings first!");
        return;
    }
    const settings = JSON.parse(settingsStr);
    if (!settings.apiKeys || settings.apiKeys.length === 0) {
        alert("No API Keys found in settings.");
        return;
    }

    setIsProcessing(true);
    setStatus('Initializing AI...');

    const gemini = new GeminiService(settings.apiKeys);
    const model = settings.selectedModel || GeminiModel.FLASH_3;

    try {
        let contentToAnalyze = textInput;
        let type: 'text' | 'file' = 'text';

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

        // Save result to Firebase
        await push(ref(db, 'knowledge'), {
            type: files.length > 0 ? 'file' : 'text',
            originalName: files.length > 0 ? files.map(f => f.name).join(', ') : 'Manual Input',
            contentSummary: summary,
            rawContent: textInput,
            timestamp: Date.now()
        });

        setStatus('Success! Knowledge added.');
        setTextInput('');
        setFiles([]);
        
    } catch (error: any) {
        console.error(error);
        setStatus(`Error: ${error.message || 'Analysis failed'}`);
    } finally {
        setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white">Knowledge Base Training</h2>
        <p className="text-slate-400 mt-2">Upload documents or images for the AI to learn. This data is stored in Firebase and used by agents.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        
        {/* Input Section */}
        <div className="space-y-6">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
                <h3 className="text-xl font-bold mb-4 text-white">Input Data</h3>
                
                {/* File Drop Area (Simulated with Input) */}
                <div className="mb-4">
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                        Files (Images, PDF, Text) - Multiple Allowed
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
                                    : "Click or drag files here to upload"}
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
                    disabled={isProcessing || (files.length === 0 && !textInput.trim())}
                    className={`w-full py-3 rounded-lg font-bold text-lg shadow-lg flex justify-center items-center ${
                        isProcessing 
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
            <h3 className="text-xl font-bold text-white mb-2">Learned Knowledge</h3>
            <div className="space-y-4 h-[600px] overflow-y-auto pr-2">
                {knowledgeList.length === 0 ? (
                    <div className="text-slate-500 text-center py-10 border border-slate-700 rounded-xl border-dashed">
                        No knowledge yet. Train the AI!
                    </div>
                ) : (
                    knowledgeList.map(item => (
                        <div key={item.id} className="bg-slate-800 p-4 rounded-lg border border-slate-700">
                            <div className="flex justify-between items-start mb-2">
                                <span className={`text-xs px-2 py-1 rounded font-bold uppercase ${item.type === 'file' ? 'bg-purple-900 text-purple-200' : 'bg-blue-900 text-blue-200'}`}>
                                    {item.type}
                                </span>
                                <span className="text-xs text-slate-500">
                                    {new Date(item.timestamp).toLocaleString()}
                                </span>
                            </div>
                            <h4 className="font-semibold text-slate-200 mb-1">{item.originalName || 'Text Snippet'}</h4>
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