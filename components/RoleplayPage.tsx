
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Scenario, Skill, PracticeSession, User, MicroSkill, SkillSnapshot, TranscriptEntry, InteractionMedium } from '../types';
import { continueTextConversation, conversationModelForMedium, getFeedbackForTranscript, startTextConversation } from '../services/geminiService';
import { MicIcon } from './icons/MicIcon';
import { useLiveSession } from '../hooks/useLiveSession';
import { getGlobalFacilitatorContract, getMicroSkillTutorInstruction } from '../services/firebase';
import { GLOBAL_FACILITATOR_CONTRACT } from '../constants';

interface RoleplayPageProps {
  scenario: Scenario;
  skills: Skill[];
  currentUser: User;
  onSessionEnd: (sessionResult: PracticeSession, isDiagnostic?: boolean, isCompleted?: boolean) => void;
  onBackToDashboard: () => void;
  practiceMode?: {
    microSkill: MicroSkill;
    cuePrompt: string;
    snapshot?: SkillSnapshot;
  };
  mode?: 'diagnostic' | 'tutorial';
  interactionMedium: InteractionMedium;
}

const ArrowLeftIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
  </svg>
);

const isConclusionMessage = (entry?: TranscriptEntry) => {
  if (!entry || entry.speaker !== 'ai') return false;
  const text = entry.text.toLowerCase();
  return text.includes('concludes our session')
    || text.includes('concludes this session')
    || text.includes('concludes our tutorial session')
    || text.includes('ready to apply this in the field');
};

export const RoleplayPage: React.FC<RoleplayPageProps> = ({
  scenario, skills, currentUser,
  onSessionEnd, onBackToDashboard, practiceMode, mode: requestedMode = 'diagnostic', interactionMedium
}) => {
  const mode: 'diagnostic' | 'tutorial' = requestedMode === 'tutorial' ? 'tutorial' : 'diagnostic';
  const [showFeedbackConfirm, setShowFeedbackConfirm] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAiConcluded, setIsAiConcluded] = useState(false);
  const [tutorInstruction, setTutorInstruction] = useState<string | null>(null);
  const [globalFacilitatorContract, setGlobalFacilitatorContract] = useState(GLOBAL_FACILITATOR_CONTRACT);
  const [isDiagnosticInstructionReady, setIsDiagnosticInstructionReady] = useState(mode !== 'diagnostic');
  const [finalTranscript, setFinalTranscript] = useState<TranscriptEntry[]>([]);
  const [textStatus, setTextStatus] = useState<'idle' | 'connecting' | 'active' | 'error'>('idle');
  const [textError, setTextError] = useState<string | null>(null);
  const [textInput, setTextInput] = useState('');
  const [textTranscript, setTextTranscript] = useState<TranscriptEntry[]>([]);
  const [textSessionId, setTextSessionId] = useState<string | null>(null);
  const [textConversationModel, setTextConversationModel] = useState<string | null>(null);
  const [textUsageStatus, setTextUsageStatus] = useState<{ count: number; limit: number; remaining: number; unlimited?: boolean } | null>(null);
  const [isTextResponding, setIsTextResponding] = useState(false);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const hasAutoStartedTextRef = useRef(false);
  const textSessionInstructionRef = useRef<string | null>(null);
  const showTranscriptDebug = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('debugTranscript') === '1';

  const targetSkill = skills.find(s => s.id === scenario.skillId);

  useEffect(() => {
    if (mode === 'diagnostic') {
      getGlobalFacilitatorContract()
        .then(setGlobalFacilitatorContract)
        .catch((err) => {
          console.warn("Using bundled facilitator contract; Firestore refresh failed:", err);
        })
        .finally(() => setIsDiagnosticInstructionReady(true));
    }
  }, [mode]);

  useEffect(() => {
    if (mode === 'tutorial' && practiceMode) {
      getMicroSkillTutorInstruction().then(baseInstruction => {
        const memoryList = currentUser.growth_memory && currentUser.growth_memory.trim().length > 0
          ? currentUser.growth_memory
          : "No specific prior focus areas.";

        const inputData = `
### SESSION INPUT DATA (CONFIDENTIAL):
- Micro-skill label: ${practiceMode.microSkill.label}
- Success cue: ${practiceMode.microSkill.cue || 'None'}
- Common trap: ${practiceMode.microSkill.trap || 'None'}
- Criteria: ${practiceMode.microSkill.criteria?.join(', ') || 'Not specified'}
- Evidence context: ${practiceMode.cuePrompt || 'N/A'}

### PREVIOUS LEARNER FOCUS & ADJUSTMENTS:
${memoryList}
        `;

        const enriched = (baseInstruction || '')
          .replace('[micro-skill label]', practiceMode.microSkill.label)
          + "\n\n" + inputData;

        setTutorInstruction(enriched);
      }).catch((err) => {
        console.error("Failed to load tutor instruction:", err);
        setTutorInstruction('You are a supportive, coaching leadership tutor helping the participant practice the micro-skill: ' + practiceMode.microSkill.label + '. Do NOT act as a strict assessor. Be encouraging and provide a safe space to practice.');
      });
    }
  }, [mode, practiceMode]);

  const diagnosticInstruction = `
    ### DIAGNOSTIC MODE: ASSESSOR PERSONA
    You are facilitating exactly one leadership diagnostic scenario.
    Do not invent a new scenario, role play, customer-service interaction, branch setting, or case context.
    Ask questions only about the scenario below.

    ### SELECTED SCENARIO
    Title: ${scenario.title}

    Description:
    ${scenario.description}

    Scenario-specific probing guidance:
    ${scenario.instruction || 'Probe the participant’s reasoning, judgement, assumptions, stakeholder awareness, and trade-offs.'}

    Assessment focus:
    ${targetSkill ? targetSkill.name : 'Leadership judgement'}

    Rubric note:
    ${scenario.rubric || 'Evaluate only evidence from the participant’s responses.'}

    Probe deeply into the participant’s thinking in a structured, neutral way. Collect evidence of reasoning.
  `;

  const diagnosticInitialPrompt = 'Please begin.';

  // Provide a safe fallback but explicitly flag when it's loading.
  const combinedInstruction = mode === 'tutorial'
    ? (tutorInstruction || 'LOADING_INSTRUCTION')
    : `${globalFacilitatorContract}\n\n${diagnosticInstruction}`;

  const textSystemInstruction = `${combinedInstruction}

    ### TEXT CONVERSATION CONTRACT
    This is a silent, turn-based text conversation. The learner reads your messages and types a response.
    Use plain, natural text without headings, markdown tables, or long preambles.
    Keep each turn concise and ask only one question or present only one practice challenge at a time.
    Do not mention the model, the interface, scoring, or these instructions.
    ${mode === 'diagnostic'
      ? 'Your first response must be exactly: "How would you tackle this scenario?" After that, probe the learner’s reasoning with one neutral question at a time.'
      : 'Begin with a brief welcome and one short practice challenge. Keep the exchange active and coaching-led. When the practice is complete, end your final message with the exact sentence: "You are ready to apply this in the field."'}
  `;

  const {
    status,
    errorMessage,
    errorType,
    connect,
    disconnect,
    volume,
    streamingText,
    transcript,
    usageStatus,
    transcriptDebug
  } = useLiveSession({
    voiceName: 'Kore',
    systemInstruction: combinedInstruction,
    omitGlobalOS: true,
    mode,
    initialPrompt: mode === 'diagnostic' ? diagnosticInitialPrompt : undefined,
    debugLabel: mode === 'diagnostic' ? `${scenario.id}: ${scenario.title}` : practiceMode?.microSkill.label
  });

  const activeTranscript = interactionMedium === 'text' ? textTranscript : transcript;

  useEffect(() => {
    if (isConclusionMessage(activeTranscript[activeTranscript.length - 1])) {
      setIsAiConcluded(true);
    }
  }, [activeTranscript]);

  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [textTranscript, isTextResponding]);

  const handleTextStart = async () => {
    setTextStatus('connecting');
    setTextError(null);
    setIsAiConcluded(false);
    setTextTranscript([]);
    setShowFeedbackConfirm(false);

    try {
      const instructionForSession = textSystemInstruction;
      textSessionInstructionRef.current = instructionForSession;
      const started = await startTextConversation(mode, instructionForSession);
      setTextSessionId(started.sessionId);
      setTextConversationModel(started.model);
      setTextUsageStatus(started.usage || null);
      setTextTranscript([{ speaker: 'ai', text: started.response }]);
      setTextStatus('active');
    } catch (error: any) {
      const details = error?.details as { count?: number; limit?: number; remaining?: number } | undefined;
      if (details?.limit) {
        setTextUsageStatus({
          count: details.count || details.limit,
          limit: details.limit,
          remaining: details.remaining || 0,
        });
      }
      setTextError(error?.message || 'The text conversation could not start. Please try again.');
      setTextStatus('error');
    }
  };

  const handleTextSend = async () => {
    const message = textInput.trim();
    if (!message || !textSessionId || isTextResponding || isAiConcluded) return;

    const withLearnerResponse: TranscriptEntry[] = [...textTranscript, { speaker: 'user', text: message }];
    setTextInput('');
    setTextTranscript(withLearnerResponse);
    setIsTextResponding(true);
    setTextError(null);

    try {
      const result = await continueTextConversation(textSessionId, textSessionInstructionRef.current || textSystemInstruction, withLearnerResponse);
      setTextConversationModel(result.model);
      setTextTranscript([...withLearnerResponse, { speaker: 'ai', text: result.response }]);
    } catch (error: any) {
      setTextError(error?.message || 'The tutor could not respond. Your typed response is still shown above; please try again.');
    } finally {
      setIsTextResponding(false);
    }
  };

  const handleTextRetry = async () => {
    if (!textSessionId || isTextResponding || textTranscript[textTranscript.length - 1]?.speaker !== 'user') return;
    setIsTextResponding(true);
    setTextError(null);
    try {
      const result = await continueTextConversation(textSessionId, textSessionInstructionRef.current || textSystemInstruction, textTranscript);
      setTextConversationModel(result.model);
      setTextTranscript([...textTranscript, { speaker: 'ai', text: result.response }]);
    } catch (error: any) {
      setTextError(error?.message || 'The tutor could not respond. Please try again.');
    } finally {
      setIsTextResponding(false);
    }
  };

  useEffect(() => {
    if (
      interactionMedium === 'text'
      && textStatus === 'idle'
      && isDiagnosticInstructionReady
      && combinedInstruction !== 'LOADING_INSTRUCTION'
      && !hasAutoStartedTextRef.current
    ) {
      hasAutoStartedTextRef.current = true;
      handleTextStart();
    }
  }, [interactionMedium, textStatus, combinedInstruction, isDiagnosticInstructionReady]);

  const handleStart = () => {
    setShowFeedbackConfirm(false);
    setIsAiConcluded(false);
    connect();
  };

  const handleStop = async () => {
    const stoppedTranscript = interactionMedium === 'text'
      ? textTranscript
      : await disconnect();
    setFinalTranscript(stoppedTranscript);
    setShowFeedbackConfirm(true);
  };

  const handleGetFeedback = async () => {
    setIsAnalyzing(true);
    setShowFeedbackConfirm(false);

    try {
      const feedback = mode === 'diagnostic'
        ? (await getFeedbackForTranscript(scenario, finalTranscript, targetSkill?.name || 'Leadership', 'English')).text?.replace(/```json/gi, '').replace(/```/g, '').trim()
        : undefined;

      await onSessionEnd({
        id: '',
        userId: currentUser.id,
        scenarioId: scenario.id,
        transcript: finalTranscript,
        feedback,
        interactionMedium,
        conversationModel: interactionMedium === 'text'
          ? (textConversationModel || conversationModelForMedium('text'))
          : conversationModelForMedium('voice'),
        analysisModel: 'gemini-3.5-flash',
        timestamp: new Date().toISOString(),
        status: 'completed'
      }, mode === 'diagnostic', mode === 'tutorial' ? true : isAiConcluded);
    } catch (e) {
      await onSessionEnd({
        id: '',
        userId: currentUser.id,
        scenarioId: scenario.id,
        transcript: finalTranscript,
        feedback: JSON.stringify({ error: true }),
        interactionMedium,
        conversationModel: interactionMedium === 'text'
          ? (textConversationModel || conversationModelForMedium('text'))
          : conversationModelForMedium('voice'),
        analysisModel: 'gemini-3.5-flash',
        timestamp: new Date().toISOString(),
        status: 'completed'
      }, mode === 'diagnostic', isAiConcluded);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDiscardSession = () => {
    onBackToDashboard();
  };

  if (interactionMedium === 'text') {
    const canFinish = textTranscript.some(entry => entry.speaker === 'user');

    return (
      <div className="flex flex-col min-h-[100dvh] bg-white overflow-hidden relative">
        <header className="flex-none min-h-16 px-4 md:px-6 py-3 border-b border-gray-100 flex items-center justify-between gap-4 bg-white z-10">
          <button onClick={onBackToDashboard} className="flex items-center gap-2 px-3 py-2 rounded-full hover:bg-gray-100 transition-colors text-gray-600">
            <ArrowLeftIcon />
            <span className="text-sm font-medium hidden sm:inline">Return to Dashboard</span>
          </button>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <span className="px-3 py-1.5 rounded-full border bg-gray-50 text-[10px] font-bold uppercase tracking-wider text-gray-600">
              {mode === 'tutorial' ? 'Micro-Skill Practice' : 'Assessor Lab'}
            </span>
            <span className="px-3 py-1.5 rounded-full border bg-indigo-50 border-indigo-100 text-[10px] font-bold uppercase tracking-wider text-indigo-600">
              Text conversation
            </span>
          </div>
        </header>

        <main className="flex-grow min-h-0 flex flex-col w-full max-w-4xl mx-auto px-4 md:px-8 py-6">
          <div className="text-center space-y-1 mb-6 flex-none">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
              {mode === 'tutorial' ? 'Micro-skill' : 'Diagnostic scenario'}
            </p>
            <h1 className="text-xl md:text-2xl font-black text-gray-900 tracking-tight uppercase">
              {mode === 'tutorial' ? practiceMode?.microSkill.label : scenario.title}
            </h1>
          </div>

          {mode === 'diagnostic' && (
            <div className="flex-none mb-6 bg-gray-50 border border-gray-100 rounded-3xl p-6 shadow-inner">
              <p className="text-sm text-gray-600 leading-relaxed font-medium whitespace-pre-wrap">
                {scenario.description}
              </p>
            </div>
          )}

          {textStatus !== 'active' ? (
            <div className="flex-grow flex flex-col items-center justify-center text-center max-w-md mx-auto pb-20">
              {textStatus === 'connecting' ? (
                <>
                  <div className="w-10 h-10 border-4 border-gray-100 border-t-indigo-500 rounded-full animate-spin mb-6" />
                  <p className="font-black text-gray-900">Preparing your text conversation…</p>
                  <p className="text-sm text-gray-500 mt-2">The tutor will begin with the first question.</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-3xl bg-gray-100 flex items-center justify-center text-2xl mb-6" aria-hidden="true">Aa</div>
                  <h2 className="text-2xl font-black text-gray-900">Ready when you are</h2>
                  <p className="text-sm text-gray-500 font-medium leading-relaxed mt-3 mb-8">
                    The tutor will respond in text. You can type, paste, or use your device’s ordinary dictation in the response box.
                  </p>
                  {textError && <p className="text-sm text-rose-600 font-medium mb-5" role="alert">{textError}</p>}
                  <button
                    type="button"
                    onClick={handleTextStart}
                    disabled={textStatus === 'connecting' || combinedInstruction === 'LOADING_INSTRUCTION'}
                    className="bg-black text-white px-10 py-4 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-600 transition-colors disabled:opacity-50"
                  >
                    {textStatus === 'error' ? 'Try again' : 'Begin text conversation'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <>
              <div className="flex-grow min-h-0 max-h-[50dvh] overflow-y-auto rounded-3xl bg-gray-50 border border-gray-100 px-4 py-6 md:p-8 space-y-6" aria-live="polite">
                {textTranscript.map((entry, index) => (
                  <div key={`${entry.speaker}-${index}`} className={`flex ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] md:max-w-[75%] ${entry.speaker === 'user' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-800 border border-gray-200'} rounded-3xl px-5 py-4 shadow-sm`}>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-2 ${entry.speaker === 'user' ? 'text-white/60' : 'text-gray-400'}`}>
                        {entry.speaker === 'user' ? 'You' : mode === 'tutorial' ? 'Tutor' : 'Assessor'}
                      </p>
                      <p className="text-sm md:text-base font-medium leading-relaxed whitespace-pre-wrap">{entry.text}</p>
                    </div>
                  </div>
                ))}

                {isTextResponding && (
                  <div className="flex justify-start">
                    <div className="bg-white border border-gray-200 rounded-3xl px-5 py-4 shadow-sm">
                      <span className="sr-only">Tutor is responding</span>
                      <div className="flex gap-1.5" aria-hidden="true">
                        <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                        <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '120ms' }} />
                        <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '240ms' }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={conversationEndRef} />
              </div>

              <div className="flex-none pt-4">
                {textError && (
                  <div className="flex items-center justify-between gap-4 mb-3 px-4 py-3 bg-rose-50 rounded-2xl" role="alert">
                    <p className="text-xs font-medium text-rose-700">{textError}</p>
                    <button type="button" onClick={handleTextRetry} className="text-xs font-black text-rose-700 underline shrink-0">Try again</button>
                  </div>
                )}

                {isAiConcluded ? (
                  <button type="button" onClick={handleStop} className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg">
                    Finish session
                  </button>
                ) : (
                  <form
                    onSubmit={(event) => { event.preventDefault(); handleTextSend(); }}
                    className="flex items-end gap-3 p-2 pl-4 bg-white border border-gray-200 rounded-3xl shadow-lg focus-within:border-indigo-400"
                  >
                    <label htmlFor="text-response" className="sr-only">Your response</label>
                    <textarea
                      id="text-response"
                      value={textInput}
                      onChange={(event) => setTextInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault();
                          handleTextSend();
                        }
                      }}
                      disabled={isTextResponding}
                      maxLength={8000}
                      rows={2}
                      placeholder="Type your response…"
                      className="flex-grow resize-none bg-transparent py-2 text-sm md:text-base text-gray-900 placeholder:text-gray-400 outline-none disabled:opacity-60"
                    />
                    <button
                      type="submit"
                      disabled={!textInput.trim() || isTextResponding}
                      className="shrink-0 bg-black text-white px-5 py-3 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-indigo-600 transition-colors disabled:opacity-30"
                    >
                      Send
                    </button>
                  </form>
                )}

                <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3 px-1 pt-4">
                  {textUsageStatus ? (
                    <span className="text-[9px] text-gray-400 font-bold uppercase tracking-widest">
                      {textUsageStatus.unlimited
                        ? 'Testing account: unlimited sessions'
                        : `${mode === 'tutorial' ? 'Tutorials' : 'Scenarios'} today: ${Math.min(textUsageStatus.count, textUsageStatus.limit)}/${textUsageStatus.limit}`}
                    </span>
                  ) : <span />}
                  {!isAiConcluded && (
                    <button
                      type="button"
                      onClick={handleStop}
                      disabled={!canFinish || isTextResponding}
                      className="w-full sm:w-auto rounded-2xl bg-gray-900 px-6 py-3 text-xs font-black uppercase tracking-widest text-white shadow-md transition-colors hover:bg-indigo-600 disabled:bg-gray-100 disabled:text-gray-400 disabled:shadow-none"
                    >
                      Finish
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </main>

        {showFeedbackConfirm && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-md flex items-center justify-center z-50 p-6">
            <div className="bg-white rounded-3xl p-8 max-w-sm w-full border border-gray-200 shadow-2xl animate-in zoom-in-95 duration-300">
              <h3 className="text-xl font-bold text-gray-900 mb-2">{mode === 'tutorial' ? 'Reflect on Practice' : 'Review Evidence'}</h3>
              <p className="text-gray-500 mb-8 text-sm">Your text conversation has ended. Would you like Skill Builder to analyse it now?</p>
              <div className="flex flex-col gap-3">
                <button onClick={handleGetFeedback} className="w-full bg-black text-white py-4 rounded-2xl font-bold text-sm">Analyse Interaction</button>
                <button onClick={() => setShowFeedbackConfirm(false)} className="w-full text-gray-500 py-3 font-bold text-xs">Continue conversation</button>
                <button onClick={handleDiscardSession} className="w-full text-gray-300 py-3 font-bold text-xs">Discard Interaction</button>
              </div>
            </div>
          </div>
        )}

        {isAnalyzing && (
          <div className="fixed inset-0 bg-white/90 flex flex-col items-center justify-center z-[60]">
            <div className="w-10 h-10 border-4 border-gray-100 border-t-indigo-500 rounded-full animate-spin mb-5" />
            <p className="font-black text-gray-900">Analysing the conversation…</p>
          </div>
        )}
      </div>
    );
  }

  /**
   * CENTRALIZED INSTRUCTION LOGIC (SINGLE RULE)
   * Ensures only one primary instruction is visible at a time.
   */
  let instructionAreaContent: React.ReactNode = '';
  let belowMicText = '';
  let isNudge = false;

  const lastEntry = transcript[transcript.length - 1];

  if (isAnalyzing) {
    instructionAreaContent = 'Analyzing capability...';
    belowMicText = 'Processing...';
  } else if (status === 'error') {
    instructionAreaContent = errorMessage || 'Connection error. Check mic access.';
    belowMicText = errorType === 'limit' ? 'Daily limit reached' : 'Tap to retry';
  } else if (status === 'connecting') {
    instructionAreaContent = "Warming up...";
    belowMicText = 'Connecting...';
  } else if (status === 'active') {
    if (isAiConcluded) {
      instructionAreaContent = "Session concluded. Tap to finish.";
      belowMicText = 'Finalize Rep';
    } else if (streamingText) {
      // Show listening animation instead of transcript
      instructionAreaContent = (
        <div className="flex gap-2 justify-center items-center h-full">
          <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-2.5 h-2.5 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      );
      belowMicText = 'Voice Active';
    } else if (lastEntry && lastEntry.speaker === 'ai') {
      // In diagnostic mode the live transcription is only evidence capture; do
      // not show provisional AI transcript text to the learner.
      instructionAreaContent = mode === 'tutorial' ? lastEntry.text : 'Your turn';
      belowMicText = 'Voice Active';
    } else if (transcript.length === 0) {
      instructionAreaContent = "Wait for tutor to speak";
      belowMicText = 'Voice Active';
      isNudge = true;
    } else {
      // Fallback: If learner just spoke and AI hasn't started yet, 
      // show "Voice Active" while waiting for AI processing.
      belowMicText = 'Voice Active';
    }
  } else {
    // Idle state
    if (mode === 'tutorial' && !tutorInstruction) {
      belowMicText = "Loading tutor profile...";
    } else {
      belowMicText = mode === 'tutorial'
        ? "Tap to start and begin the tutorial."
        : "Tap to start the scenario exploration.";
    }
  }

  return (
    <div className="flex flex-col min-h-[100dvh] bg-white overflow-hidden relative">

      <header className="flex-none h-16 px-4 md:px-6 border-b border-gray-100 flex items-center justify-between bg-white z-10">
        <button onClick={onBackToDashboard} className="flex items-center gap-2 px-3 py-2 rounded-full hover:bg-gray-100 transition-colors text-gray-600">
          <ArrowLeftIcon />
          <span className="text-sm font-medium">Return to Dashboard</span>
        </button>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className={`flex items-center gap-2.5 px-3 py-1.5 rounded-full border ${status === 'active' ? 'bg-indigo-50 border-indigo-100 text-indigo-600' : 'bg-gray-50'}`}>
            <span className="text-[10px] font-bold uppercase tracking-wider">{mode === 'tutorial' ? 'Micro-Skill Practice' : 'Assessor Lab'}</span>
          </div>
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full border bg-gray-50 text-gray-600">
            <span className="text-[10px] font-bold uppercase tracking-wider">Voice conversation</span>
          </div>
        </div>
      </header>

      <main className="flex-grow flex flex-col items-center justify-center p-6 relative overflow-y-auto">
        <div className="max-w-xl w-full flex flex-col items-center gap-8">
          <div className="text-center space-y-4 w-full">
            {mode === 'tutorial' ? (
              <div className="space-y-2 mb-6">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Micro-skill</p>
                <h1 className="text-2xl md:text-4xl font-black text-gray-900 tracking-tight leading-tight uppercase">
                  {practiceMode?.microSkill.label}
                </h1>
              </div>
            ) : (
              <div className="space-y-6 mb-6 text-left">
                <div className="text-center space-y-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Diagnostic Scenario</p>
                  <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight leading-tight uppercase">
                    {scenario.title}
                  </h1>
                </div>

                <div className="bg-gray-50 border border-gray-100 rounded-3xl p-6 shadow-inner">
                  <p className="text-sm text-gray-600 leading-relaxed font-medium whitespace-pre-wrap">
                    {scenario.description}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col items-center w-full">
            {/* Main Single Instruction Area - Persists the AI message while pondering */}
            <div className="h-24 w-full flex items-center justify-center mb-10 relative">
              <div className={`text-lg font-bold text-center transition-all px-8 ${isNudge ? 'text-indigo-500 italic' : 'text-gray-900'} w-full h-full flex flex-col items-center justify-center`}>
                {instructionAreaContent}
              </div>
            </div>

            <div className="relative group">
              <div
                className={`absolute inset-0 rounded-full transition-all duration-700 ${isAiConcluded ? 'bg-indigo-500 animate-pulse' : 'bg-indigo-50'}`}
                style={{
                  opacity: status === 'active' ? (isAiConcluded ? 0.3 : 0.6) : 0,
                  transform: `scale(${1 + (volume / 80) + (isAiConcluded ? 0.2 : 0)})`
                }}
              />
              <div className="flex flex-col items-center gap-6">
                <button
                  onClick={status === 'error' && errorType === 'limit' ? onBackToDashboard : (status === 'idle' || status === 'error') ? handleStart : handleStop}
                  disabled={status === 'connecting' || isAnalyzing || combinedInstruction === 'LOADING_INSTRUCTION'}
                  className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all z-10 shadow-xl active:scale-[0.9] ${status === 'active' ? (isAiConcluded ? 'bg-indigo-600 animate-bounce shadow-indigo-200 shadow-2xl' : 'bg-indigo-600') :
                    status === 'connecting' || isAnalyzing ? 'bg-gray-800 cursor-wait' : 'bg-black'
                    } text-white disabled:opacity-60`}
                >
                  {status === 'connecting' || isAnalyzing ? (
                    <div className="w-8 h-8 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : status === 'active' ? (
                    <div className="w-8 h-8 bg-white rounded-sm" />
                  ) : (
                    <MicIcon className="w-10 h-10" />
                  )}
                </button>

                <div className="flex flex-col items-center text-center">
                  <span className={`text-[10px] font-black uppercase tracking-[0.15em] leading-relaxed max-w-[240px] ${isAiConcluded ? 'text-indigo-600 animate-pulse' :
                    status === 'connecting' ? 'text-indigo-400 animate-pulse' : status === 'error' ? 'text-rose-500' : 'text-gray-400'
                    }`}>
                    {belowMicText}
                  </span>
                  {usageStatus && (
                    <span className="text-[9px] text-gray-300 font-bold mt-2 uppercase tracking-widest">
                      {usageStatus.unlimited
                        ? 'Testing account: unlimited sessions'
                        : `${mode === 'tutorial' ? 'Tutorials' : 'Scenarios'} today: ${Math.min(usageStatus.count, usageStatus.limit)}/${usageStatus.limit}, ${usageStatus.remaining} remaining`}
                    </span>
                  )}
                  {status === 'active' && !isAiConcluded && (
                    <span className="text-[9px] text-gray-300 font-bold mt-2 uppercase tracking-widest animate-fade-in">Tap square to stop</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>


      {showTranscriptDebug && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:w-[440px] max-h-[45vh] overflow-y-auto bg-black/85 text-white rounded-2xl shadow-2xl z-[60] p-4 text-xs font-mono border border-white/10">
          <div className="flex items-center justify-between mb-3">
            <span className="font-bold uppercase tracking-widest text-white/70">Transcript Debug</span>
            <span className="text-white/50">{status}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3 text-center">
            <div className="bg-white/10 rounded-lg p-2">
              <div className="text-white/50">input chunks</div>
              <div className="text-lg font-bold">{transcriptDebug.inputChunkCount}</div>
            </div>
            <div className="bg-white/10 rounded-lg p-2">
              <div className="text-white/50">output chunks</div>
              <div className="text-lg font-bold">{transcriptDebug.outputChunkCount}</div>
            </div>
            <div className="bg-white/10 rounded-lg p-2">
              <div className="text-white/50">entries</div>
              <div className="text-lg font-bold">{transcript.length}</div>
            </div>
          </div>
          <div className="mb-3">
            <div className="text-white/50 mb-1">last serverContent keys</div>
            <div className="break-words text-white/80">{transcriptDebug.lastServerContentKeys.join(', ') || 'none'}</div>
          </div>
          <div className="mb-3">
            <div className="text-white/50 mb-1">live input buffer</div>
            <div className="whitespace-pre-wrap text-white/90">{transcriptDebug.inputBuffer || 'empty'}</div>
          </div>
          <div className="mb-3">
            <div className="text-white/50 mb-1">live output buffer</div>
            <div className="whitespace-pre-wrap text-white/90">{transcriptDebug.outputBuffer || 'empty'}</div>
          </div>
          <div className="mb-3">
            <div className="text-white/50 mb-1">finalTranscript entries after stop: {finalTranscript.length}</div>
            <pre className="whitespace-pre-wrap text-white/80">{JSON.stringify(finalTranscript, null, 2)}</pre>
          </div>
          <div>
            <div className="text-white/50 mb-1">current transcript array</div>
            <pre className="whitespace-pre-wrap text-white/80">{JSON.stringify(transcript, null, 2)}</pre>
          </div>
        </div>
      )}

      {showFeedbackConfirm && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-md flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-3xl p-8 max-sm w-full border border-gray-200 shadow-2xl animate-in zoom-in-95 duration-300">
            <h3 className="text-xl font-bold text-gray-900 mb-2">{mode === 'tutorial' ? 'Sync Practice' : 'Sync Evidence'}</h3>
            <p className="text-gray-500 mb-8 text-sm">Session recording stopped. Would you like to analyze this interaction for your capability profile?</p>
            <div className="flex flex-col gap-3">
              <button onClick={handleGetFeedback} className="w-full bg-black text-white py-4 rounded-2xl font-bold text-sm">Analyze Interaction</button>
              <button onClick={handleDiscardSession} className="w-full text-gray-400 py-4 font-bold text-xs">Discard Interaction</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
