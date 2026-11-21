import React, { useState, useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { aiAssistant, LocalAIStatus } from '../services/aiAssistant';
import { converterService } from '../services/converter';
import {
  Bot,
  X,
  Send,
  Sparkles,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  DollarSign,
  Settings,
  RefreshCw,
  ExternalLink,
  Copy,
  Check,
  Terminal,
  Cpu,
  Download,
  Layers,
} from 'lucide-react';

interface AIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  time: string;
}

const POPULAR_MODELS = [
  {
    id: 'llama3',
    name: 'Meta Llama 3 (8B)',
    cmd: 'ollama run llama3',
    tag: 'Recommended',
    desc: 'Best overall accuracy, reasoning & document summarization. Needs ~8GB RAM.',
  },
  {
    id: 'phi3',
    name: 'Microsoft Phi-3 Mini (3.8B)',
    cmd: 'ollama run phi3',
    tag: 'Lightweight',
    desc: 'Ultra-fast inference on laptops & older PCs. Runs smoothly on 4GB-8GB RAM.',
  },
  {
    id: 'mistral',
    name: 'Mistral (7B)',
    cmd: 'ollama run mistral',
    tag: 'High Precision',
    desc: 'Strong contract analysis, structured tables & key terms extraction.',
  },
  {
    id: 'qwen2.5',
    name: 'Qwen 2.5 (7B)',
    cmd: 'ollama run qwen2.5',
    tag: 'Multilingual',
    desc: 'Excellent with multilingual PDFs, technical reports & coding terms.',
  },
];

export const AIAssistantModal: React.FC<AIAssistantModalProps> = ({ isOpen, onClose }) => {
  const { pdfBytes, currentFileName } = useEditorStore();
  const [viewMode, setViewMode] = useState<'chat' | 'setup'>('chat');
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome_1',
      sender: 'assistant',
      text: 'Hello! I am your 100% Offline Local AI Assistant. I analyze, summarize, and answer questions about your PDF document completely on your PC with zero cloud access and total privacy.',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);
  const [promptInput, setPromptInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<LocalAIStatus | null>(null);

  // Setup view states
  const [endpointInput, setEndpointInput] = useState(aiAssistant.getEndpoint());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<LocalAIStatus | null>(null);
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setEndpointInput(aiAssistant.getEndpoint());
      refreshStatus();
    }
  }, [isOpen]);

  const refreshStatus = async (customEndpoint?: string) => {
    setIsTesting(true);
    try {
      const status = await aiAssistant.checkStatus(customEndpoint);
      setAiStatus(status);
      setTestResult(status);
      if (!status.isAvailable) {
        setViewMode('setup');
      }
      return status;
    } finally {
      setIsTesting(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await aiAssistant.testConnection(endpointInput.trim());
      setAiStatus(res);
      setTestResult(res);
    } catch (err: any) {
      const fallback: LocalAIStatus = {
        isAvailable: false,
        models: [],
        activeModel: aiAssistant.getDefaultModel(),
        endpoint: endpointInput.trim(),
        error: err.message || 'Connection test failed',
      };
      setAiStatus(fallback);
      setTestResult(fallback);
    } finally {
      setIsTesting(false);
    }
  };

  const handleModelChange = (modelName: string) => {
    aiAssistant.setDefaultModel(modelName);
    if (aiStatus) {
      setAiStatus({ ...aiStatus, activeModel: modelName });
    }
    if (testResult) {
      setTestResult({ ...testResult, activeModel: modelName });
    }
  };

  const handleCopyCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(cmd);
    setTimeout(() => setCopiedCmd(null), 2500);
  };

  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const handleOpenOllamaDownload = () => {
    if (typeof window !== 'undefined' && window.electronAPI?.openExternalUrl) {
      window.electronAPI.openExternalUrl('https://ollama.com/download');
    } else {
      window.open('https://ollama.com/download', '_blank');
    }
  };

  const handleSendPrompt = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || promptInput;
    if (!textToSend.trim() || !pdfBytes) return;

    if (!aiStatus?.isAvailable) {
      setViewMode('setup');
      return;
    }

    const userMsg: Message = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: textToSend,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!overridePrompt) setPromptInput('');
    setIsLoading(true);

    try {
      const docText = await converterService.pdfToText(pdfBytes);
      if (!docText || docText.trim().length === 0) {
        throw new Error('No readable text found in document. If this is a scanned document, run OCR first.');
      }
      const answer = await aiAssistant.queryDocument(docText, textToSend, aiStatus.activeModel);

      const assistantMsg: Message = {
        id: `asst_${Date.now()}`,
        sender: 'assistant',
        text: answer,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'assistant',
          text: `Local AI Error: ${err.message}. Check your local Ollama daemon or click "Setup & Connection" above to verify.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-slate-900 border-l border-slate-800 shadow-2xl z-50 flex flex-col text-slate-100 select-none">
      {/* 1. Header */}
      <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/80 backdrop-blur-md">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
            <Bot className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-bold text-xs text-white">Local AI Document Assistant</h3>
            <div className="flex items-center space-x-1.5 text-[10px] text-slate-400">
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>100% Offline &amp; Private</span>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-1">
          <button
            onClick={() => setViewMode((m) => (m === 'chat' ? 'setup' : 'chat'))}
            className={`p-1.5 rounded-lg transition-colors flex items-center space-x-1 text-xs ${
              viewMode === 'setup'
                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                : 'text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
            title={viewMode === 'chat' ? 'Setup Guide & Connection' : 'Return to Chat'}
          >
            <Settings className="w-4 h-4" />
            <span className="text-[11px] font-medium hidden sm:inline">
              {viewMode === 'chat' ? 'Setup' : 'Chat'}
            </span>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            title="Close Assistant"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Top Connection Banner */}
      <div className="px-4 py-2 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between text-[11px]">
        <div className="flex items-center space-x-2 overflow-hidden">
          <span className="text-slate-400 shrink-0">Status:</span>
          {aiStatus?.isAvailable ? (
            <div className="flex items-center space-x-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
              <span className="text-emerald-300 font-medium truncate font-mono text-[10.5px]">
                Ollama Online ({aiStatus.activeModel})
              </span>
              {aiStatus.latencyMs !== undefined && (
                <span className="text-slate-500 text-[10px]">({aiStatus.latencyMs}ms)</span>
              )}
            </div>
          ) : (
            <div className="flex items-center space-x-1 text-amber-400 text-[10.5px] truncate">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Ollama not detected</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            onClick={() => refreshStatus()}
            disabled={isTesting}
            className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title="Test / Refresh connection"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-sky-400' : ''}`} />
          </button>
          {!aiStatus?.isAvailable && viewMode !== 'setup' && (
            <button
              onClick={() => setViewMode('setup')}
              className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/30 font-semibold transition-colors"
            >
              Setup Guide
            </button>
          )}
        </div>
      </div>

      {/* 3. Main Body: Setup Guide or Chat */}
      {viewMode === 'setup' ? (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {/* Welcome Card */}
          <div className="bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-900 p-4 rounded-xl border border-indigo-500/30 space-y-2">
            <div className="flex items-center space-x-2 text-indigo-300 font-bold">
              <Cpu className="w-4 h-4" />
              <span>Offline Local AI Setup Guide</span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              NovaPDFPro connects directly to your local PC&apos;s AI runtime (Ollama or LM Studio).
              Your documents never touch any cloud server, preserving 100% data confidentiality.
            </p>
          </div>

          {/* Test & Configure Endpoint */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <label className="block text-[11px] font-semibold text-slate-200">
              Local AI Server Endpoint
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                value={endpointInput}
                onChange={(e) => setEndpointInput(e.target.value)}
                placeholder="http://localhost:11434"
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 font-mono text-[11px] text-sky-200 outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !endpointInput.trim()}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-semibold flex items-center space-x-1.5 shrink-0 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`} />
                <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
              </button>
            </div>

            {/* Test Results Output */}
            {testResult && (
              <div
                className={`p-3 rounded-lg border text-[11px] ${
                  testResult.isAvailable
                    ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-200'
                    : 'bg-red-950/40 border-red-500/40 text-red-200'
                }`}
              >
                {testResult.isAvailable ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between font-semibold">
                      <span className="flex items-center space-x-1.5 text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>Connected successfully!</span>
                      </span>
                      {testResult.latencyMs !== undefined && (
                        <span className="font-mono text-[10px] text-emerald-400">
                          {testResult.latencyMs} ms
                        </span>
                      )}
                    </div>
                    {testResult.models && testResult.models.length > 0 ? (
                      <div className="space-y-1.5 pt-1 border-t border-emerald-500/20">
                        <span className="text-[10px] text-slate-300 block">
                          Select Active Model ({testResult.models.length} installed):
                        </span>
                        <select
                          value={testResult.activeModel}
                          onChange={(e) => handleModelChange(e.target.value)}
                          className="w-full bg-slate-900 border border-emerald-500/30 rounded px-2 py-1 text-[11px] text-emerald-200 outline-none font-mono"
                        >
                          {testResult.models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <p className="text-[10.5px] text-amber-300 mt-1">
                        Connected, but no models found. Run a command below to download a model.
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={() => setViewMode('chat')}
                      className="w-full mt-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors"
                    >
                      Save &amp; Start Chatting
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center space-x-1.5 font-semibold text-red-300">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Connection Failed</span>
                    </div>
                    <p className="text-[10.5px] text-slate-300">
                      {testResult.error || 'Ollama is not running on localhost:11434'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 1: Install Ollama */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white flex items-center space-x-1.5">
                <span className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 flex items-center justify-center text-[10px] font-bold">
                  1
                </span>
                <span>Download &amp; Install Ollama</span>
              </span>
              <button
                type="button"
                onClick={handleOpenOllamaDownload}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-semibold transition-colors"
              >
                <Download className="w-3 h-3" />
                <span>Download for Windows</span>
                <ExternalLink className="w-2.5 h-2.5 ml-0.5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Ollama is a free, open-source Windows runtime for offline AI. Run the installer once; it starts automatically in your Windows taskbar.
            </p>
          </div>

          {/* Step 2: Choose and Run a Model */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-3">
            <div className="flex items-center space-x-1.5 font-semibold text-white">
              <span className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 flex items-center justify-center text-[10px] font-bold">
                2
              </span>
              <span>Open PowerShell or CMD &amp; Run Model</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Open your Windows PowerShell or Command Prompt, then paste and run one of the following commands:
            </p>

            <div className="space-y-2">
              {POPULAR_MODELS.map((model) => (
                <div
                  key={model.id}
                  className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-200 text-xs flex items-center space-x-1.5">
                      <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{model.name}</span>
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-indigo-950 text-indigo-300 border border-indigo-800/60">
                      {model.tag}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400">{model.desc}</p>
                  <div className="flex items-center justify-between bg-slate-950 px-2 py-1 rounded font-mono text-[11px] text-sky-300 border border-slate-800">
                    <code>{model.cmd}</code>
                    <button
                      type="button"
                      onClick={() => handleCopyCommand(model.cmd)}
                      className="p-1 text-slate-400 hover:text-white transition-colors"
                      title="Copy command"
                    >
                      {copiedCmd === model.cmd ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {copiedCmd && (
              <div className="text-[10px] text-emerald-400 flex items-center space-x-1 justify-center">
                <CheckCircle2 className="w-3 h-3" />
                <span>Command copied! Paste into Windows PowerShell and press Enter.</span>
              </div>
            )}
          </div>

          {/* Step 3: Test and Enjoy */}
          <div className="bg-slate-950/70 p-3.5 rounded-xl border border-slate-800 space-y-2">
            <div className="flex items-center space-x-1.5 font-semibold text-white">
              <span className="w-5 h-5 rounded-full bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 flex items-center justify-center text-[10px] font-bold">
                3
              </span>
              <span>Test Connection &amp; Chat</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Once the model starts running, click the <strong>Test Connection</strong> button above. NovaPDFPro will immediately detect the model and unlock private document analysis.
            </p>
          </div>
        </div>
      ) : (
        /* Chat View */
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Active Model & Document Bar */}
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between text-[11px]">
            <div className="flex items-center space-x-1.5 text-slate-300 truncate">
              <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span className="truncate max-w-[200px]" title={currentFileName || 'No Document'}>
                {currentFileName || 'No PDF opened'}
              </span>
            </div>

            {aiStatus?.models && aiStatus.models.length > 1 && (
              <select
                value={aiStatus.activeModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-sky-200 outline-none font-mono"
              >
                {aiStatus.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Quick Prompt Shortcuts */}
          <div className="p-3 border-b border-slate-800 flex flex-wrap gap-1.5 bg-slate-900/90">
            <button
              onClick={() =>
                handleSendPrompt('Provide an executive summary of this document with key bullet points.')
              }
              disabled={!pdfBytes || isLoading}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-[10.5px] border border-slate-700 transition-colors"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Executive Summary</span>
            </button>

            <button
              onClick={() =>
                handleSendPrompt('Extract all dates, deadlines, and milestones mentioned in this document.')
              }
              disabled={!pdfBytes || isLoading}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-[10.5px] border border-slate-700 transition-colors"
            >
              <Clock className="w-3 h-3 text-sky-400" />
              <span>Key Dates</span>
            </button>

            <button
              onClick={() =>
                handleSendPrompt('Extract all financial amounts, prices, totals, or payment terms.')
              }
              disabled={!pdfBytes || isLoading}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-[10.5px] border border-slate-700 transition-colors"
            >
              <DollarSign className="w-3 h-3 text-emerald-400" />
              <span>Financials</span>
            </button>

            <button
              onClick={() =>
                handleSendPrompt('List all critical obligations, requirements, and action items in this document.')
              }
              disabled={!pdfBytes || isLoading}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 text-[10.5px] border border-slate-700 transition-colors"
            >
              <Layers className="w-3 h-3 text-purple-400" />
              <span>Obligations</span>
            </button>
          </div>

          {/* Messages Scroll Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[88%] rounded-xl p-3 leading-relaxed relative group ${
                    m.sender === 'user'
                      ? 'bg-indigo-600 text-white rounded-br-none shadow-md'
                      : 'bg-slate-800 border border-slate-700/80 text-slate-200 rounded-bl-none shadow-sm'
                  }`}
                >
                  <p className="whitespace-pre-wrap selection:bg-indigo-500/40">{m.text}</p>

                  {m.sender === 'assistant' && (
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(m.id, m.text)}
                      className="absolute top-2 right-2 p-1 rounded bg-slate-900/60 opacity-0 group-hover:opacity-100 hover:bg-slate-900 text-slate-400 hover:text-white transition-all"
                      title="Copy response"
                    >
                      {copiedMsgId === m.id ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  )}
                </div>
                <span className="text-[9px] text-slate-500 font-mono mt-1 px-1">{m.time}</span>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-center space-x-2 text-xs text-indigo-400 animate-pulse p-2 bg-indigo-950/20 rounded-lg border border-indigo-800/30">
                <Sparkles className="w-4 h-4 text-indigo-400 animate-spin" />
                <span>Analyzing document with local model ({aiStatus?.activeModel || 'Ollama'})...</span>
              </div>
            )}
          </div>

          {/* Input Box */}
          <div className="p-3 border-t border-slate-800 bg-slate-950">
            <div className="flex items-center space-x-2 bg-slate-900 border border-slate-700/80 rounded-xl p-1.5 focus-within:border-indigo-500 transition-colors">
              <input
                type="text"
                placeholder={pdfBytes ? 'Ask anything about this document...' : 'Open a PDF document first...'}
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSendPrompt()}
                disabled={!pdfBytes || isLoading}
                className="flex-1 bg-transparent border-0 text-xs text-slate-100 outline-none px-2.5 placeholder:text-slate-500"
              />
              <button
                onClick={() => handleSendPrompt()}
                disabled={!pdfBytes || !promptInput.trim() || isLoading}
                className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 transition-colors"
                title="Send query"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
