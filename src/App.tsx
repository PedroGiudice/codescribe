/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { 
  Mic, 
  Square, 
  Send, 
  Github, 
  Database, 
  Play, 
  Pause, 
  TerminalSquare, 
  Plus, 
  Volume2, 
  VolumeX,
  Cpu,
  RefreshCw,
  FolderTree
} from 'lucide-react';

type Message = {
  id: string;
  role: 'user' | 'model';
  content: string;
};

type Integration = {
  id: string;
  type: 'github' | 'api' | 'db';
  name: string;
  status: 'active' | 'syncing' | 'offline';
  metadata?: string;
};

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'model',
      content: 'Hello. I have initialized the Knowledge Engine. You can provide me with a GitHub codebase link or connect to a database to provide context for our discussion.'
    }
  ]);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Integrations state
  const [integrations, setIntegrations] = useState<Integration[]>([
    { id: '1', type: 'github', name: 'facebook/react', status: 'active', metadata: 'main • 8.4k files' }
  ]);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [repoInput, setRepoInput] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Setup STT
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          setInput(prev => prev + (prev.length > 0 ? ' ' : '') + finalTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('STT error', event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    } else {
      setInput(''); // Clear input for new speech
      recognitionRef.current?.start();
      setIsRecording(true);
    }
  };

  const handleTTS = (text: string) => {
    if (!ttsEnabled) return;
    
    // Stop any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    // Try to find a good English voice
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.name.includes('Google') || v.name.includes('Premium') || v.lang.startsWith('en'));
    if (voice) {
      utterance.voice = voice;
    }
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    window.speechSynthesis.speak(utterance);
  };

  const stopTTS = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  const addIntegration = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoInput.trim()) return;
    
    // Simple naive extraction of repo string from URL
    let repoName = repoInput;
    try {
      if (repoInput.startsWith('http')) {
        const url = new URL(repoInput);
        repoName = url.pathname.slice(1).replace(/\/$/, "");
      }
    } catch(e) {}

    setIntegrations(prev => [
      ...prev, 
      { 
        id: Date.now().toString(), 
        type: 'github', 
        name: repoName, 
        status: 'syncing', 
        metadata: 'Indexing pending...' 
      }
    ]);
    setRepoInput('');
    setShowAddRepo(false);
    
    // Simulate sync
    setTimeout(() => {
      setIntegrations(prev => prev.map(inv => 
        inv.id === prev[prev.length-1].id 
          ? { ...inv, status: 'active', metadata: 'main • ready' } 
          : inv
      ));
    }, 3000);
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    }

    const newMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, newMessage]);
    setInput('');
    setIsLoading(true);

    const contextContext = integrations
      .filter(i => i.status === 'active')
      .map(i => `[Integration: ${i.type.toUpperCase()} / ${i.name}]`)
      .join("\n");

    const systemInstruction = `You are an expert AI coding assistant. You have access to the following project context/integrations:\n${contextContext}\n\nPlease respond helpfully and concisely to the user's queries based on the provided context if applicable.`;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, newMessage],
          systemInstruction
        })
      });

      if (!response.ok) throw new Error('API Error');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      const responseMessageId = Date.now().toString() + "-res";
      setMessages(prev => [...prev, { id: responseMessageId, role: 'model', content: '' }]);

      let fullResponse = '';

      while (reader) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const data = JSON.parse(line.slice(6));
              fullResponse += data.text;
              setMessages(prev => 
                prev.map(m => m.id === responseMessageId ? { ...m, content: fullResponse } : m)
              );
            } catch (e) {}
          }
        }
      }

      // Automatically play TTS if enabled
      if (ttsEnabled) {
        handleTTS(fullResponse);
      }

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', content: 'An error occurred while generating the response.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#09090b] text-zinc-100 font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-6 bg-[#0c0c0e]">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <TerminalSquare className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">CodeScribe AI</span>
        </div>

        <div className="flex items-center space-x-6">
          {/* Voice Controls indicator */}
          <div className="flex items-center space-x-4 px-4 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full">
            <div className="flex items-center space-x-2">
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">STT</span>
              <div className={`w-2 h-2 rounded-full ${isRecording ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse' : 'bg-zinc-600'}`}></div>
            </div>
            <div className="h-4 w-[1px] bg-zinc-700"></div>
            <div className="flex items-center space-x-2">
              <span className={`text-[10px] uppercase tracking-widest font-bold ${ttsEnabled ? 'text-indigo-400' : 'text-zinc-500'}`}>TTS</span>
              <button 
                onClick={() => { setTtsEnabled(!ttsEnabled); if(isSpeaking) stopTTS(); }}
                className={`p-1 rounded transition-colors ${ttsEnabled ? 'bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                {ttsEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
              </button>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-medium">JD</div>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 border-r border-zinc-800 bg-[#0c0c0e] flex flex-col shrink-0 flex-none overflow-y-auto">
          <div className="p-4 flex-1 space-y-8">
            <section>
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest block mb-3">Contextual Base</label>
              <div className="space-y-3">
                {integrations.filter(i => i.type === 'github').map(integration => (
                  <div key={integration.id} className="bg-zinc-900 rounded-xl p-3 border border-zinc-800 transition-all hover:bg-zinc-800/80">
                    <div className="flex items-center space-x-3 mb-2">
                      <Github className="w-4 h-4 text-indigo-400" />
                      <span className="text-sm font-medium truncate">{integration.name}</span>
                    </div>
                    <div className="flex items-center text-xs text-zinc-400 space-x-2">
                      <span className={`px-1.5 py-0.5 rounded flex items-center space-x-1 ${integration.status === 'active' ? 'bg-zinc-800' : 'bg-emerald-500/10 text-emerald-400'}`}>
                        {integration.status === 'syncing' && <RefreshCw className="w-3 h-3 animate-spin mr-1" />}
                        <span>{integration.status === 'active' ? 'indexed' : 'indexing'}</span>
                      </span>
                      {integration.metadata && <span className="truncate">{integration.metadata}</span>}
                    </div>
                  </div>
                ))}

                {showAddRepo ? (
                  <form onSubmit={addIntegration} className="bg-zinc-900 rounded-xl p-3 border border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                    <input
                      type="text"
                      value={repoInput}
                      onChange={e => setRepoInput(e.target.value)}
                      placeholder="github.com/user/repo"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-200 outline-none focus:border-indigo-500 mb-2"
                      autoFocus
                    />
                    <div className="flex space-x-2">
                      <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase py-1.5 rounded transition">Add</button>
                      <button type="button" onClick={() => setShowAddRepo(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold uppercase py-1.5 rounded transition">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button 
                    onClick={() => setShowAddRepo(true)}
                    className="w-full flex items-center justify-center space-x-2 py-2 border border-dashed border-zinc-700 rounded-xl text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all text-xs font-semibold"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Import GitHub Repo</span>
                  </button>
                )}
              </div>
            </section>

            <section>
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest block mb-3">Integrations</label>
              <div className="space-y-2">
                {integrations.filter(i => i.type !== 'github').map((integration) => (
                  <div key={integration.id} className="flex items-center justify-between p-2 bg-zinc-900/50 rounded-lg border border-zinc-800/50">
                    <div className="flex items-center space-x-2 overflow-hidden pr-2">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${integration.status === 'active' ? 'bg-blue-500' : 'bg-zinc-700'}`}></div>
                      <span className={`text-xs truncate ${integration.status === 'active' ? 'text-zinc-200' : 'text-zinc-500'}`}>{integration.name}</span>
                    </div>
                    {integration.status === 'active' ? (
                      <Database className="w-3 h-3 text-zinc-600 shrink-0" />
                    ) : (
                      <span className="text-[9px] text-zinc-600 font-bold uppercase">Offline</span>
                    )}
                  </div>
                ))}
              </div>
              <button 
                onClick={() => setIntegrations(prev => [...prev, { id: Date.now().toString(), type: 'api', name: 'New DB Connection', status: 'active' }])}
                className="w-full mt-3 py-2 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-xs font-medium transition-colors border border-zinc-800 text-zinc-400 hover:text-zinc-200"
              >
                + Connect External API/DB
              </button>
            </section>
          </div>
        </aside>

        {/* Main Chat Area */}
        <main className="flex-1 flex flex-col bg-[#09090b] relative">
          <div className="flex-1 overflow-y-auto p-4 sm:p-8 space-y-6 pb-40">
            {messages.map((message) => (
              <div key={message.id} className={`flex flex-col ${message.role === 'user' ? 'items-end' : 'items-start'} space-y-2`}>
                {message.role === 'user' ? (
                  <div className="max-w-[80%] bg-indigo-600/10 border border-indigo-500/20 px-4 py-3 rounded-2xl rounded-tr-none">
                    <p className="text-sm leading-relaxed text-indigo-50 whitespace-pre-wrap">{message.content}</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-start space-y-3 w-full max-w-[90%]">
                    <div className="flex items-center space-x-3">
                      <div className="w-6 h-6 bg-zinc-800 rounded flex items-center justify-center shrink-0">
                        <Cpu className="w-3 h-3 text-indigo-400" />
                      </div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Knowledge Engine</span>
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 px-5 py-4 rounded-2xl rounded-tl-none w-full shadow-sm">
                      <div className="text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: message.content.replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1 py-0.5 rounded text-indigo-300 font-mono text-xs">$1</code>') }} />
                      
                      <div className="mt-4 border-t border-zinc-800/80 pt-3 flex items-center justify-between">
                        <button 
                          onClick={() => handleTTS(message.content)}
                          className="flex items-center space-x-2 text-[10px] font-bold text-indigo-400 uppercase hover:text-indigo-300 transition-colors"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>Listen (TTS)</span>
                        </button>
                        <span className="text-[10px] text-zinc-600 flex items-center"><FolderTree className="w-3 h-3 mr-1" /> Derived from knowledge base</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex items-start space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-6 h-6 bg-zinc-800 rounded flex items-center justify-center animate-pulse">
                    <Cpu className="w-3 h-3 text-indigo-400" />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 animate-pulse">Engine Thinking...</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Floating Input Bar */}
          <div className="absolute bottom-0 left-0 w-full p-4 sm:p-6 bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent pt-12">
            <div className="relative max-w-4xl mx-auto">
              {/* Mic STT Button */}
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center space-x-2 z-10">
                <button 
                  onClick={toggleRecording}
                  className={`p-2.5 rounded-full transition-all duration-300 ${isRecording ? 'bg-red-500/20 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'hover:bg-zinc-800 text-zinc-500 hover:text-indigo-400'}`}
                  title={isRecording ? "Stop recording (STT)" : "Start voice typing (STT)"}
                >
                  {isRecording ? <Square className="w-5 h-5 fill-current" /> : <Mic className="w-5 h-5" />}
                </button>
              </div>
              
              <input 
                type="text" 
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder={isRecording ? "Listening..." : "Describe a feature or ask about specific components..."}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl py-4 pl-16 pr-36 text-sm focus:outline-none focus:border-indigo-500/50 transition-all placeholder-zinc-600 shadow-[0_8px_30px_rgb(0,0,0,0.4)]" 
              />
              
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-2 z-10">
                <button 
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-4 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center space-x-1"
                >
                  <span>Ask Engine</span>
                  <Send className="w-3 h-3 ml-1" />
                </button>
              </div>
            </div>
            <div className="flex justify-center mt-4 space-x-6">
              <div className="flex items-center space-x-2 text-[10px] text-zinc-500 uppercase tracking-tighter font-medium">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span>
                <span>Gemini Pro Context</span>
              </div>
              <div className="flex items-center space-x-2 text-[10px] text-zinc-500 uppercase tracking-tighter font-medium">
                <span className={`w-1.5 h-1.5 rounded-full ${integrations.some(i => i.status === 'syncing') ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                <span>Knowledge DB {integrations.some(i => i.status === 'syncing') ? 'Syncing...' : 'Synced'}</span>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
