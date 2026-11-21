import React from 'react';
import {
  Home,
  FileEdit,
  LayoutGrid,
  RefreshCw,
  ScanText,
  PenTool,
  CheckSquare,
  ShieldAlert,
  History,
  Settings,
  Bot,
} from 'lucide-react';
import { useEditorStore, AppNavTab } from '../stores/editorStore';

interface NavItem {
  id: AppNavTab;
  label: string;
  icon: React.ElementType;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Home', icon: Home },
  { id: 'editor', label: 'PDF Editor', icon: FileEdit },
  { id: 'organize', label: 'Organize', icon: LayoutGrid },
  { id: 'convert', label: 'Convert', icon: RefreshCw },
  { id: 'ocr', label: 'OCR Tools', icon: ScanText },
  { id: 'signatures', label: 'Signatures', icon: PenTool },
  { id: 'security', label: 'Security', icon: ShieldAlert },
  { id: 'history', label: 'History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  onOpenAi: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenAi }) => {
  const { activeTab, setActiveTab, pdfBytes } = useEditorStore();

  return (
    <aside className="w-16 bg-slate-900 border-r border-slate-800 flex flex-col items-center py-3 select-none z-40">
      <div className="flex-1 w-full space-y-1.5 px-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          const disabled = !pdfBytes && item.id === 'editor';

          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              disabled={disabled}
              className={`w-full h-12 flex flex-col items-center justify-center rounded-lg transition-all text-[10px] group relative ${
                isActive
                  ? 'bg-brand-600/20 text-brand-400 border border-brand-500/30'
                  : disabled
                  ? 'opacity-30 cursor-not-allowed text-slate-500'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
              title={item.label}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span className="truncate max-w-[50px] leading-tight">{item.label}</span>
              {isActive && (
                <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-brand-400 rounded-r" />
              )}
            </button>
          );
        })}
      </div>

      {/* Local AI Assistant Trigger */}
      <div className="w-full px-2 pt-2 border-t border-slate-800">
        <button
          onClick={onOpenAi}
          className="w-full h-12 flex flex-col items-center justify-center rounded-lg bg-indigo-950/40 hover:bg-indigo-900/40 border border-indigo-700/40 text-indigo-300 hover:text-indigo-200 transition-all text-[10px]"
          title="Local AI Document Assistant (Offline)"
        >
          <Bot className="w-5 h-5 mb-0.5 text-indigo-400" />
          <span>Local AI</span>
        </button>
      </div>
    </aside>
  );
};
