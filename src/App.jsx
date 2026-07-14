import { useEffect, useState, useRef } from 'react';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { Loader2, Copy, Sparkles, Command } from 'lucide-react';
import { streamChatCompletion } from './services/ai';

const appWindow = getCurrentWindow();

function App() {
  const [prompt, setPrompt] = useState("");
  const [clipboardContent, setClipboardContent] = useState("");
  const [response, setResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [debugError, setDebugError] = useState("");
  const inputRef = useRef(null);

  const hasContent = clipboardContent || response || isLoading;

  // Auto-start registration
  useEffect(() => {
    const setupAutostart = async () => {
      try {
        const enabled = await isEnabled();
        if (!enabled) {
          await enable();
        }
      } catch (err) {
        setDebugError("Autostart Error: " + err.message);
      }
    };
    setupAutostart();
  }, []);

  // Dynamically resize the OS window based on content
  useEffect(() => {
    const resizeWindow = async () => {
      try {
        if (hasContent || debugError) {
          await appWindow.setSize(new LogicalSize(650, 450));
        } else {
          await appWindow.setSize(new LogicalSize(650, 65));
        }
      } catch (err) {
        setDebugError("Resize Error: " + err.message);
      }
    };
    resizeWindow();
  }, [hasContent, debugError]);

  const processClipboard = async () => {
    try {
      const text = await readText();
      setClipboardContent(text || "");
      setTimeout(() => inputRef.current?.focus(), 100);
    } catch (err) {
      setDebugError("Clipboard Error: " + err.message);
    }
  };

  const lastToggleTime = useRef(0);

  useEffect(() => {
    const shortcutStr = 'Alt+M';
    const setupShortcut = async () => {
      try {
        // Try unregistering first in case a hot-reload left it hanging
        await unregister(shortcutStr).catch(() => {});
        
        await register(shortcutStr, async (event) => {
          // Tauri v2 fires events for both key Pressed and Released.
          // We only want to trigger on Pressed.
          if (event && event.state === 'Released') return;

          // Debounce fallback (prevent rapid toggling within 300ms)
          const now = Date.now();
          if (now - lastToggleTime.current < 300) return;
          lastToggleTime.current = now;

          try {
            const isVisible = await appWindow.isVisible();
            if (!isVisible) {
              await processClipboard();
              await appWindow.show();
              await appWindow.setFocus();
            } else {
              await appWindow.hide();
            }
          } catch (internalErr) {
            setDebugError("Shortcut Callback Error: " + (internalErr.message || String(internalErr)));
          }
        });
      } catch (e) {
        setDebugError("Shortcut Registration Error: " + (e.message || String(e)));
      }
    };
    setupShortcut();
    return () => { unregister(shortcutStr).catch(() => {}); };
  }, []);

  const handleKeyDown = async (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      try {
        await appWindow.hide();
        setPrompt("");
        setResponse("");
        setClipboardContent("");
        setDebugError("");
      } catch (err) {
        setDebugError("Hide Error: " + err.message);
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setIsLoading(true);
    setResponse("");
    setDebugError("");

    const systemPrompt = "You are a helpful AI clipboard assistant. The user will give you a command, and you must apply that command to the provided clipboard text. Only output the result, do not include any extra conversation or formatting unless asked.";
    const userMessage = `Command: ${prompt}\n\nClipboard Text: ${clipboardContent}`;

    try {
      await streamChatCompletion(systemPrompt, userMessage, (chunk) => {
        setResponse((prev) => prev + chunk);
      });
    } catch (error) {
      setDebugError("LM Studio Error: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await writeText(response);
      await appWindow.hide();
      setPrompt("");
      setResponse("");
      setClipboardContent("");
    } catch (e) {
      setDebugError("Copy Error: " + e.message);
    }
  };

  const dragTimer = useRef(null);

  const handlePointerDown = (e) => {
    // Only react to primary mouse button
    if (e.button !== 0) return;
    dragTimer.current = setTimeout(async () => {
      try {
        await appWindow.startDragging();
      } catch (err) {
        setDebugError("Drag Error: " + err.message);
      }
    }, 200); // 200ms delay before converting to drag
  };

  const handlePointerUp = () => {
    if (dragTimer.current) {
      clearTimeout(dragTimer.current);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[#1A1B26]/80 backdrop-blur-2xl rounded-2xl border border-white/10 font-sans text-white overflow-hidden shadow-2xl">
      
      {/* Search Bar - Fixed Height of 65px */}
      <form 
        onSubmit={handleSubmit} 
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        className="flex items-center h-[65px] px-4 shrink-0 bg-white/5"
      >
        <button 
          type="button"
          onClick={processClipboard}
          className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 shadow-lg hover:shadow-purple-500/30 transition-all mr-3"
          title="Read Clipboard"
        >
          <Sparkles className="text-white" size={16} />
        </button>
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask AI about your clipboard..."
          className="flex-1 h-full bg-transparent text-xl text-white placeholder-gray-400 focus:outline-none tracking-wide"
          autoFocus
        />
        <div className="flex items-center text-gray-500 text-xs font-semibold gap-1 ml-3 px-2 py-1 bg-black/20 rounded-md">
          Alt+M
        </div>
      </form>

      {/* Dynamic Content Area */}
      {(hasContent || debugError) && (
        <div className="flex-1 overflow-y-auto flex flex-col border-t border-white/10">
          
          {debugError && (
            <div className="p-4 bg-red-500/20 text-red-200 text-sm border-b border-red-500/30">
              {debugError}
            </div>
          )}

          {/* Target Content */}
          {clipboardContent && (
            <div className="p-4 border-b border-white/5 bg-black/10">
              <div className="text-[10px] font-bold tracking-widest text-gray-500 uppercase mb-2">Target</div>
              <p className="text-sm text-gray-300 line-clamp-2 leading-relaxed">{clipboardContent}</p>
            </div>
          )}

          {/* AI Response */}
          {(response || isLoading) && (
            <div className="flex-1 p-5 flex flex-col relative bg-gradient-to-b from-transparent to-black/20">
              <div className="flex items-center justify-between mb-4">
                <span className="text-[10px] font-bold tracking-widest text-purple-400 uppercase flex items-center gap-2">
                  <Sparkles size={12} /> Response
                </span>
                {response && !isLoading && (
                  <button 
                    onClick={handleCopy}
                    className="flex items-center gap-2 text-xs font-medium text-white bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg transition-colors ring-1 ring-white/10 shadow-lg"
                  >
                    <Copy size={14} /> Copy to Clipboard
                  </button>
                )}
              </div>
              
              <div className="flex-1 text-gray-100 leading-relaxed text-[15px] whitespace-pre-wrap font-light">
                {response}
                {isLoading && (
                  <Loader2 className="animate-spin text-purple-500 inline-block ml-3 align-middle" size={18} />
                )}
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export default App;
