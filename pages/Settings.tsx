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
    <div className="space-y-8">
      <div className="border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white">System Configuration</h2>
        <p className="text-slate-400 mt-2">Manage API keys and AI Model behavior (Synced to Database).</p>
      </div>

      {/* API Keys Section */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
        <h3 className="text-xl font-semibold mb-4 flex items-center">
          <span className="mr-2">🔑</span> API Keys (Rotation)
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
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors"
          >
            Add
          </button>
        </div>

        <div className="space-y-2">
          {keys.map((key, index) => (
            <div key={index} className="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-700/50">
              <code className="text-green-400 text-sm font-mono">
                {key.substring(0, 8)}...{key.substring(key.length - 6)}
              </code>
              <button
                onClick={() => removeKey(index)}
                className="text-red-400 hover:text-red-300 p-1 rounded hover:bg-red-400/10"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
          {keys.length === 0 && (
            <div className="text-center p-4 text-slate-500 italic">No API keys added yet.</div>
          )}
        </div>
      </div>

      {/* Model Selection */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700">
        <h3 className="text-xl font-semibold mb-4 flex items-center">
          <span className="mr-2">🧠</span> AI Model Version
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
              <div className="font-semibold text-white">{model.label}</div>
              <div className="text-xs text-slate-400 mt-1">{model.desc}</div>
              {selectedModel === model.id && (
                <div className="mt-2 text-xs text-blue-400 font-bold">Active</div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          onClick={handleSave}
          className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg shadow-green-900/20 transition-all flex items-center"
        >
          {saved ? 'Settings Saved to DB!' : 'Save Configuration'}
        </button>
      </div>
    </div>
  );
};

export default Settings;