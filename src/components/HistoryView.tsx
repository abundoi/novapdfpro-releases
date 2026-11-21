import React, { useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { dbService } from '../services/db';
import { History, RotateCcw, Plus, CheckCircle, Clock, ShieldCheck } from 'lucide-react';

export const HistoryView: React.FC = () => {
  const { currentDocId, currentFileName, pdfBytes, setStatusMessage } = useEditorStore();
  const [noteInput, setNoteInput] = useState('');
  const versions = dbService.getVersions(currentDocId);

  const handleCreateCheckpoint = () => {
    if (!pdfBytes) return;
    dbService.createVersion(currentDocId, noteInput || 'Manual user checkpoint', pdfBytes.byteLength);
    setNoteInput('');
    setStatusMessage('Checkpoint created in local database');
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8 select-none text-slate-100">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center space-x-2.5">
            <History className="w-5 h-5 text-brand-400" />
            <span>Document Version History & Automatic Recovery</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Browse previous versions, create named recovery checkpoints, and guard against accidental data loss.
          </p>
        </div>

        {/* Create Checkpoint Box */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h3 className="font-semibold text-sm text-slate-200">Create New Recovery Checkpoint</h3>
          <div className="flex space-x-3">
            <input
              type="text"
              placeholder="e.g. Before redacting section 4 or pre-signature draft..."
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 outline-none focus:border-brand-500"
            />
            <button
              onClick={handleCreateCheckpoint}
              disabled={!pdfBytes}
              className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-medium text-xs transition-colors shadow-sm disabled:opacity-40"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Checkpoint</span>
            </button>
          </div>
        </div>

        {/* Checkpoint Timeline */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="font-semibold text-sm text-slate-200">
              Recovery Checkpoints for: <span className="text-brand-300 font-medium">{currentFileName}</span>
            </h3>
            <span className="text-xs text-slate-500">{versions.length} versions recorded</span>
          </div>

          {versions.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-xs">
              <Clock className="w-8 h-8 mx-auto text-slate-600 mb-2" />
              <span>No prior versions recorded for this document. Save changes or create a checkpoint above.</span>
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((ver) => (
                <div
                  key={ver.id}
                  className="p-4 rounded-xl bg-slate-850 border border-slate-700/80 flex items-center justify-between"
                >
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 font-mono text-[11px] font-bold">
                        v{ver.versionNumber}
                      </span>
                      <span className="font-semibold text-xs text-slate-200">{ver.note}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 flex items-center space-x-3">
                      <span>Author: {ver.author}</span>
                      <span>•</span>
                      <span>Time: {new Date(ver.timestamp).toLocaleString()}</span>
                      <span>•</span>
                      <span className="font-mono">{formatSize(ver.sizeBytes)}</span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => setStatusMessage(`Selected restore checkpoint v${ver.versionNumber}`)}
                      className="flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
