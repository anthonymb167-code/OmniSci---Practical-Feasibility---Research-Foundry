import React, { useState, useRef } from 'react';
import {
  Mic,
  MicOff,
  Sparkles,
  BookOpen,
  Languages,
  Send,
  Atom,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  FileText,
  Volume2,
} from 'lucide-react';
import { ScientificProject, ScientificNote } from '../types/scientific';

interface NotesAndToolsHubProps {
  projects: ScientificProject[];
  allNotes: ScientificNote[];
  onAddNote: (note: Partial<ScientificNote>, targetProjectId?: string) => Promise<void>;
  onForgeProjectFromText: (title: string, text: string, discipline: any, era: string) => void;
}

export const NotesAndToolsHub: React.FC<NotesAndToolsHubProps> = ({
  projects,
  allNotes,
  onAddNote,
  onForgeProjectFromText,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'notes' | 'historical-translator'>('notes');

  // Notes state
  const [noteText, setNoteText] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [synthesisOutput, setSynthesisOutput] = useState<any>(null);

  // Dedicated Historical & Polyglot Translator state
  const [sourceEra, setSourceEra] = useState<string>('16th Century Alchemical Latin (Paracelsus)');
  const [sourceManuscriptText, setSourceManuscriptText] = useState<string>(
    'Recipe from Basil Valentine (Twelve Keys, 1599): "Take the dragon that devours its own tail, fuse with the antimony stibnite in an earthen crucible with salt of tartar. Drive out the fiery red lion, and dissolve with the spirit of nitre until the crystal flowers blossom."'
  );
  const [isTranslatingHistorical, setIsTranslatingHistorical] = useState<boolean>(false);
  const [historicalTranslationResult, setHistoricalTranslationResult] = useState<any>(null);

  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Audio dictation controls
  const startRecording = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setNoteText((prev) => (prev ? `${prev} ${transcript}` : transcript));
      };

      recognition.start();
      recognitionRef.current = recognition;
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const mr = new MediaRecorder(stream);
          audioChunksRef.current = [];
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          mr.start(200);
          mediaRecorderRef.current = mr;
          setIsRecording(true);
        })
        .catch(() => setIsRecording(true));
    } else {
      setIsRecording(true);
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    setIsRecording(false);
  };

  // Submit note (manual or AI suggested)
  const handleSaveNote = async (autoSuggest = false) => {
    if (!noteText.trim()) return;

    let targetProjectId = selectedProjectId || (projects[0] ? projects[0].id : '');
    let audioUrl: string | undefined = undefined;

    if (audioChunksRef.current.length > 0) {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioUrl = URL.createObjectURL(blob);
    }

    if (autoSuggest) {
      setIsSynthesizing(true);
      try {
        const res = await fetch('/api/notes/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noteContent: noteText,
            activeProjects: projects.map((p) => ({ id: p.id, title: p.title, discipline: p.discipline })),
          }),
        });
        const result = await res.json();
        if (result.success && result.data) {
          setSynthesisOutput(result.data);
          if (result.data.suggestedProjectId) {
            targetProjectId = result.data.suggestedProjectId;
          }
          await onAddNote(
            {
              title: `Observation (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
              content: noteText,
              type: audioUrl ? 'audio' : 'written',
              audioBlobUrl: audioUrl,
              extractedParameters: result.data.extractedParameters,
              complianceImpact: result.data.complianceImpact,
              tags: ['AI-Bound', 'Audio-Memo'],
            },
            targetProjectId
          );
        }
      } catch (e) {
        console.error('Note synthesis error:', e);
      } finally {
        setIsSynthesizing(false);
      }
    } else {
      await onAddNote(
        {
          title: `Note (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
          content: noteText,
          type: audioUrl ? 'audio' : 'written',
          audioBlobUrl: audioUrl,
          tags: ['Manual-Bound'],
        },
        targetProjectId
      );
    }

    setNoteText('');
    audioChunksRef.current = [];
  };

  // Translate historical manuscript
  const handleTranslateManuscript = async () => {
    if (!sourceManuscriptText.trim()) return;
    setIsTranslatingHistorical(true);

    try {
      const res = await fetch('/api/historical/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceText: sourceManuscriptText,
          languageOrEra: sourceEra,
        }),
      });
      const data = await res.json();
      if (data.success && data.data) {
        setHistoricalTranslationResult(data.data);
      }
    } catch (err) {
      console.error('Manuscript translation error:', err);
    } finally {
      setIsTranslatingHistorical(false);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      {/* Top Header Tabs */}
      <div className="bg-slate-950/70 border-b border-slate-800 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white tracking-wide flex items-center gap-2">
            <Mic className="w-5 h-5 text-cyan-400" />
            Research Notes &amp; Historical Scientific Translator
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Record audio/written thoughts with AI project binding, or translate 1500s alchemical manuscripts &amp; foreign papers into IUPAC modern equivalents.
          </p>
        </div>

        <div className="flex items-center space-x-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-mono">
          <button
            onClick={() => setActiveSubTab('notes')}
            className={`px-3 py-1.5 rounded-lg transition ${
              activeSubTab === 'notes' ? 'bg-cyan-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
            }`}
          >
            Voice &amp; Written Notes
          </button>
          <button
            onClick={() => setActiveSubTab('historical-translator')}
            className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
              activeSubTab === 'historical-translator'
                ? 'bg-amber-600 text-white font-semibold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" /> 1500s Manuscript Translator
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* SUBTAB 1: NOTES & SPEECH */}
        {activeSubTab === 'notes' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: Input Pad */}
            <div className="lg:col-span-6 space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="text-xs font-mono text-cyan-400 font-semibold flex items-center gap-1.5">
                    <Mic className="w-4 h-4" /> Live Audio Dictation &amp; Lab Log
                  </div>
                  <span className="text-[11px] text-slate-500">
                    Supports browser Web Speech API + raw audio capture
                  </span>
                </div>

                <div className="relative mb-3">
                  <textarea
                    rows={5}
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="Dictate live experiment observations, chemical measurements, unexpected phase transitions, or theoretical insights..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-mono leading-relaxed"
                  />

                  {isRecording && (
                    <div className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/90 border border-rose-700 text-rose-300 text-[10px] font-mono animate-pulse">
                      <span className="w-2 h-2 rounded-full bg-rose-500" />
                      LISTENING / RECORDING...
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 transition ${
                        isRecording
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                      }`}
                    >
                      {isRecording ? (
                        <>
                          <MicOff className="w-3.5 h-3.5" /> Stop Mic
                        </>
                      ) : (
                        <>
                          <Mic className="w-3.5 h-3.5 text-rose-400" /> Start Dictation
                        </>
                      )}
                    </button>

                    <select
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 font-mono"
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          Bind to: {p.title.length > 24 ? p.title.substring(0, 24) + '...' : p.title}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      disabled={!noteText.trim() || isSynthesizing}
                      onClick={() => handleSaveNote(true)}
                      className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-mono font-semibold flex items-center gap-1.5 disabled:opacity-50 transition"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      {isSynthesizing ? 'Synthesizing...' : 'AI Auto-Suggest &amp; Bind'}
                    </button>

                    <button
                      disabled={!noteText.trim() || isSynthesizing}
                      onClick={() => handleSaveNote(false)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono flex items-center gap-1 disabled:opacity-50 transition"
                    >
                      <Send className="w-3.5 h-3.5" /> Save
                    </button>
                  </div>
                </div>

                {synthesisOutput && (
                  <div className="mt-4 p-3 rounded-xl bg-cyan-950/40 border border-cyan-800/80 text-xs text-cyan-200 space-y-1.5 font-mono">
                    <div className="font-semibold text-cyan-300 flex items-center gap-1">
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      Auto-Assigned Project: {synthesisOutput.suggestedProjectTitle}
                    </div>
                    <p className="text-[11px] text-slate-300 font-sans">{synthesisOutput.relevanceExplanation}</p>
                    <div className="text-[10px] text-amber-300">
                      Follow-up Action: {synthesisOutput.actionableFollowUp}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: Feed of all recorded notes across all projects */}
            <div className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between text-xs font-mono text-slate-400 pb-1 border-b border-slate-800">
                <span>Integrated Research Notes Ledger</span>
                <span>Total: {allNotes.length} notes</span>
              </div>

              <div className="max-h-[460px] overflow-y-auto space-y-2.5 pr-1">
                {allNotes.length === 0 ? (
                  <div className="p-8 text-center text-slate-500 text-xs font-mono border border-dashed border-slate-800 rounded-xl">
                    No notes recorded yet. Use microphone dictation or quick notes on the left or in the top biometric lockdown overlay.
                  </div>
                ) : (
                  allNotes.map((note) => {
                    const parentProj = projects.find((p) => p.id === note.projectId);
                    return (
                      <div
                        key={note.id}
                        className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-slate-200">{note.title}</span>
                            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/80 px-2 py-0.5 rounded border border-cyan-800">
                              {note.type.toUpperCase()}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono text-slate-500">
                            {new Date(note.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div className="text-[11px] font-mono text-slate-400">
                          Bound Project:{' '}
                          <span className="text-cyan-300 font-semibold">
                            {parentProj ? parentProj.title : 'Global Lab Ledger'}
                          </span>
                        </div>

                        <p className="text-slate-300 text-xs leading-relaxed font-mono bg-slate-900 p-2.5 rounded border border-slate-800/80">
                          {note.content}
                        </p>

                        {note.audioBlobUrl && (
                          <div className="pt-1">
                            <audio controls src={note.audioBlobUrl} className="h-7 w-full max-w-sm" />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 2: HISTORICAL 1500s MANUSCRIPT & POLYGLOT TRANSLATOR */}
        {activeSubTab === 'historical-translator' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
              <div className="md:col-span-6 space-y-3">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Historical Manuscript Era / Source Archive
                  </label>
                  <select
                    value={sourceEra}
                    onChange={(e) => setSourceEra(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-amber-300 font-mono focus:outline-none focus:border-amber-500"
                  >
                    <option value="16th Century Alchemical Latin (Paracelsus)">16th Century Alchemical Latin (Paracelsus, 1527)</option>
                    <option value="1680 Royal Society Archive (Robert Boyle)">1680 Royal Society Archive (Robert Boyle)</option>
                    <option value="17th Century Alchemical Treatise (Isaac Newton)">17th Century Alchemical Treatise (Isaac Newton)</option>
                    <option value="1599 Basil Valentine (Twelve Keys of Philosophy)">1599 Basil Valentine (Twelve Keys of Philosophy)</option>
                    <option value="18th Century Phlogiston Theory (Stahl/Lavoisier)">18th Century Phlogiston Theory (Stahl/Lavoisier)</option>
                    <option value="Non-English Foreign Scientific Manuscript (German, Russian, Chinese, Latin)">Non-English Foreign Scientific Manuscript</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Archaic / Polyglot Passage to Translate
                  </label>
                  <textarea
                    rows={7}
                    value={sourceManuscriptText}
                    onChange={(e) => setSourceManuscriptText(e.target.value)}
                    placeholder="Enter ancient recipe, alchemical cryptic formula, or foreign scientific description..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500 leading-relaxed"
                  />
                </div>

                <button
                  onClick={handleTranslateManuscript}
                  disabled={isTranslatingHistorical}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-mono font-semibold text-xs flex items-center gap-2 shadow-lg disabled:opacity-50 transition"
                >
                  <BookOpen className="w-4 h-4" />
                  {isTranslatingHistorical ? 'Deciphering & Cross-Referencing IUPAC...' : 'Translate to Modern Material Science'}
                </button>
              </div>

              {/* Right: Modernization Output Ledger */}
              <div className="md:col-span-6 bg-slate-950 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800 text-xs font-mono text-amber-400 font-semibold">
                  <span className="flex items-center gap-1.5">
                    <Atom className="w-4 h-4" /> Modern Empirical Translation
                  </span>
                  {historicalTranslationResult && (
                    <button
                      onClick={() =>
                        onForgeProjectFromText(
                          'Transmuted Historical Blueprint',
                          historicalTranslationResult.modernEnglishTranslation,
                          'Historical Alchemy Modernization',
                          sourceEra
                        )
                      }
                      className="px-2.5 py-1 rounded bg-amber-950 text-amber-300 border border-amber-700 hover:bg-amber-900 text-[11px] font-mono flex items-center gap-1 transition"
                    >
                      <Sparkles className="w-3 h-3" /> Forge Full Project
                    </button>
                  )}
                </div>

                {!historicalTranslationResult ? (
                  <div className="h-64 flex flex-col items-center justify-center text-center text-slate-500 text-xs font-mono p-4">
                    <BookOpen className="w-8 h-8 text-amber-500/40 mb-2" />
                    <p>Click translate to decode archaic alchemical metaphors into modern stoichiometry, CAS chemicals, and laboratory safety protocols.</p>
                  </div>
                ) : (
                  <div className="space-y-4 text-xs font-mono max-h-[380px] overflow-y-auto pr-1">
                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">Standardized English Translation:</div>
                      <p className="text-white font-sans text-xs bg-slate-900 p-3 rounded-lg border border-slate-800 leading-relaxed">
                        {historicalTranslationResult.modernEnglishTranslation}
                      </p>
                    </div>

                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">Modern Chemical Equation:</div>
                      <div className="p-2.5 rounded bg-slate-900 text-cyan-300 border border-slate-800">
                        {historicalTranslationResult.chemicalReactionModern}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">Identified Precursors &amp; CAS Numbers:</div>
                      <div className="space-y-1.5">
                        {historicalTranslationResult.identifiedSubstances?.map((sub: any, i: number) => (
                          <div key={i} className="p-2 rounded bg-slate-900 border border-slate-800 flex justify-between">
                            <div>
                              <span className="text-amber-300">{sub.historicalTerm}</span> →{' '}
                              <span className="text-emerald-300 font-bold">{sub.modernName}</span>
                            </div>
                            <span className="text-cyan-400">{sub.casNumber}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <div className="text-[11px] text-slate-400 mb-1">Modern Green Replacement Protocols:</div>
                      <ul className="space-y-1 text-slate-300 text-[11px] font-sans">
                        {historicalTranslationResult.modernLabProcedureEquivalents?.map((proc: string, i: number) => (
                          <li key={i} className="flex items-start gap-1">
                            <span className="text-cyan-400">•</span>
                            <span>{proc}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
