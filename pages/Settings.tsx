import React, { useState, useEffect } from 'react';
import { GeminiModel, AppSettings } from '../types';
import { db } from '../services/firebase';
import { ref, onValue, set } from 'firebase/database';

const Settings: React.FC = () => {
  const [keys, setKeys] = useState<string[]>([]);
  const [newKey, setNewKey] = useState('');
  const [selectedModel, setSelectedModel] = useState<GeminiModel>(GeminiModel.FLASH_3);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to settings from Firebase
    const settingsRef = ref(db, 'settings');
    const unsubscribe = onValue(settingsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setKeys(data.apiKeys || []);
        setSelectedModel(data.selectedModel || GeminiModel.FLASH_3);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleSave = async () => {
    const settings: AppSettings = {
      apiKeys: keys,
      selectedModel: selectedModel,
    };
    
    // Save to Firebase
    try {
      await set(ref(db, 'settings'), settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Failed to save settings to database.");
    }
  };

  const addKey = () => {
    if (newKey.trim()) {
      setKeys([...keys, newKey.trim()]);
      setNewKey('');
    }
  };

  const removeKey = (index: number) => {
    const newKeys = [...keys];
    newKeys.splice(index, 1);
    setKeys(newKeys);
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-400">Loading settings from database...</div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white tracking-tight">System Configuration</h2>
        <p className="text-slate-400 mt-2">Manage API keys and AI Model behavior (Synced to Database).</p>
      </div>

      {/* API Keys Section */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
        <h3 className="text-xl font-semibold mb-4 flex items-center text-white">
          <svg className="w-6 h-6 mr-2 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          API Keys (Rotation)
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          Add multiple Gemini API keys. The system will rotate through them to handle rate limits automatically.
        </p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Paste Gemini API Key here (AIza...)"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <button
            onClick={addKey}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center"
          >
             <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
             </svg>
             Add
          </button>
        </div>

        <div className="space-y-2">
          {keys.map((key, index) => (
            <div key={index} className="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-colors">
              <code className="text-green-400 text-sm font-mono flex items-center">
                <svg className="w-4 h-4 mr-2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {key.substring(0, 8)}...{key.substring(key.length - 6)}
              </code>
              <button
                onClick={() => removeKey(index)}
                className="text-slate-500 hover:text-red-400 p-2 rounded-full hover:bg-red-500/10 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
          {keys.length === 0 && (
            <div className="text-center p-6 bg-slate-900/50 rounded-lg border border-slate-700/50 border-dashed text-slate-500 italic">No API keys added yet.</div>
          )}
        </div>
      </div>

      {/* Model Selection */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
        <h3 className="text-xl font-semibold mb-4 flex items-center text-white">
          <svg className="w-6 h-6 mr-2 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
          </svg>
          AI Model Version
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { id: GeminiModel.FLASH_3, label: 'Gemini 3 Flash', desc: 'Fastest, low latency' },
            { id: GeminiModel.FLASH_2_5, label: 'Gemini 2.5 Flash', desc: 'Balanced performance' },
            { id: GeminiModel.PRO_3, label: 'Gemini 3 Pro', desc: 'Complex reasoning' },
          ].map((model) => (
            <button
              key={model.id}
              onClick={() => setSelectedModel(model.id)}
              className={`text-left p-4 rounded-lg border transition-all ${
                selectedModel === model.id
                  ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500'
                  : 'bg-slate-900 border-slate-700 hover:bg-slate-700'
              }`}
            >
              <div className="flex justify-between items-center mb-1">
                  <div className="font-semibold text-white">{model.label}</div>
                  {selectedModel === model.id && (
                     <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                         <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                     </svg>
                  )}
              </div>
              <div className="text-xs text-slate-400">{model.desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          onClick={handleSave}
          className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-green-900/20 transition-all flex items-center transform hover:scale-105"
        >
          {saved ? (
              <>
                <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Settings Saved!
              </>
          ) : (
              <>
                 <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                 </svg>
                 Save Configuration
              </>
          )}
        </button>
      </div>
    </div>
  );
};

export default Settings;