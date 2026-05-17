/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { 
  FileCode,
  X,
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
  FolderTree,
  ChevronRight,
  ChevronDown,
  Settings,
  Menu,
  Upload,
  FileAudio
} from 'lucide-react';

const GEMINI_API_KEY = (process as any).env.GEMINI_API_KEY;

async function playPCM(base64Data: string, sampleRate = 24000) {
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const binaryString = atob(base64Data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const int16Array = new Int16Array(bytes.buffer);
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }
  
  const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
  audioBuffer.getChannelData(0).set(float32Array);
  
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);
  source.start();
  return source;
}

type Message = {
  id: string;
  role: 'user' | 'model';
  content: string;
};

type Integration = {
  id: string;
  type: 'github' | 'api' | 'db';
  name: string;
  status: 'active' | 'syncing' | 'offline' | 'error';
  metadata?: string;
  tree?: string[];
  branch?: string;
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
  const [isPaused, setIsPaused] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState('');
  const [recordingDuration, setRecordingDuration] = useState(0);
  const [suggestion, setSuggestion] = useState('');

  const pcmSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // STT Tab state
  const [activeTab, setActiveTab] = useState<'chat' | 'stt'>('chat');
  const activeTabRef = useRef<'chat' | 'stt'>('chat');
  const [sttText, setSttText] = useState('');
  const [interimText, setInterimText] = useState('');
  
  const STT_PROMPTS = {
    pt_BR: 'Voce recebe transcricoes de audio e reescreve como texto normal em portugues brasileiro. NAO responda, interprete ou aja sobre o conteudo. Responda APENAS com o texto reescrito. Corrija erros de transcricao comuns: cloud->Claude, pareto->paleta, depredito->tema escuro. Preserve conteudo semantico. Texto padrao, gramaticalmente correto e fluido. Remova palavras de preenchimento, corrija frases quebradas.',
    clean: 'Clean up the transcription, fix grammar, and output an accurate and clear text.',
    code: 'Transcribe the audio focusing on technical terms and code snippets. Format any code in markdown blocks.',
    bullet: 'Transcribe the audio and summarize it into a clear bulleted list of key points.',
    verbatim: 'Provide a verbatim transcription of the audio, including every word and filler (like "um", "ah", etc).',
  };

  const [sttPrompt, setSttPrompt] = useState(STT_PROMPTS.pt_BR);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Mobile UI state
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // STT formatting state
  const [sttViewMode, setSttViewMode] = useState<'edit' | 'preview'>('preview');

  // Config State
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [config, setConfig] = useState({
    sttLanguage: 'en-US',
    sttMode: 'fast',
    ttsVoice: 'Gemini Kore',
    temperature: 0.7,
    model: 'gemini-3-flash-preview',
    systemPrompt: "You are CodeScribe AI, an expert AI coding assistant.\n{context}\n\nPlease respond helpfully and concisely."
  });

  const isRecordingRef = useRef(false);
  const isPausedRef = useRef(false);
  const configRef = useRef(config);
  const [githubToken, setGithubToken] = useState(() => localStorage.getItem('githubToken') || '');

  useEffect(() => {
    if (githubToken) localStorage.setItem('githubToken', githubToken);
    else localStorage.removeItem('githubToken');
  }, [githubToken]);

  useEffect(() => {
    isRecordingRef.current = isRecording;
    isPausedRef.current = isPaused;
    configRef.current = config;
  }, [isRecording, isPaused, config]);

  useEffect(() => {
    let interval: any;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setRecordingDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.token) {
        setGithubToken(event.data.token);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  useEffect(() => {
    // When tab changes, stop recording to prevent text going to the wrong place
    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
      setIsPaused(false);
      setInterimText('');
    }
  }, [activeTab]);

  // Integrations state
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [repoInput, setRepoInput] = useState('');
  const [expandedTrees, setExpandedTrees] = useState<Record<string, boolean>>({});
  const [fileModal, setFileModal] = useState<{isOpen: boolean, repo: string, path: string, content: string, loading: boolean} | null>(null);

  // Debounced Suggestion Logic
  useEffect(() => {
    if (!input.trim() || input.length < 5) {
      setSuggestion('');
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const repoContext = integrations
          .filter(i => i.type === 'github' && i.status === 'active')
          .map(i => i.name)
          .join(', ');
          
        const res = await fetch('/api/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: input, context: repoContext })
        });
        const data = await res.json();
        if (data.suggestion && data.suggestion !== input) {
          // If the suggestion starts with the input, only show the delta
          if (data.suggestion.toLowerCase().startsWith(input.toLowerCase())) {
             setSuggestion(data.suggestion.substring(input.length));
          } else {
             setSuggestion('');
          }
        } else {
          setSuggestion('');
        }
      } catch (e) {
        setSuggestion('');
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [input, integrations]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab' && suggestion) {
      e.preventDefault();
      setInput(prev => prev + suggestion);
      setSuggestion('');
    } else if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const initRepo = (repoName: string) => {
    setInput(`Eu acabei de conectar o repositório \`${repoName}\`. Por favor, leia a codebase e gere um relatório de 1 a 2 parágrafos com um resumo do projeto. Responda em Português.`);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadingStatus]);

  useEffect(() => {
    const loadVoices = () => {
      setAvailableVoices(window.speechSynthesis.getVoices());
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
      } catch (e) {
        console.error('enumerateDevices missing/error', e);
      }
    };
    loadDevices();
    navigator.mediaDevices.ondevicechange = loadDevices;
  }, []);

  // Setup STT
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = config.sttLanguage;

      recognition.onresult = (event: any) => {
        let finalTranscript = '';
        let currentInterim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            currentInterim += event.results[i][0].transcript;
          }
        }

        if (configRef.current.sttMode === 'fast') {
          setInterimText(currentInterim);
        } else {
          setInterimText('');
        }

        if (finalTranscript) {
          if (activeTabRef.current === 'chat') {
            setInput(prev => prev + (prev.length > 0 && !prev.endsWith(' ') ? ' ' : '') + finalTranscript.trim() + ' ');
          } else {
            setSttText(prev => prev + (prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '') + finalTranscript.trim() + ' ');
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.error('STT error', event.error);
        if (event.error === 'not-allowed') {
          setIsRecording(false);
          setIsPaused(false);
          alert('Microphone access was denied. Please allow microphone access in your browser or open the application in a new tab.');
        }
      };

      recognition.onend = () => {
        if (isRecordingRef.current && !isPausedRef.current) {
          // Auto restart continuous recognition
          try { recognitionRef.current?.start(); } catch (e) {}
        } else if (!isPausedRef.current) {
          setIsRecording(false);
          setIsPaused(false);
        }
      };

      recognitionRef.current = recognition;
    }
  }, []);

  useEffect(() => {
    if (recognitionRef.current) {
       recognitionRef.current.lang = config.sttLanguage;
    }
  }, [config.sttLanguage]);

  const processAudioRecording = async (blob: Blob) => {
    setIsTranscribing(true);
    if (activeTabRef.current === 'chat') setInput('Transcribing...');
    else setInterimText('Transcribing audio with Gemini Engine...');
    
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const base64DataClean = base64data.includes(',') ? base64data.split(',')[1] : base64data;
        
        try {
          if (!GEMINI_API_KEY) throw new Error('API_KEY_MISSING');
          const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
          const response = await ai.models.generateContent({
            model: config.model,
            contents: [
              { role: 'user', parts: [
                { text: sttPrompt || "Transcribe the following audio accurately." },
                { inlineData: { data: base64DataClean, mimeType: blob.type || 'audio/webm' } }
              ]}
            ]
          });
          
          if (response.text) {
            if (activeTabRef.current === 'chat') {
              setInput(response.text);
            } else {
              setSttText(prev => prev + (prev ? '\n\n' : '') + response.text);
            }
          }
        } catch (error: any) {
          console.error('Transcription error:', error);
          if (error.message?.includes('400') || error.message?.includes('API_KEY_INVALID') || error.message === 'API_KEY_MISSING') {
            alert('Invalid Gemini API key. Please check your API key in the Secrets panel (Settings > Secrets).');
          }
          if (activeTabRef.current === 'chat') setInput('');
        }
        setInterimText('');
        setIsTranscribing(false);
      };
    } catch(e) {
      console.error(e);
      setInterimText('Transcription failed.');
      if (activeTabRef.current === 'chat') setInput('');
      setIsTranscribing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processAudioRecording(file);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      recognitionRef.current?.stop();
      setIsRecording(false);
      setIsPaused(false);
    } else {
      setRecordingDuration(0);
      setIsPaused(false);
      setIsRecording(true);

      if (configRef.current.sttMode === 'detailed') {
         setInterimText('Recording high-fidelity audio...');
         if (activeTabRef.current === 'chat') setInput('Listening...');
         try {
            const stream = await navigator.mediaDevices.getUserMedia({
               audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
            });
            const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = mediaRecorder;
            audioChunksRef.current = [];

            mediaRecorder.ondataavailable = (e) => {
               if (e.data.size > 0) audioChunksRef.current.push(e.data);
            };

            mediaRecorder.onstop = () => {
               const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
               processAudioRecording(audioBlob);
               stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
         } catch (e) {
            console.error('GUM failed', e);
            setIsRecording(false);
            setInterimText('Microphone access failed.');
            if (activeTabRef.current === 'chat') setInput('');
         }
      } else {
         if (activeTabRef.current === 'chat') {
            setInput('');
         }
         try { recognitionRef.current?.start(); } catch (e) {}
      }
    }
  };

  const togglePause = () => {
    if (isRecording) {
      if (isPaused) {
        setIsPaused(false);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
           mediaRecorderRef.current.resume();
        } else {
           try { recognitionRef.current?.start(); } catch (e) {}
        }
      } else {
        setIsPaused(true);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
           mediaRecorderRef.current.pause();
        } else {
           recognitionRef.current?.stop();
           setInterimText('');
        }
      }
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleTTS = async (text: string) => {
    if (!ttsEnabled) return;
    
    // Stop any ongoing speech
    window.speechSynthesis.cancel();
    if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
    }
    if (pcmSourceRef.current) {
      try { pcmSourceRef.current.stop(); } catch(e) {}
    }
    
       if (config.ttsVoice && config.ttsVoice.startsWith('Gemini ')) {
       const voiceName = config.ttsVoice.split(' ')[1];
       setIsSpeaking(true);
       try {
           if (!GEMINI_API_KEY) throw new Error('API_KEY_MISSING');
           const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
           const response = await ai.models.generateContent({
             model: "gemini-3.1-flash-tts-preview",
             contents: [{ parts: [{ text: text }] }],
             config: {
               responseModalities: [Modality.AUDIO],
               speechConfig: {
                 voiceConfig: {
                   prebuiltVoiceConfig: { voiceName: voiceName || 'Kore' },
                 },
               },
             },
           });

           const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
           if (base64Audio) {
              const source = await playPCM(base64Audio);
              pcmSourceRef.current = source;
              source.onended = () => setIsSpeaking(false);
           } else {
              setIsSpeaking(false);
           }
       } catch (e: any) {
         console.error(e);
         if (e.message?.includes('400') || e.message?.includes('API_KEY_INVALID') || e.message === 'API_KEY_MISSING') {
           alert('Invalid Gemini API key. Please check your API key in the Secrets panel.');
         }
         setIsSpeaking(false);
       }
       return;
    }
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    const voices = window.speechSynthesis.getVoices();
    let voice = null;
    
    if (config.ttsVoice) {
       voice = voices.find(v => v.name === config.ttsVoice);
    }
    
    if (!voice) {
       voice = voices.find(v => v.name.includes('Google') || v.name.includes('Premium') || v.lang.startsWith('en'));
    }

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

  const toggleTree = (id: string) => {
    setExpandedTrees(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const openFile = async (repo: string, path: string) => {
    setFileModal({ isOpen: true, repo, path, content: '', loading: true });
    
    // Find the default branch
    const inv = integrations.find(i => i.name === repo);
    const branch = inv?.branch || 'main';

    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/${branch}/${path}`);
      if (!res.ok) throw new Error("Could not fetch file content");
      const text = await res.text();
      setFileModal(prev => prev ? { ...prev, content: text, loading: false } : null);
    } catch (e: any) {
      setFileModal(prev => prev ? { ...prev, content: `Error: ${e.message}`, loading: false } : null);
    }
  };

  const syncIntegration = async (id: string, repoName: string) => {
    setIntegrations(prev => prev.map(inv => 
      inv.id === id 
        ? { ...inv, status: 'syncing', metadata: 'Updating connection...' } 
        : inv
    ));

    try {
       const res = await fetch(`/api/github/info?repo=${encodeURIComponent(repoName)}`);
       const data = await res.json();
       if (!res.ok) throw new Error(data.error || 'Failed to fetch repo');

       setIntegrations(prev => prev.map(inv => 
          inv.id === id 
            ? { ...inv, status: 'active', name: data.name, metadata: `${data.branch} • ${data.fileCount} files`, tree: data.tree, branch: data.branch } 
            : inv
       ));
    } catch (e: any) {
       setIntegrations(prev => prev.map(inv => 
          inv.id === id 
            ? { ...inv, status: 'error', metadata: e.message } 
            : inv
       ));
    }
  };

  const addIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoInput.trim()) return;
    
    let repoName = repoInput;
    try {
      if (repoInput.startsWith('http')) {
        const url = new URL(repoInput);
        repoName = url.pathname.slice(1).replace(/\/$/, "");
      }
    } catch(e) {}

    const newId = Date.now().toString();

    setIntegrations(prev => [
      ...prev, 
      { 
        id: newId, 
        type: 'github', 
        name: repoName, 
        status: 'syncing', 
        metadata: 'Establishing connection...' 
      }
    ]);
    setRepoInput('');
    setShowAddRepo(false);
    
    try {
       const headers: any = {};
       if (githubToken) {
         headers['Authorization'] = `Bearer ${githubToken}`;
       }
       const res = await fetch(`/api/github/info?repo=${encodeURIComponent(repoName)}`, { headers });
       const data = await res.json();
       if (!res.ok) throw new Error(data.error || 'Failed to fetch repo');

       setIntegrations(prev => prev.map(inv => 
          inv.id === newId 
            ? { ...inv, status: 'active', name: data.name, metadata: `${data.branch} • ${data.fileCount} files`, tree: data.tree, branch: data.branch } 
            : inv
       ));
       
       // Just trigger setInput and user can send it or edit it.
       setInput(`Eu acabei de conectar o repositório \`${data.name}\`. Por favor, leia a codebase e gere um relatório de 1 a 2 parágrafos com um resumo do projeto. Responda em Português.`);
    } catch (e: any) {
       setIntegrations(prev => prev.map(inv => 
          inv.id === newId 
            ? { ...inv, status: 'error', metadata: e.message } 
            : inv
       ));
    }
  };

  const sendMessage = async (overrideInput?: string) => {
    const textToSend = overrideInput || input;
    if (!textToSend.trim() || isLoading) return;

    if (isRecording) {
      recognitionRef.current?.stop();
      setIsRecording(false);
    }

    const newMessage: Message = { id: Date.now().toString(), role: 'user', content: textToSend };
    setMessages(prev => [...prev, newMessage]);
    setInput('');
    setIsLoading(true);
    setLoadingStatus('Engine initializing...');

    const activeRepos = integrations.filter(i => i.type === 'github' && i.status === 'active');
    const contextContext = activeRepos
      .map(i => `[GitHub Repo: ${i.name}]`)
      .join("\n");

    const contextBlock = activeRepos.length > 0 
      ? `You have access to the following GitHub repositories via tools:\n${contextContext}\nUse 'get_github_file_tree' and 'get_github_file_content' to read them when the user asks questions. Start by getting the file tree if you're not sure where something is.\nVERY IMPORTANT: When mentioning file paths from a repository, make them a markdown link with the scheme 'file://<repo>/<path>'. Example: [src/App.tsx](file://facebook/react/src/App.tsx). This allows the frontend to intercept the click and display the file.` 
      : "You don't have any GitHub repositories connected right now, but the user can add one in the sidebar.";

    const systemInstruction = config.systemPrompt.replace('{context}', contextBlock);

    try {
      if (!GEMINI_API_KEY) throw new Error('API_KEY_MISSING');
      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      
      const contents: any[] = [...messages, newMessage].map((m: any) => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      const tools = [{
        functionDeclarations: [
          {
            name: "get_github_file_content",
            description: "Gets the text content of a file from a public GitHub repository.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                repo: { type: Type.STRING, description: "Repo name, e.g. 'facebook/react'" },
                path: { type: Type.STRING, description: "File path, e.g. 'package.json'" }
              },
              required: ["repo", "path"]
            }
          },
          {
            name: "get_github_file_tree",
            description: "Gets the file tree of a public GitHub repository.",
            parameters: {
              type: Type.OBJECT,
              properties: {
                repo: { type: Type.STRING, description: "Repo name, e.g. 'facebook/react'" },
                branch: { type: Type.STRING, description: "Branch name, e.g. 'main' or 'master'" }
              },
              required: ["repo", "branch"]
            }
          }
        ]
      }];

      let currentContents: any[] = [...contents];
      let isDone = false;
      const responseMessageId = Date.now().toString() + "-res";
      setMessages(prev => [...prev, { id: responseMessageId, role: 'model', content: '' }]);
      let fullResponse = '';

      while (!isDone) {
        const payload: any = {
          model: config.model,
          contents: currentContents,
          tools: tools,
          config: {
             temperature: typeof config.temperature === 'number' ? config.temperature : 0.7,
             systemInstruction: systemInstruction
          }
        };

        const responseStream = await ai.models.generateContentStream(payload);
        
        let hasFunctionCall = false;
        let functionCallsToProcess: any[] = [];
        
        for await (const chunk of responseStream) {
          if (chunk.functionCalls && chunk.functionCalls.length > 0) {
             hasFunctionCall = true;
             functionCallsToProcess.push(...chunk.functionCalls);
          }
          if (chunk.text && !hasFunctionCall) {
            setLoadingStatus(''); // clear thinking state once text arrives
            fullResponse += chunk.text;
            setMessages(prev => 
              prev.map(m => m.id === responseMessageId ? { ...m, content: fullResponse } : m)
            );
          }
        }

        if (hasFunctionCall) {
          setLoadingStatus('Engine fetching code from GitHub...');

          currentContents.push({
            role: "model",
            parts: functionCallsToProcess.map(fc => ({ functionCall: fc }))
          });

          let functionResponses = [];
          for (const fc of functionCallsToProcess) {
            const headers: any = {};
            if (githubToken) {
              headers['Authorization'] = `Bearer ${githubToken}`;
            }

            if (fc.name === 'get_github_file_tree') {
               const repo = fc.args.repo;
               const branch = fc.args.branch || 'main';
               try {
                 const githubRes = await fetch(`https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`, { headers });
                 const data = await githubRes.json();
                 if (data.tree) {
                   const files = data.tree.filter((t: any) => t.type === 'blob').map((t: any) => t.path).slice(0, 1500).join('\n');
                   functionResponses.push({ name: fc.name, response: { result: files } });
                 } else {
                   functionResponses.push({ name: fc.name, response: { error: data.message || "No tree found" } });
                 }
               } catch (e: any) {
                   functionResponses.push({ name: fc.name, response: { error: e.message } });
               }
            } else if (fc.name === 'get_github_file_content') {
               const repo = fc.args.repo;
               const path = fc.args.path;
               try {
                 const repoInfoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
                 const repoInfo = await repoInfoRes.json();
                 const defaultBranch = repoInfo.default_branch || 'main';

                 const url = `https://raw.githubusercontent.com/${repo}/${defaultBranch}/${path}`;
                 const githubRes = await fetch(url, { headers });
                 if (!githubRes.ok) throw new Error(`Status ${githubRes.status}`);
                 const text = await githubRes.text();
                 functionResponses.push({
                   name: fc.name,
                   response: { result: text.slice(0, 15000) } // truncate
                 });
               } catch (e: any) {
                 functionResponses.push({ name: fc.name, response: { error: e.message } });
               }
            }
          }

          currentContents.push({
            role: "user",
            parts: functionResponses.map(fr => ({
                functionResponse: fr
            }))
          });
          // Loop continues
        } else {
          isDone = true;
        }
      }

      // Automatically play TTS if enabled
      if (ttsEnabled && fullResponse) {
        handleTTS(fullResponse);
      }

    } catch (error: any) {
      console.error(error);
      if (error.message?.includes('400') || error.message?.includes('API_KEY_INVALID') || error.message === 'API_KEY_MISSING') {
        alert('Invalid Gemini API key. Please check your API key in the Secrets panel.');
      }
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', content: `An error occurred: ${error.message || 'Unknown error'}` }]);
    } finally {
      setIsLoading(false);
      setLoadingStatus('');
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#09090b] text-zinc-100 font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-4 sm:px-6 bg-[#0c0c0e]">
        <div className="flex items-center space-x-2 sm:space-x-4">
          <button 
             className="md:hidden p-1.5 text-zinc-400 hover:text-zinc-200"
             onClick={() => setIsSidebarOpen(true)}
          >
             <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="w-6 h-6 sm:w-8 sm:h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
              <TerminalSquare className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
            <span className="hidden sm:inline text-lg font-semibold tracking-tight">CodeScribe</span>
          </div>

          <div className="h-4 sm:h-6 w-px bg-zinc-800 mx-1 sm:mx-2"></div>

          <div className="flex items-center bg-zinc-900/50 border border-zinc-800/50 rounded-lg p-1">
            <button 
              onClick={() => setActiveTab('chat')}
              className={`px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-semibold rounded-md transition-colors ${activeTab === 'chat' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Chat
            </button>
            <button 
              onClick={() => setActiveTab('stt')}
              className={`px-2 sm:px-3 py-1 text-[10px] sm:text-xs font-semibold rounded-md transition-colors ${activeTab === 'stt' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              Dictation
            </button>
          </div>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-6">
          {/* Voice Controls indicator */}
          <div className="hidden sm:flex items-center space-x-4 px-4 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full">
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
            <button 
              onClick={() => setIsConfigOpen(true)}
              className="w-8 h-8 rounded-full bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-600 flex items-center justify-center transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4 text-zinc-400" />
            </button>
            <div className="w-8 h-8 rounded-full bg-indigo-600 border border-indigo-500 flex items-center justify-center text-xs font-bold text-white shadow-[0_0_10px_rgba(79,70,229,0.3)]">JD</div>
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar */}
        {isSidebarOpen && (
          <div 
            className="absolute inset-0 bg-black/50 z-30 md:hidden" 
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        <aside className={`w-72 md:w-80 border-r border-zinc-800 bg-[#0c0c0e] flex flex-col shrink-0 flex-none overflow-y-auto absolute md:relative z-40 h-full transition-transform duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
          <div className="p-4 flex-1 space-y-8">
            <section>
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest block mb-3">Contextual Base</label>
              <div className="space-y-3">
                {integrations.filter(i => i.type === 'github').map(integration => (
                  <div key={integration.id} className="bg-zinc-900 rounded-xl p-3 border border-zinc-800 transition-all hover:bg-zinc-800/80 group">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-3 overflow-hidden pr-2">
                        <Github className={`w-4 h-4 shrink-0 ${integration.status === 'error' ? 'text-red-400' : 'text-indigo-400'}`} />
                        <span className="text-sm font-medium truncate">{integration.name}</span>
                      </div>
                      <button 
                        onClick={() => syncIntegration(integration.id, integration.name)}
                        disabled={integration.status === 'syncing'}
                        className={`p-1.5 rounded hover:bg-zinc-700/50 transition-colors ${integration.status === 'syncing' ? 'opacity-50 cursor-not-allowed' : 'opacity-0 group-hover:opacity-100'}`}
                        title="Sync Repository"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${integration.status === 'syncing' ? 'animate-spin text-indigo-400' : 'text-zinc-500 hover:text-indigo-400'} transition-colors`} />
                      </button>
                    </div>
                    <div className="flex items-center text-xs text-zinc-400 space-x-2">
                      <span className={`px-1.5 py-0.5 rounded flex items-center space-x-1 ${integration.status === 'active' ? 'bg-zinc-800' : integration.status === 'error' ? 'bg-red-500/10 text-red-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
                        {integration.status === 'syncing' && <RefreshCw className="w-3 h-3 animate-spin mr-1" />}
                        <span>{integration.status}</span>
                      </span>
                      {integration.metadata && <span className="truncate">{integration.metadata}</span>}
                    </div>
                    {integration.status === 'active' && (
                      <button 
                        onClick={() => initRepo(integration.name)}
                        className="mt-2 w-full py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 text-[10px] font-bold uppercase rounded-lg border border-indigo-500/20 flex items-center justify-center space-x-1 transition-all"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Initialize Engine Report</span>
                      </button>
                    )}
                    {integration.tree && integration.tree.length > 0 && (
                      <div className="mt-3 border-t border-zinc-800 pt-2">
                        <div 
                          className="text-[10px] font-bold text-zinc-500 mb-1 flex items-center justify-between cursor-pointer hover:text-zinc-400 transition-colors" 
                          onClick={() => toggleTree(integration.id)}
                        >
                           <span>File Tree (Preview)</span>
                           {expandedTrees[integration.id] ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        </div>
                        {expandedTrees[integration.id] && (
                           <div className="text-xs text-zinc-400 max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar mt-2">
                              {integration.tree.map(file => (
                                 <div 
                                    key={file} 
                                    className="truncate hover:text-indigo-400 cursor-pointer py-0.5" 
                                    onClick={() => openFile(integration.name, file)}
                                    title={file}
                                 >
                                    <FileCode className="w-3 h-3 inline mr-1.5 text-zinc-600" />
                                    {file}
                                 </div>
                              ))}
                           </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {showAddRepo ? (
                  <form onSubmit={addIntegration} className="bg-zinc-900 rounded-xl p-3 border border-indigo-500/50 shadow-[0_0_15px_rgba(99,102,241,0.1)]">
                    <input
                      type="text"
                      value={repoInput}
                      onChange={e => setRepoInput(e.target.value)}
                      placeholder="e.g. facebook/react"
                      className="w-full bg-zinc-800 border border-zinc-700 rounded p-2 text-xs text-zinc-200 outline-none focus:border-indigo-500 mb-2"
                      autoFocus
                    />
                    <div className="flex space-x-2">
                      <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase py-1.5 rounded transition">Connect</button>
                      <button type="button" onClick={() => setShowAddRepo(false)} className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[10px] font-bold uppercase py-1.5 rounded transition">Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button 
                    onClick={() => setShowAddRepo(true)}
                    className="w-full flex items-center justify-center space-x-2 py-2 border border-dashed border-zinc-700 rounded-xl text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all text-xs font-semibold"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Open GitHub Repo</span>
                  </button>
                )}
              </div>
            </section>

            <section>
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest block mb-3">Integrations</label>
              <div className="space-y-2">
                {githubToken ? (
                  <div className="flex items-center justify-between p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                    <div className="flex items-center space-x-2">
                      <Github className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-xs text-emerald-400 font-medium tracking-wide">Developer Authorized</span>
                    </div>
                    <button onClick={() => setGithubToken('')} className="text-[9px] text-zinc-500 hover:text-red-400 uppercase font-bold tracking-widest pl-2">Disconnect</button>
                  </div>
                ) : (
                  <button 
                    onClick={async () => {
                      try {
                        const response = await fetch('/api/auth/url');
                        if (!response.ok) throw new Error('Failed to get auth URL');
                        const { url } = await response.json();
                        const authWindow = window.open(url, 'oauth_popup', 'width=600,height=700');
                        if (!authWindow) alert('Please allow popups for this site to connect your account.');
                      } catch (error) {
                        console.error('OAuth error:', error);
                      }
                    }}
                    className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-xs font-medium transition-colors border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200 flex items-center justify-center space-x-2"
                  >
                    <Github className="w-3.5 h-3.5" />
                    <span>Connect GitHub Account</span>
                  </button>
                )}
              </div>
              <button 
                onClick={() => {}}
                className="w-full mt-3 py-2 bg-zinc-900 rounded-lg text-xs font-medium transition-colors border border-zinc-800 text-zinc-600"
              >
                + Connect External API/DB
              </button>
            </section>
          </div>
        </aside>

        {/* Main Content Area */}
        {activeTab === 'stt' ? (
          <main className="flex-1 flex flex-col items-center justify-start sm:p-8 p-4 relative bg-[#09090b] overflow-y-auto">
             <div className="w-full max-w-4xl flex flex-col space-y-4 sm:space-y-6 pb-20">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between space-y-3 sm:space-y-0">
                   <div>
                     <h2 className="text-xl sm:text-2xl font-semibold tracking-tight text-zinc-100">Dictation Studio</h2>
                     <p className="text-xs sm:text-sm text-zinc-500 mt-1">Standalone speech-to-text functionality.</p>
                   </div>
                   <div className="flex items-center space-x-2 sm:space-x-3">
                      <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1 mr-2 sm:mr-4">
                         <button
                            onClick={() => setConfig({...config, sttMode: 'fast'})}
                            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${config.sttMode === 'fast' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                         >
                            Fast (Live)
                         </button>
                         <button
                            onClick={() => setConfig({...config, sttMode: 'detailed'})}
                            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${config.sttMode === 'detailed' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                         >
                            Detailed (Gemini)
                         </button>
                      </div>
                      <button 
                         onClick={() => { 
                           setSttText(''); 
                           setInterimText(''); 
                           if (isRecording) toggleRecording();
                           setIsTranscribing(false);
                         }}
                         className="px-3 sm:px-4 py-2 border border-red-900/30 hover:bg-red-900/20 text-red-400 rounded-xl text-xs sm:text-sm font-medium transition-colors flex items-center space-x-2"
                      >
                         <RefreshCw className={`w-3.5 h-3.5 ${isTranscribing ? 'animate-spin' : ''}`} />
                         <span>Reset Studio</span>
                      </button>
                      <button 
                         onClick={() => navigator.clipboard.writeText(sttText)}
                         className="px-3 sm:px-4 py-2 bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600/20 rounded-xl text-xs sm:text-sm font-medium transition-colors border border-indigo-500/20"
                      >
                         Copy Text
                      </button>
                   </div>
                </div>

                <div className="bg-[#0c0c0e] border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col space-y-4">
                   {config.sttMode === 'detailed' && (
                     <div className="space-y-4">
                       <div>
                         <div className="flex items-center justify-between mb-2">
                           <label className="text-xs font-bold text-zinc-500 block uppercase tracking-widest">Transcription Preset</label>
                           <span className="text-[10px] text-zinc-500">Pick a prompt style for Gemini</span>
                         </div>
                         <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                           {Object.entries(STT_PROMPTS).map(([key, val]) => (
                             <button
                               key={key}
                               onClick={() => setSttPrompt(val)}
                               className={`px-3 py-2 text-[10px] sm:text-xs font-semibold rounded-lg border transition-all ${sttPrompt === val ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.2)]' : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400'}`}
                             >
                               {key.charAt(0).toUpperCase() + key.slice(1)}
                             </button>
                           ))}
                         </div>
                       </div>
                       <div>
                         <div className="flex items-center justify-between mb-1">
                           <label className="text-xs font-bold text-zinc-100 block uppercase tracking-widest">Custom Engine Instructions</label>
                           <span className="text-[10px] text-indigo-400 bg-indigo-400/10 px-2 py-0.5 rounded-full">Gemini Multimodal Processing</span>
                         </div>
                         <textarea 
                            value={sttPrompt}
                            onChange={e => setSttPrompt(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 focus:border-indigo-500 outline-none resize-none h-20 placeholder-zinc-600 transition-all focus:bg-zinc-800/50"
                            placeholder="e.g. Clean up grammar, remove stutters, format in markdown..."
                         />
                       </div>
                     </div>
                   )}
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {config.sttMode === 'detailed' && (
                        <div>
                          <label className="text-xs font-bold text-zinc-500 mb-1 block uppercase tracking-widest">Input Device</label>
                          <select 
                            value={selectedDeviceId}
                            onChange={(e) => setSelectedDeviceId(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-sm text-zinc-300 focus:border-indigo-500 outline-none"
                          >
                            <option value="">System Default Microphone</option>
                            {audioDevices.map(device => (
                              <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${device.deviceId.substring(0,5)}`}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className={config.sttMode === 'fast' ? "col-span-1 sm:col-span-2" : ""}>
                        <label className="text-xs font-bold text-zinc-500 mb-1 block uppercase tracking-widest">Upload Audio File (Any STT mode)</label>
                        <input 
                          type="file" 
                          accept="audio/*"
                          ref={fileInputRef}
                          onChange={handleFileUpload}
                          className="hidden" 
                        />
                        <button 
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center justify-center space-x-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl p-2.5 text-sm text-zinc-300 focus:border-indigo-500 outline-none transition-colors"
                        >
                          <Upload className="w-4 h-4" />
                          <span>Select Audio File to Transcribe</span>
                        </button>
                      </div>
                   </div>
                </div>
                
                <div className="min-h-[400px] sm:min-h-[500px] relative group bg-[#0c0c0e] rounded-2xl border border-zinc-800 overflow-hidden shadow-2xl flex flex-col">
                   {isTranscribing && (
                      <div className="absolute inset-0 bg-[#0c0c0e]/80 backdrop-blur z-10 flex flex-col items-center justify-center">
                         <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                         <p className="text-indigo-400 font-medium tracking-wide">Processing Audio...</p>
                      </div>
                   )}
                   <textarea
                      value={sttText + (interimText ? (sttText ? '\n\n' : '') + interimText : '')}
                      onChange={(e) => setSttText(e.target.value)}
                      placeholder="Click the microphone to start dictating..."
                      className="w-full h-full min-h-[400px] sm:min-h-[500px] bg-transparent p-4 sm:p-6 text-lg sm:text-xl text-zinc-200 focus:outline-none transition-all resize-none leading-relaxed custom-scrollbar placeholder-zinc-700 font-medium"
                      style={{ display: sttViewMode === 'edit' ? 'block' : 'none' }}
                   />
                   <div 
                      className="w-full h-full min-h-[400px] sm:min-h-[500px] bg-transparent p-4 sm:p-6 text-lg sm:text-xl text-zinc-200 overflow-y-auto leading-relaxed custom-scrollbar font-medium"
                      style={{ display: sttViewMode === 'preview' ? 'block' : 'none' }}
                   >
                     {sttText || interimText ? (
                        <div className="markdown-body prose prose-invert max-w-none">
                           <Markdown remarkPlugins={[remarkGfm]}>
                             {sttText + (interimText ? (sttText ? '\n\n' : '') + interimText : '')}
                           </Markdown>
                        </div>
                     ) : (
                        <span className="text-zinc-700">Click the microphone to start dictating...</span>
                     )}
                   </div>
                   
                   <div className="absolute top-4 right-4 flex bg-[#18181b] border border-zinc-800 rounded-lg p-1 z-20">
                     <button
                        onClick={() => setSttViewMode('preview')}
                        className={`px-3 py-1 text-xs rounded-md font-semibold transition-all ${sttViewMode === 'preview' ? 'bg-indigo-600 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                     >
                        Preview
                     </button>
                     <button
                        onClick={() => setSttViewMode('edit')}
                        className={`px-3 py-1 text-xs rounded-md font-semibold transition-all ${sttViewMode === 'edit' ? 'bg-zinc-700 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                     >
                        Edit
                     </button>
                   </div>

                   <div className="absolute bottom-6 sm:bottom-8 right-6 sm:right-8 flex flex-col items-center space-y-2 sm:space-y-3 z-20">
                      {isRecording && (
                        <div className="bg-zinc-900/80 backdrop-blur border border-zinc-800 px-3 py-1 rounded-full text-indigo-400 font-mono text-xs sm:text-sm shadow-xl font-bold tracking-widest mb-1">
                          {formatTime(recordingDuration)}
                        </div>
                      )}
                      <div className="flex items-center space-x-3 sm:space-x-4 bg-[#0c0c0e]/80 p-2 sm:p-0 rounded-full sm:bg-transparent backdrop-blur sm:backdrop-blur-none">
                        <button 
                           onClick={toggleRecording}
                           className={`p-4 sm:p-5 rounded-full transition-all duration-300 ${isRecording ? 'bg-red-500 hover:bg-red-600 text-white shadow-[0_0_40px_rgba(239,68,68,0.5)] scale-110' : 'bg-zinc-800 hover:bg-indigo-600 text-zinc-300 hover:text-white shadow-xl'}`}
                           title={isRecording ? "Stop recording" : "Start recording"}
                        >
                           {isRecording ? <Square className="w-5 h-5 sm:w-7 sm:h-7 fill-current" /> : <Mic className="w-5 h-5 sm:w-7 sm:h-7" />}
                        </button>
                        {isRecording && config.sttMode !== 'detailed' && (
                           <button 
                              onClick={togglePause}
                              className={`p-3 sm:p-4 rounded-full transition-all duration-300 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shadow-xl ${isPaused ? 'text-emerald-400 hover:text-emerald-300' : ''}`}
                              title={isPaused ? "Resume recording" : "Pause recording"}
                           >
                              {isPaused ? <Play className="w-5 h-5 sm:w-6 sm:h-6 fill-current ml-1" /> : <Pause className="w-5 h-5 sm:w-6 sm:h-6 fill-current" />}
                           </button>
                        )}
                      </div>
                      <div className="h-4">
                        {isRecording && !isPaused && <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-red-400 animate-pulse">Recording</span>}
                        {isPaused && <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-zinc-500">Paused</span>}
                      </div>
                   </div>
                </div>
             </div>
          </main>
        ) : (
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
                    {message.content && (
                      <div className="bg-zinc-900 border border-zinc-800 px-5 py-4 rounded-2xl rounded-tl-none w-full shadow-sm">
                        <div className="text-sm leading-relaxed text-zinc-300 markdown-body">
                          <Markdown 
                            remarkPlugins={[remarkGfm]}
                            components={{
                              code({node, inline, className, children, ...props}: any) {
                                const match = /language-(\w+)/.exec(className || '')
                                return !inline && match ? (
                                  <div className="relative my-4">
                                    <SyntaxHighlighter
                                      style={vscDarkPlus as any}
                                      language={match[1]}
                                      PreTag="div"
                                      className="rounded-lg !bg-[#111113] !border !border-zinc-800 !m-0"
                                      {...props}
                                    >
                                      {String(children).replace(/\n$/, '')}
                                    </SyntaxHighlighter>
                                  </div>
                                ) : (
                                  <code className={`${className} bg-zinc-800 px-1 py-0.5 rounded text-indigo-300 font-mono text-xs`} {...props}>
                                    {children}
                                  </code>
                                )
                              },
                              a({node, className, children, href, ...props}: any) {
                                if (href?.startsWith('file://')) {
                                  const pathPart = href.substring(7);
                                  const firstSlash = pathPart.indexOf('/');
                                  let repo = pathPart;
                                  let filePath = '';
                                  if (firstSlash !== -1 && pathPart.indexOf('/', firstSlash + 1) !== -1) {
                                    const secondSlash = pathPart.indexOf('/', firstSlash + 1);
                                    if (secondSlash !== -1) {
                                      repo = pathPart.substring(0, secondSlash);
                                      filePath = pathPart.substring(secondSlash + 1);
                                    } else {
                                      repo = pathPart;
                                      filePath = '';
                                    }
                                  }
                                  return (
                                    <button
                                      type="button" 
                                      className="text-indigo-400 hover:text-indigo-300 underline cursor-pointer inline" 
                                      onClick={(e) => { e.preventDefault(); openFile(repo, filePath); }}
                                    >
                                      {children}
                                    </button>
                                  );
                                }
                                return <a href={href} className="text-indigo-400 hover:text-indigo-300 underline" target="_blank" rel="noreferrer" {...props}>{children}</a>;
                              }
                            }}
                          >
                            {message.content}
                          </Markdown>
                        </div>
                        
                        <div className="mt-4 border-t border-zinc-800/80 pt-3 flex items-center justify-between">
                          <button 
                            onClick={() => handleTTS(message.content)}
                            className="flex items-center space-x-2 text-[10px] font-bold text-indigo-400 uppercase hover:text-indigo-300 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Listen (TTS)</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
            {isLoading && loadingStatus && (
              <div className="flex items-start space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-6 h-6 bg-zinc-800 rounded flex items-center justify-center shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                    <Cpu className="w-3 h-3 text-indigo-400 animate-pulse" />
                  </div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400 animate-pulse">{loadingStatus}</span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Floating Input Bar */}
          <div className="absolute bottom-0 left-0 w-full p-3 sm:p-6 bg-gradient-to-t from-[#09090b] via-[#09090b] to-transparent pt-8 sm:pt-12">
            <div className="relative max-w-4xl mx-auto">
              {/* Mic STT Button */}
              <div className="absolute left-2 sm:left-3 top-1/2 -translate-y-1/2 flex items-center space-x-2 z-10">
                <button 
                  onClick={toggleRecording}
                  className={`p-2 sm:p-2.5 rounded-full transition-all duration-300 ${isRecording ? 'bg-red-500/20 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.3)]' : 'hover:bg-zinc-800 text-zinc-500 hover:text-indigo-400'}`}
                  title={isRecording ? "Stop recording (STT)" : "Start voice typing (STT)"}
                >
                  {isRecording ? <Square className="w-4 h-4 sm:w-5 sm:h-5 fill-current" /> : <Mic className="w-4 h-4 sm:w-5 sm:h-5" />}
                </button>
              </div>
              
                <div className="relative">
                  <input 
                    type="text" 
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isRecording ? "Listening..." : "Describe a feature or ask..."}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl sm:rounded-2xl py-3 sm:py-4 pl-12 sm:pl-16 pr-[90px] sm:pr-36 text-xs sm:text-sm focus:outline-none focus:border-indigo-500/50 transition-all placeholder-zinc-600 shadow-[0_8px_30px_rgb(0,0,0,0.4)]" 
                  />
                  {suggestion && (
                    <div className="absolute left-12 sm:left-16 top-1/2 -translate-y-1/2 pointer-events-none text-xs sm:text-sm">
                      <span className="text-transparent">{input}</span>
                      <span className="text-zinc-600 italic">{suggestion} </span>
                      <span className="text-[10px] text-zinc-700 ml-1 font-bold">[TAB]</span>
                    </div>
                  )}
                </div>
              
              <div className="absolute right-1 sm:right-2 top-1/2 -translate-y-1/2 flex items-center space-x-2 z-10">
                <button 
                  onClick={() => sendMessage()}
                  disabled={!input.trim() || isLoading}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[10px] sm:text-xs font-semibold transition-colors flex items-center space-x-1"
                >
                  <span className="hidden sm:inline">Ask Engine</span>
                  <span className="inline sm:hidden">Send</span>
                  <Send className="w-3 h-3 ml-1" />
                </button>
              </div>
            </div>
            <div className="flex justify-center mt-3 sm:mt-4 space-x-4 sm:space-x-6 pb-2">
              <div className="flex items-center space-x-2 text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-tighter font-medium">
                <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full shadow-[0_0_8px_rgba(99,102,241,0.6)]"></span>
                <span className="hidden sm:inline">Gemini 3 Flash Tools</span>
                <span className="inline sm:hidden">Gemini</span>
              </div>
              <div className="flex items-center space-x-2 text-[9px] sm:text-[10px] text-zinc-500 uppercase tracking-tighter font-medium">
                <span className={`w-1.5 h-1.5 rounded-full ${integrations.some(i => i.status === 'syncing') ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}></span>
                <span>Context Connected</span>
              </div>
            </div>
          </div>
        </main>
        )}
      </div>

      {fileModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#0f0f11] border border-zinc-800 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800 bg-[#141417]">
              <div className="flex items-center space-x-2">
                <FileCode className="w-5 h-5 text-indigo-400" />
                <span className="font-medium text-sm text-zinc-200">{fileModal.repo} / <span className="text-zinc-400">{fileModal.path}</span></span>
              </div>
              <button 
                onClick={() => setFileModal(null)}
                className="p-1 hover:bg-zinc-800 rounded-md transition-colors"
                title="Close"
              >
                <X className="w-5 h-5 text-zinc-500 hover:text-zinc-300" />
              </button>
            </div>
            <div className="flex-1 overflow-auto bg-[#1e1e1e] relative custom-scrollbar">
              {fileModal.loading ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="flex items-center space-x-2 text-zinc-500">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading file content...</span>
                  </div>
                </div>
              ) : (
                <SyntaxHighlighter
                  style={vscDarkPlus as any}
                  language={fileModal.path.split('.').pop() || 'text'}
                  PreTag="div"
                  customStyle={{ margin: 0, padding: '1.5rem', background: 'transparent' }}
                  showLineNumbers={true}
                >
                  {fileModal.content}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
        </div>
      )}

      {isConfigOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-[#141417] border border-zinc-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-5 border-b border-zinc-800">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center">
                   <Settings className="w-4 h-4 text-indigo-400" />
                </div>
                <span className="font-semibold text-zinc-100">Engine Configuration</span>
              </div>
              <button 
                onClick={() => setIsConfigOpen(false)}
                className="p-2 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-zinc-500 hover:text-zinc-300" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2">Speech Services</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-300 block">STT Language (Input)</label>
                    <select 
                      value={config.sttLanguage}
                      onChange={(e) => setConfig({...config, sttLanguage: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none shrink-0"
                    >
                      <option value="en-US">English (US)</option>
                      <option value="en-GB">English (UK)</option>
                      <option value="pt-BR">Portuguese (Brazil)</option>
                      <option value="es-ES">Spanish (Spain)</option>
                      <option value="fr-FR">French (France)</option>
                      <option value="de-DE">German (Germany)</option>
                    </select>
                  </div>

                  <div className="space-y-2 col-span-2 sm:col-span-1">
                    <label className="text-xs font-medium text-zinc-300 block">TTS Voice (Output)</label>
                    <select 
                      value={config.ttsVoice}
                      onChange={(e) => setConfig({...config, ttsVoice: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none shrink-0"
                    >
                      <option value="Gemini Kore">Gemini Kore</option>
                      <option value="Gemini Puck">Gemini Puck</option>
                      <option value="Gemini Charon">Gemini Charon</option>
                      <option value="Gemini Fenrir">Gemini Fenrir</option>
                      <option value="Gemini Zephyr">Gemini Zephyr</option>
                      <option value="Gemini Aoede">Gemini Aoede</option>
                      <option disabled>──────────</option>
                      <option value="">Default OS Voice</option>
                      {availableVoices.map((v, idx) => (
                        <option key={`${v.voiceURI}-${idx}`} value={v.name}>{v.name} ({v.lang})</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="text-sm font-bold text-zinc-400 uppercase tracking-widest border-b border-zinc-800 pb-2">Generation Model</h3>
                
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-300 block">Model Selection</label>
                    <select 
                      value={config.model}
                      onChange={(e) => setConfig({...config, model: e.target.value})}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg p-2.5 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none shrink-0"
                    >
                      <option value="gemini-3-flash-preview">Gemini 3 Flash (Fast)</option>
                      <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Reasoning)</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <label className="text-xs font-medium text-zinc-300 block">Temperature</label>
                      <span className="text-xs text-indigo-400">{config.temperature.toFixed(2)}</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" max="2" step="0.1" 
                      value={config.temperature}
                      onChange={(e) => setConfig({...config, temperature: parseFloat(e.target.value)})}
                      className="w-full accent-indigo-500"
                    />
                    <div className="flex justify-between text-[10px] text-zinc-500">
                      <span>Precise</span>
                      <span>Creative</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                   <label className="text-xs font-medium text-zinc-300 block">System Prompt</label>
                   <p className="text-[10px] text-zinc-500 mb-2">Use {'{context}'} placeholder to inject repository integration instructions.</p>
                   <textarea 
                     value={config.systemPrompt}
                     onChange={(e) => setConfig({...config, systemPrompt: e.target.value})}
                     className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-200 focus:border-indigo-500 focus:outline-none h-32 custom-scrollbar resize-none font-mono text-xs"
                   />
                </div>
              </div>
            </div>
            <div className="p-5 border-t border-zinc-800 bg-[#0f0f12] flex justify-end">
               <button 
                 onClick={() => setIsConfigOpen(false)}
                 className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-2 rounded-xl text-sm font-semibold transition-colors shadow-[0_4px_14px_0_rgba(99,102,241,0.39)]"
               >
                 Save & Apply
               </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
