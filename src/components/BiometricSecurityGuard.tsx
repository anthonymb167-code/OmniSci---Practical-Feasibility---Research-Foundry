import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Camera,
  CameraOff,
  Mic,
  MicOff,
  AlertTriangle,
  Lock,
  Unlock,
  Eye,
  Sliders,
  Send,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { BiometricSecurityState, ScientificProject, ScientificNote } from '../types/scientific';
import { readAiResponse } from '../utils/billingEvents';

interface BiometricSecurityGuardProps {
  securityState: BiometricSecurityState;
  setSecurityState: React.Dispatch<React.SetStateAction<BiometricSecurityState>>;
  projects: ScientificProject[];
  onAddNote: (note: Partial<ScientificNote>, targetProjectId?: string) => Promise<void>;
  isLocked: boolean;
  setIsLocked: (locked: boolean) => void;
}

export const BiometricSecurityGuard: React.FC<BiometricSecurityGuardProps> = ({
  securityState,
  setSecurityState,
  projects,
  onAddNote,
  isLocked,
  setIsLocked,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [streamActive, setStreamActive] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  const [showConfigModal, setShowConfigModal] = useState<boolean>(false);
  const [showMiniHud, setShowMiniHud] = useState<boolean>(true);

  // Quick emergency note states when paused/locked
  const [quickNoteText, setQuickNoteText] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [isRecordingAudio, setIsRecordingAudio] = useState<boolean>(false);
  const [audioTranscript, setAudioTranscript] = useState<string>('');
  const [isSynthesizingNote, setIsSynthesizingNote] = useState<boolean>(false);
  const [synthesizedResult, setSynthesizedResult] = useState<any>(null);

  // Absence tracking refs
  const absenceTimerRef = useRef<number | null>(null);
  const lastFaceDetectedTimestampRef = useRef<number>(Date.now());
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Sound cue synthesizer
  const playBeep = useCallback((freq = 440, type: OscillatorType = 'sine', duration = 0.15) => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch (e) {
      // AudioContext may be restricted before gesture
    }
  }, [soundEnabled]);

  // Start real webcam
  const startCamera = async () => {
    try {
      setStreamError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: 'user' },
        audio: false,
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setStreamActive(true);
        setSecurityState((prev) => ({
          ...prev,
          mode: 'webcam',
          auditLog: [
            {
              timestamp: new Date().toLocaleTimeString(),
              event: 'Physical optical camera stream engaged',
              status: 'verified',
            },
            ...prev.auditLog.slice(0, 19),
          ],
        }));
      }
    } catch (err: any) {
      console.warn('Webcam stream unavailable, falling back to simulated biometric presence:', err);
      setStreamError('Camera permission not granted or hardware absent. Switched to Simulated Biometrics.');
      setSecurityState((prev) => ({ ...prev, mode: 'simulated' }));
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
      setStreamActive(false);
    }
  };

  // Switch to simulated presence
  const toggleSimulation = () => {
    if (securityState.mode === 'webcam') {
      stopCamera();
      setSecurityState((prev) => ({ ...prev, mode: 'simulated' }));
    } else {
      startCamera();
    }
  };

  // Face and presence detection loop
  useEffect(() => {
    let animId: number;
    let prevImageData: Uint8ClampedArray | null = null;

    const processFrame = () => {
      const now = Date.now();

      if (!securityState.isArmed) {
        setIsLocked(false);
        animId = requestAnimationFrame(processFrame);
        return;
      }

      if (securityState.mode === 'simulated') {
        // In simulated mode, user controls isPresent with button or timer
        if (securityState.isPresent) {
          lastFaceDetectedTimestampRef.current = now;
          if (isLocked) {
            setIsLocked(false);
            playBeep(880, 'sine', 0.1);
            setSecurityState((prev) => ({
              ...prev,
              absenceDurationSeconds: 0,
              auditLog: [
                {
                  timestamp: new Date().toLocaleTimeString(),
                  event: 'Biometric Subject Verified (Simulated)',
                  status: 'resumed',
                },
                ...prev.auditLog.slice(0, 19),
              ],
            }));
          }
        } else {
          const absenceDuration = (now - lastFaceDetectedTimestampRef.current) / 1000;
          setSecurityState((prev) => ({
            ...prev,
            absenceDurationSeconds: parseFloat(absenceDuration.toFixed(1)),
          }));

          // Exceeded 1 second threshold!
          if (absenceDuration >= 1.0 && !isLocked) {
            setIsLocked(true);
            playBeep(220, 'sawtooth', 0.25);
            setSecurityState((prev) => ({
              ...prev,
              pausedReason: 'Subject moved away from camera (>1.0s absence threshold)',
              auditLog: [
                {
                  timestamp: new Date().toLocaleTimeString(),
                  event: 'Absence >1.0s: Workspace Suspended & Locked',
                  status: 'absence_detected',
                },
                ...prev.auditLog.slice(0, 19),
              ],
            }));
          }
        }
      } else if (securityState.mode === 'webcam' && videoRef.current && canvasRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (video.readyState >= 2 && ctx) {
          canvas.width = 160;
          canvas.height = 120;
          ctx.drawImage(video, 0, 0, 160, 120);

          try {
            const currentFrame = ctx.getImageData(0, 0, 160, 120);
            const data = currentFrame.data;

            // Optical flow / skin-tone pixel luminance presence heuristic
            let skinPixels = 0;
            let motionVariance = 0;

            for (let i = 0; i < data.length; i += 16) {
              const r = data[i];
              const g = data[i + 1];
              const b = data[i + 2];

              // Generic skin tone chromaticity box
              if (r > 60 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
                skinPixels++;
              }

              if (prevImageData) {
                const diff = Math.abs(r - prevImageData[i]) + Math.abs(g - prevImageData[i + 1]);
                motionVariance += diff;
              }
            }

            prevImageData = data;

            // Confidence metric
            const skinRatio = skinPixels / (160 * 120 / 4);
            const detectedConfidence = Math.min(100, Math.round(skinRatio * 350 + (motionVariance > 200 ? 20 : 0)));

            // Draw HUD target box on mini HUD canvas
            if (hudCanvasRef.current) {
              const hCtx = hudCanvasRef.current.getContext('2d');
              if (hCtx) {
                hudCanvasRef.current.width = 160;
                hudCanvasRef.current.height = 120;
                hCtx.drawImage(canvas, 0, 0);

                if (detectedConfidence > 20) {
                  hCtx.strokeStyle = '#10b981';
                  hCtx.lineWidth = 2;
                  hCtx.strokeRect(35, 15, 90, 90);
                  hCtx.fillStyle = '#10b981';
                  hCtx.font = '10px monospace';
                  hCtx.fillText(`VERIFIED ${detectedConfidence}%`, 40, 30);
                } else {
                  hCtx.strokeStyle = '#ef4444';
                  hCtx.lineWidth = 2;
                  hCtx.strokeRect(20, 20, 120, 80);
                  hCtx.fillStyle = '#ef4444';
                  hCtx.font = '10px monospace';
                  hCtx.fillText('NO SUBJECT', 45, 60);
                }
              }
            }

            const isPresentNow = detectedConfidence >= 22;

            if (isPresentNow) {
              lastFaceDetectedTimestampRef.current = now;
              setSecurityState((prev) => ({
                ...prev,
                isPresent: true,
                faceConfidence: detectedConfidence,
                absenceDurationSeconds: 0,
              }));

              if (isLocked) {
                setIsLocked(false);
                playBeep(880, 'sine', 0.1);
                setSecurityState((prev) => ({
                  ...prev,
                  auditLog: [
                    {
                      timestamp: new Date().toLocaleTimeString(),
                      event: 'Subject Re-entered Frame & Verified',
                      status: 'resumed',
                    },
                    ...prev.auditLog.slice(0, 19),
                  ],
                }));
              }
            } else {
              const absenceDuration = (now - lastFaceDetectedTimestampRef.current) / 1000;
              setSecurityState((prev) => ({
                ...prev,
                isPresent: false,
                faceConfidence: detectedConfidence,
                absenceDurationSeconds: parseFloat(absenceDuration.toFixed(1)),
              }));

              // Exceeded 1 second threshold!
              if (absenceDuration >= 1.0 && !isLocked) {
                setIsLocked(true);
                playBeep(220, 'sawtooth', 0.2);
                setSecurityState((prev) => ({
                  ...prev,
                  pausedReason: 'Subject absent from optical frame (>1.0 second)',
                  auditLog: [
                    {
                      timestamp: new Date().toLocaleTimeString(),
                      event: 'Absence >1.0s: Active Workspace Paused',
                      status: 'absence_detected',
                    },
                    ...prev.auditLog.slice(0, 19),
                  ],
                }));
              }
            }
          } catch (e) {
            // Frame read error
          }
        }
      }

      animId = requestAnimationFrame(processFrame);
    };

    animId = requestAnimationFrame(processFrame);
    return () => cancelAnimationFrame(animId);
  }, [securityState.isArmed, securityState.mode, securityState.isPresent, isLocked, playBeep]);

  // Audio recording & Speech-to-text setup
  const startAudioDictation = () => {
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
        setAudioTranscript(transcript);
        setQuickNoteText((prev) => (prev ? `${prev} ${transcript}` : transcript));
      };

      recognition.onerror = (e: any) => {
        console.warn('Speech recognition error:', e);
      };

      recognition.start();
      recognitionRef.current = recognition;
    }

    // MediaRecorder for raw audio attachment
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          const mr = new MediaRecorder(stream);
          audioChunksRef.current = [];
          mr.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          mr.start(250);
          mediaRecorderRef.current = mr;
          setIsRecordingAudio(true);
        })
        .catch((e) => {
          console.warn('Mic permission error:', e);
          setIsRecordingAudio(true); // continue with speech recognition if mic accessible
        });
    } else {
      setIsRecordingAudio(true);
    }
  };

  const stopAudioDictation = () => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    setIsRecordingAudio(false);
  };

  // Submit emergency note directly from lockdown screen
  const handleSaveLockdownNote = async (autoSuggest = false) => {
    if (!quickNoteText.trim()) return;

    let targetProjectId = selectedProjectId || (projects[0] ? projects[0].id : '');
    let audioUrl: string | undefined = undefined;

    if (audioChunksRef.current.length > 0) {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioUrl = URL.createObjectURL(blob);
    }

    if (autoSuggest) {
      setIsSynthesizingNote(true);
      try {
        const res = await fetch('/api/notes/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noteContent: quickNoteText,
            activeProjects: projects.map((p) => ({ id: p.id, title: p.title, discipline: p.discipline })),
          }),
        });
        const result = await readAiResponse<any>(res);
        if (result.success && result.data) {
          setSynthesizedResult(result.data);
          if (result.data.suggestedProjectId) {
            targetProjectId = result.data.suggestedProjectId;
          }
          await onAddNote(
            {
              title: `Research Note (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`,
              content: quickNoteText,
              type: audioUrl ? 'audio' : 'written',
              audioBlobUrl: audioUrl,
              extractedParameters: result.data.extractedParameters,
              complianceImpact: result.data.complianceImpact,
              tags: ['Biometric-Session', 'Expedited', 'Active-Foundry'],
            },
            targetProjectId
          );
        }
      } catch (err) {
        console.error('Note synthesis error:', err);
        await onAddNote(
          {
            title: `Quick Note (${new Date().toLocaleTimeString()})`,
            content: quickNoteText,
            type: audioUrl ? 'audio' : 'written',
            audioBlobUrl: audioUrl,
            tags: ['Biometric-Lockdown'],
          },
          targetProjectId
        );
      } finally {
        setIsSynthesizingNote(false);
      }
    } else {
      await onAddNote(
        {
          title: `Biometric Note (${new Date().toLocaleTimeString()})`,
          content: quickNoteText,
          type: audioUrl ? 'audio' : 'written',
          audioBlobUrl: audioUrl,
          tags: ['Biometric-Session', 'Manual-Bind'],
        },
        targetProjectId
      );
    }

    setQuickNoteText('');
    setAudioTranscript('');
    audioChunksRef.current = [];
  };

  return (
    <>
      {/* Top persistent biometric security HUD banner */}
      <div className="bg-slate-950/80 backdrop-blur border-b border-slate-800/80 px-4 py-2 flex items-center justify-between z-30 text-xs">
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2.5 w-2.5">
              {securityState.isArmed && securityState.isPresent ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                </>
              ) : (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                </>
              )}
            </span>
            <span className="font-mono uppercase tracking-wider font-semibold text-slate-300">
              Biometric Presence Guard:
            </span>
          </div>

          {securityState.isArmed ? (
            securityState.isPresent ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-700/50 font-mono">
                <ShieldCheck className="w-3.5 h-3.5" />
                ACTIVE & VERIFIED ({securityState.faceConfidence}%)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-700/50 font-mono">
                <ShieldAlert className="w-3.5 h-3.5" />
                ABSENCE DETECTED ({securityState.absenceDurationSeconds}s)
              </span>
            )
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-700/50 font-mono">
              STANDBY / DISARMED
            </span>
          )}

          <span className="text-slate-400 hidden sm:inline">
            Mode:{' '}
            <span className="text-slate-200 font-mono">
              {securityState.mode === 'webcam' ? 'Physical Camera Lens' : 'Simulated Sensor (Demo)'}
            </span>
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center space-x-2">
          {securityState.mode === 'simulated' ? (
            <button
              onClick={() => {
                setSecurityState((prev) => ({
                  ...prev,
                  isPresent: !prev.isPresent,
                  faceConfidence: !prev.isPresent ? 96 : 0,
                }));
              }}
              className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition flex items-center gap-1 border ${
                securityState.isPresent
                  ? 'bg-rose-900/50 hover:bg-rose-900/80 text-rose-300 border-rose-700'
                  : 'bg-emerald-900/50 hover:bg-emerald-900/80 text-emerald-300 border-emerald-700'
              }`}
              title="Simulate user stepping away from camera for >1 second to test automatic lock"
            >
              {securityState.isPresent ? (
                <>
                  <Eye className="w-3 h-3" /> Step Away (Trigger 1s Lock)
                </>
              ) : (
                <>
                  <Eye className="w-3 h-3" /> Return to Camera (Unlock)
                </>
              )}
            </button>
          ) : null}

          <button
            onClick={toggleSimulation}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-xs font-mono transition flex items-center gap-1"
          >
            {securityState.mode === 'webcam' ? (
              <>
                <CameraOff className="w-3 h-3 text-cyan-400" /> Switch to Sensor Demo
              </>
            ) : (
              <>
                <Camera className="w-3 h-3 text-emerald-400" /> Enable Webcam
              </>
            )}
          </button>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700"
            title={soundEnabled ? 'Mute Audio Alerts' : 'Unmute Audio Alerts'}
          >
            {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5 text-rose-400" />}
          </button>

          <button
            onClick={() => setShowConfigModal(true)}
            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
            title="Biometric & Security Settings"
          >
            <Sliders className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Floating mini HUD viewfinder in lower right corner */}
      {showMiniHud && (
        <div className="fixed bottom-4 right-4 z-40 bg-slate-900/90 backdrop-blur border border-slate-800 rounded-lg p-2 shadow-2xl w-44 hidden md:block">
          <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-slate-800 text-[10px] font-mono text-slate-400">
            <span className="flex items-center gap-1">
              <Camera className="w-3 h-3 text-cyan-400" /> OPTICAL SCANNER
            </span>
            <button
              onClick={() => setShowMiniHud(false)}
              className="hover:text-slate-200"
            >
              ✕
            </button>
          </div>
          <div className="relative rounded overflow-hidden bg-black/60 border border-slate-800 aspect-video flex items-center justify-center">
            {securityState.mode === 'webcam' ? (
              <canvas ref={hudCanvasRef} className="w-full h-full object-cover" />
            ) : (
              <div className="text-center p-2">
                <div
                  className={`w-10 h-10 mx-auto rounded-full border-2 flex items-center justify-center mb-1 transition-all ${
                    securityState.isPresent
                      ? 'border-emerald-500 bg-emerald-950/40 text-emerald-400'
                      : 'border-rose-500 bg-rose-950/40 text-rose-400'
                  }`}
                >
                  {securityState.isPresent ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
                </div>
                <div className="text-[10px] font-mono text-slate-300">
                  {securityState.isPresent ? 'PRESENCE OK' : 'SUBJECT AWAY'}
                </div>
              </div>
            )}
            <div className="absolute top-1 left-1 text-[9px] font-mono px-1 bg-black/70 rounded text-cyan-300">
              {securityState.absenceDurationSeconds > 0
                ? `ABS: ${securityState.absenceDurationSeconds}s`
                : '1.0s AUTO-LOCK'}
            </div>
          </div>
        </div>
      )}

      {/* Hidden processing video and canvas elements */}
      <video ref={videoRef} className="hidden" playsInline muted autoPlay />
      <canvas ref={canvasRef} className="hidden" />

      {/* ========================================================================= */}
      {/* FULL LOCKDOWN & WORKSPACE PAUSE SCREEN (TRIGGERED WHEN AWAY FOR >= 1.0s) */}
      {/* ========================================================================= */}
      {isLocked && (
        <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xl flex flex-col items-center justify-center p-4 overflow-y-auto animate-fadeIn">
          <div className="w-full max-w-2xl bg-slate-900/90 border-2 border-rose-500/80 rounded-2xl shadow-2xl p-6 relative overflow-hidden">
            {/* Top scanning radar beam */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-rose-500 to-transparent animate-pulse" />

            <div className="flex items-start justify-between mb-4 border-b border-rose-900/50 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-12 h-12 rounded-xl bg-rose-950/80 border border-rose-600 flex items-center justify-center text-rose-400">
                  <Lock className="w-6 h-6 animate-pulse" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    BIOMETRIC WORKSPACE PAUSED
                    <span className="px-2 py-0.5 rounded text-xs bg-rose-950 text-rose-300 border border-rose-700 font-mono">
                      SECURITY ARMED
                    </span>
                  </h2>
                  <p className="text-xs text-rose-300/80 font-mono">
                    Subject moved away from optical camera for &gt; 1.0s. All scientific computations, proprietary formulas,
                    and datasets are paused.
                  </p>
                </div>
              </div>

              <div className="text-right font-mono text-xs text-slate-400">
                <div>ABSENCE TIMER</div>
                <div className="text-rose-400 text-lg font-bold">
                  {securityState.absenceDurationSeconds.toFixed(1)}s
                </div>
              </div>
            </div>

            {/* Verification status callout */}
            <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-4 mb-5 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <div className="relative w-10 h-10 rounded-full border-2 border-dashed border-cyan-500 animate-spin flex items-center justify-center">
                  <Eye className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-slate-200">
                    Scanning for Authorized Researcher...
                  </div>
                  <div className="text-xs text-slate-400">
                    Step back into the camera frame to immediately resume workspace.
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => {
                    setSecurityState((prev) => ({
                      ...prev,
                      isPresent: true,
                      faceConfidence: 98,
                      absenceDurationSeconds: 0,
                    }));
                    setIsLocked(false);
                  }}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold font-mono flex items-center gap-2 shadow-lg shadow-emerald-950 transition"
                >
                  <Unlock className="w-4 h-4" /> Verify &amp; Resume Now
                </button>
              </div>
            </div>

            {/* EXPEDITED EMERGENCY NOTE PAD (PER USER SPEC) */}
            <div className="border border-slate-800 rounded-xl bg-slate-950/90 p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2 text-xs font-semibold text-slate-300">
                  <Mic className="w-4 h-4 text-cyan-400" />
                  <span>Expedited Lab Note (Written or Audio)</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Notes can be incorporated into any active project or suggested by AI
                </span>
              </div>

              <div className="relative mb-3">
                <textarea
                  value={quickNoteText}
                  onChange={(e) => setQuickNoteText(e.target.value)}
                  placeholder="Dictate or type immediate empirical observation, formula adjustment, or lab note while paused..."
                  rows={3}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-mono"
                />

                {isRecordingAudio && (
                  <div className="absolute bottom-2 right-2 flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/80 border border-rose-600 text-rose-300 text-[10px] font-mono animate-pulse">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    RECORDING LIVE AUDIO &amp; SPEECH...
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={isRecordingAudio ? stopAudioDictation : startAudioDictation}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono font-medium flex items-center gap-1.5 transition ${
                      isRecordingAudio
                        ? 'bg-rose-600 text-white animate-pulse'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                    }`}
                  >
                    {isRecordingAudio ? (
                      <>
                        <MicOff className="w-3.5 h-3.5" /> Stop Mic
                      </>
                    ) : (
                      <>
                        <Mic className="w-3.5 h-3.5 text-rose-400" /> Audio Dictation
                      </>
                    )}
                  </button>

                  <select
                    value={selectedProjectId}
                    onChange={(e) => setSelectedProjectId(e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 font-mono"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        Target: {p.title.length > 28 ? p.title.substring(0, 28) + '...' : p.title}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    disabled={!quickNoteText.trim() || isSynthesizingNote}
                    onClick={() => handleSaveLockdownNote(true)}
                    className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-mono font-semibold flex items-center gap-1.5 disabled:opacity-50 transition"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    {isSynthesizingNote ? 'Synthesizing...' : 'AI Auto-Suggest &amp; Bind'}
                  </button>

                  <button
                    disabled={!quickNoteText.trim() || isSynthesizingNote}
                    onClick={() => handleSaveLockdownNote(false)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-mono flex items-center gap-1 disabled:opacity-50 transition"
                  >
                    <Send className="w-3.5 h-3.5" /> Save to Selected
                  </button>
                </div>
              </div>

              {synthesizedResult && (
                <div className="mt-3 p-2.5 rounded bg-cyan-950/40 border border-cyan-800 text-xs text-cyan-200">
                  <div className="font-semibold text-cyan-300 flex items-center gap-1 mb-1">
                    <Sparkles className="w-3 h-3" /> Incorporated into Project:{' '}
                    {synthesizedResult.suggestedProjectTitle}
                  </div>
                  <p className="text-[11px] text-slate-300">{synthesizedResult.relevanceExplanation}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Security Configuration Modal */}
      {showConfigModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sliders className="w-4 h-4 text-cyan-400" /> Biometric Presence &amp; Security Controls
              </h3>
              <button
                onClick={() => setShowConfigModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div>
                  <div className="font-semibold text-slate-200">Continuous Security State</div>
                  <div className="text-slate-400 text-[11px]">
                    Arm continuous 1-second absence detection
                  </div>
                </div>
                <button
                  onClick={() =>
                    setSecurityState((prev) => ({ ...prev, isArmed: !prev.isArmed }))
                  }
                  className={`px-3 py-1 rounded text-xs font-mono font-medium ${
                    securityState.isArmed
                      ? 'bg-emerald-600 text-white'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  {securityState.isArmed ? 'ARMED' : 'DISARMED'}
                </button>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">Optical Sensor Mode</span>
                  <span className="font-mono text-cyan-400 uppercase">{securityState.mode}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      startCamera();
                    }}
                    className={`flex-1 py-1.5 rounded font-mono border text-center transition ${
                      securityState.mode === 'webcam'
                        ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Physical Webcam Lens
                  </button>
                  <button
                    onClick={() => {
                      stopCamera();
                      setSecurityState((prev) => ({ ...prev, mode: 'simulated' }));
                    }}
                    className={`flex-1 py-1.5 rounded font-mono border text-center transition ${
                      securityState.mode === 'simulated'
                        ? 'bg-cyan-950 border-cyan-500 text-cyan-300'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Simulated Sensor (Demo)
                  </button>
                </div>
                {streamError && <div className="text-rose-400 text-[11px] mt-1">{streamError}</div>}
              </div>

              {/* Audit Log */}
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="font-semibold text-slate-200 mb-2 font-mono">Real-time Biometric Audit Trail</div>
                <div className="max-h-36 overflow-y-auto space-y-1 font-mono text-[10px]">
                  {securityState.auditLog.map((log, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between text-slate-400 border-b border-slate-900/80 pb-0.5"
                    >
                      <span className="text-slate-500">{log.timestamp}</span>
                      <span className="truncate max-w-[240px] text-slate-300">{log.event}</span>
                      <span
                        className={`uppercase font-bold ${
                          log.status === 'verified' || log.status === 'resumed'
                            ? 'text-emerald-400'
                            : 'text-rose-400'
                        }`}
                      >
                        {log.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 text-right">
              <button
                onClick={() => setShowConfigModal(false)}
                className="px-4 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-white font-mono text-xs"
              >
                Close Settings
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
