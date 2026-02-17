
import React, { useState, useEffect } from 'react';
import { GeminiModel, AppSettings, Agent } from '../types';
import { db } from '../services/firebase';
import { ref, onValue, set } from 'firebase/database';

const Settings: React.FC = () => {
  const [keys, setKeys] = useState<string[]>([]);
  const [newKey, setNewKey] = useState('');
  const [selectedModel, setSelectedModel] = useState<GeminiModel>(GeminiModel.FLASH_3);
  const [compressionQuality, setCompressionQuality] = useState<number>(0.7); // Default 70%
  const [defaultAgentId, setDefaultAgentId] = useState<string>(''); // Default Home Agent
  
  const [agents, setAgents] = useState<Agent[]>([]);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to settings from Firebase
    const settingsRef = ref(db, 'settings');
    const settingsUnsub = onValue(settingsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setKeys(data.apiKeys || []);
        setSelectedModel(data.selectedModel || GeminiModel.FLASH_3);
        setCompressionQuality(data.compressionQuality !== undefined ? data.compressionQuality : 0.7);
        setDefaultAgentId(data.defaultAgentId || '');
      }
      setLoading(false);
    });

    // Load agents for the dropdown
    const agentsRef = ref(db, 'agents');
    const agentsUnsub = onValue(agentsRef, (snap) => {
        const data = snap.val();
        if (data) {
            const list = Object.keys(data).map(k => ({ id: k, ...data[k] }));
            setAgents(list);
        }
    });

    return () => { settingsUnsub(); agentsUnsub(); };
  }, []);

  const handleSave = async () => {
    const settings: AppSettings = {
      apiKeys: keys,
      selectedModel: selectedModel,
      compressionQuality: compressionQuality,
      defaultAgentId: defaultAgentId
    };
    
    // Save to Firebase
    try {
      await set(ref(db, 'settings'), settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Gagal menyimpan pengaturan ke database.");
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
    return <div className="p-8 text-center text-slate-400">Memuat pengaturan...</div>;
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="border-b border-slate-700 pb-4">
        <h2 className="text-3xl font-bold text-white tracking-tight">Konfigurasi Sistem</h2>
        <p className="text-slate-400 mt-2">Kelola API Key, Model AI, dan Optimasi Penyimpanan.</p>
      </div>

      {/* API Keys Section */}
      <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl relative overflow-hidden">
        {keys.length > 1 && (
            <div className="absolute top-0 right-0 bg-green-500/10 text-green-400 text-xs font-bold px-3 py-1 rounded-bl-xl border-l border-b border-green-500/20 flex items-center">
                <svg className="w-3 h-3 mr-1 animate-spin-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Rotasi Otomatis Aktif
            </div>
        )}

        <h3 className="text-xl font-semibold mb-4 flex items-center text-white">
          <svg className="w-6 h-6 mr-2 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
          </svg>
          Rotasi API Key
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          Tambahkan beberapa Gemini API Key. Sistem akan <strong>secara otomatis merotasi</strong> ke kunci berikutnya jika batas penggunaan (429) tercapai.
        </p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="Tempel Gemini API Key disini (AIza...)"
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none font-mono"
          />
          <button
            onClick={addKey}
            className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center"
          >
             <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
             </svg>
             Tambah
          </button>
        </div>

        <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
          {keys.map((key, index) => (
            <div key={index} className="flex items-center justify-between bg-slate-900 p-3 rounded-lg border border-slate-700/50 hover:border-slate-600 transition-colors group">
              <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500 font-mono w-6">#{index + 1}</span>
                  <code className="text-green-400 text-sm font-mono flex items-center">
                    <svg className="w-4 h-4 mr-2 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {key.substring(0, 8)}...{key.substring(key.length - 6)}
                  </code>
              </div>
              <button
                onClick={() => removeKey(index)}
                className="text-slate-500 hover:text-red-400 p-2 rounded-full hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))}
          {keys.length === 0 && (
            <div className="text-center p-6 bg-slate-900/50 rounded-lg border border-slate-700/50 border-dashed text-slate-500 italic">
                Belum ada API Key. Fitur AI tidak akan berfungsi.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Model Selection */}
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
            <h3 className="text-xl font-semibold mb-4 flex items-center text-white">
              <svg className="w-6 h-6 mr-2 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
              </svg>
              Konfigurasi AI
            </h3>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Agent Beranda Default</label>
                    <select 
                        value={defaultAgentId} 
                        onChange={(e) => setDefaultAgentId(e.target.value)}
                        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                    >
                        <option value="">-- Tampilkan Direktori Agent --</option>
                        {agents.map(a => (
                            <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                        ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-1">Jika dipilih, halaman utama akan langsung menampilkan chat agent ini.</p>
                </div>

                <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">Versi Model</label>
                    <div className="space-y-2">
                    {[
                        { id: GeminiModel.FLASH_3, label: 'Gemini 3 Flash', desc: 'Tercepat' },
                        { id: GeminiModel.FLASH_2_5, label: 'Gemini 2.5 Flash', desc: 'Seimbang' },
                        { id: GeminiModel.PRO_3, label: 'Gemini 3 Pro', desc: 'Kompleks' },
                    ].map((model) => (
                        <button
                        key={model.id}
                        onClick={() => setSelectedModel(model.id)}
                        className={`w-full text-left p-2 rounded-lg border transition-all flex justify-between items-center ${
                            selectedModel === model.id
                            ? 'bg-blue-600/20 border-blue-500 ring-1 ring-blue-500'
                            : 'bg-slate-900 border-slate-700 hover:bg-slate-700'
                        }`}
                        >
                            <span className="text-sm font-semibold text-white">{model.label}</span>
                            {selectedModel === model.id && <div className="w-2 h-2 bg-blue-500 rounded-full"></div>}
                        </button>
                    ))}
                    </div>
                </div>
            </div>
          </div>

          {/* Compression Settings */}
          <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-xl">
            <h3 className="text-xl font-semibold mb-4 flex items-center text-white">
              <svg className="w-6 h-6 mr-2 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Kualitas Penyimpanan Gambar
            </h3>
            <p className="text-sm text-slate-400 mb-4">
               Mengontrol kualitas saat menyimpan gambar training ke database. Kualitas rendah menghemat ruang penyimpanan.
            </p>
            <div className="space-y-3">
              {[
                { val: 0.6, label: 'Rendah (60%)', desc: 'Hemat ruang' },
                { val: 0.8, label: 'Tinggi (80%)', desc: 'Seimbang (Disarankan)' },
                { val: 0.9, label: 'Sangat Tinggi (90%)', desc: 'Detail tinggi' },
                { val: 1.0, label: 'Asli (100%)', desc: 'Tanpa kompresi (Ukuran Besar)' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => setCompressionQuality(opt.val)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${
                    compressionQuality === opt.val
                      ? 'bg-cyan-600/20 border-cyan-500 ring-1 ring-cyan-500'
                      : 'bg-slate-900 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-center mb-1">
                      <div className="font-semibold text-white text-sm">{opt.label}</div>
                      {compressionQuality === opt.val && (
                        <svg className="w-5 h-5 text-cyan-500" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                  </div>
                  <div className="text-xs text-slate-400">{opt.desc}</div>
                </button>
              ))}
            </div>
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
                Tersimpan!
              </>
          ) : (
              <>
                 <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                 </svg>
                 Simpan Pengaturan
              </>
          )}
        </button>
      </div>
    </div>
  );
};

export default Settings;
