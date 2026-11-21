import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { Lock, Eye, EyeOff, ShieldAlert, Key, X, ArrowRight } from 'lucide-react';

export const PasswordPromptModal: React.FC = () => {
  const { pendingPasswordPrompt, cancelPendingPasswordPrompt, unlockPendingDocument } =
    useEditorStore();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (pendingPasswordPrompt) {
      setPassword('');
      setLocalError(pendingPasswordPrompt.errorMessage || null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [pendingPasswordPrompt]);

  if (!pendingPasswordPrompt) return null;

  const handleUnlock = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password) {
      setLocalError('Please enter a password');
      return;
    }

    setIsUnlocking(true);
    setLocalError(null);

    try {
      const success = await unlockPendingDocument(password);
      if (!success) {
        setLocalError('Incorrect password. Access denied.');
        setPassword('');
        inputRef.current?.focus();
      }
    } catch (err: any) {
      setLocalError(err?.message || 'Failed to unlock document');
      setPassword('');
      inputRef.current?.focus();
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      cancelPendingPasswordPrompt();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn select-none"
      onKeyDown={handleKeyDown}
    >
      <div className="relative w-full max-w-md bg-slate-900/95 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100 backdrop-blur-xl">
        {/* Glow Header */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-500" />

        {/* Close Button */}
        <button
          onClick={cancelPendingPasswordPrompt}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          title="Cancel (Esc)"
        >
          <X className="w-4 h-4" />
        </button>

        <form onSubmit={handleUnlock} className="p-6 space-y-5">
          {/* Header Icon & Title */}
          <div className="flex items-start space-x-3.5">
            <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 shadow-inner">
              <Lock className="w-6 h-6" />
            </div>
            <div className="flex-1 pr-6">
              <h3 className="text-base font-bold text-white tracking-tight flex items-center space-x-2">
                <span>Secured PDF Document</span>
              </h3>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                This document is encrypted. Enter the required password to decrypt and view contents.
              </p>
            </div>
          </div>

          {/* Filename Tag */}
          <div className="px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-300 font-mono truncate flex items-center space-x-2">
            <Key className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="truncate">{pendingPasswordPrompt.name}</span>
          </div>

          {/* Error Banner */}
          {localError && (
            <div className="p-3 rounded-lg bg-red-950/50 border border-red-500/40 text-red-300 text-xs flex items-center space-x-2.5 animate-shake">
              <ShieldAlert className="w-4 h-4 text-red-400 shrink-0" />
              <span>{localError}</span>
            </div>
          )}

          {/* Password Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span>Password</span>
              <span className="text-[10px] text-slate-500 font-normal">Press Enter to unlock</span>
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (localError) setLocalError(null);
                }}
                placeholder="Enter document password"
                disabled={isUnlocking}
                className="w-full bg-slate-950/80 border border-slate-700 rounded-xl px-3.5 py-2.5 pr-10 text-xs text-slate-100 placeholder-slate-500 font-mono outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 transition-all shadow-inner disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 transition-colors p-1"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={cancelPendingPasswordPrompt}
              disabled={isUnlocking}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUnlocking || !password}
              className="flex items-center space-x-2 px-5 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 shadow-md shadow-amber-900/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>{isUnlocking ? 'Decrypting...' : 'Unlock Document'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
