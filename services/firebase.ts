
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    GoogleAuthProvider,
    signInWithPopup,
    signOut,
    sendPasswordResetEmail,
    sendEmailVerification,
} from 'firebase/auth';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    deleteDoc,
    query,
    where,
    writeBatch,
    updateDoc,
    orderBy,
    limit,
    addDoc,
    documentId,
    startAfter,
} from 'firebase/firestore';

import { auth, db } from '../firebaseConfig';
import { User, Role, Scenario, Skill, PracticeSession, FeedbackAnalysis, PracticeAttempt, AppFeedback, SkillLibrary } from '../types';
import {
    INITIAL_USERS,
    INITIAL_SCENARIOS,
    INITIAL_SKILLS,
    GLOBAL_FACILITATOR_CONTRACT,
    GLOBAL_ASSESSMENT_PROTOCOL,
    MICRO_SKILL_TUTOR_INSTRUCTION,
    MICRO_SKILLS_LIBRARY_V2
} from '../constants';

// --- Database Seeding ---
let dbInitializationPromise: Promise<void> | null = null;

const seedDatabase = async () => {
    try {
        const skillsSnap = await getDocs(collection(db, 'skills'));
        if (skillsSnap.empty) {
            const skillsBatch = writeBatch(db);
            for (const skill of INITIAL_SKILLS) {
                skillsBatch.set(doc(db, 'skills', skill.id), skill);
            }
            await skillsBatch.commit();
        }

        const scenariosSnap = await getDocs(collection(db, 'scenarios'));
        if (scenariosSnap.empty) {
            const scenariosBatch = writeBatch(db);
            for (const scenario of INITIAL_SCENARIOS) {
                scenariosBatch.set(doc(db, 'scenarios', scenario.id), scenario);
            }
            await scenariosBatch.commit();
        }

        const libRef = doc(db, 'system_logic', 'skillLibrary');
        const libSnap = await getDoc(libRef);
        if (!libSnap.exists()) {
            await setDoc(libRef, MICRO_SKILLS_LIBRARY_V2);
        }

        const facRef = doc(db, 'system_logic', 'globalFacilitator');
        const facSnap = await getDoc(facRef);
        if (!facSnap.exists()) {
            await setDoc(facRef, { content: GLOBAL_FACILITATOR_CONTRACT });
        }

        const assRef = doc(db, 'system_logic', 'globalAssessor');
        const assSnap = await getDoc(assRef);
        if (!assSnap.exists()) {
            await setDoc(assRef, { content: GLOBAL_ASSESSMENT_PROTOCOL });
        }

        const tutRef = doc(db, 'system_logic', 'microSkillTutor');
        const tutSnap = await getDoc(tutRef);
        if (!tutSnap.exists()) {
            await setDoc(tutRef, { content: MICRO_SKILL_TUTOR_INSTRUCTION });
        }

    } catch (error: any) {
        dbInitializationPromise = null;
        console.error("Database initialization failed:", error);
    }
};

export const forceResetSystemScenarios = async () => {
    const snap = await getDocs(collection(db, 'scenarios'));
    const batch = writeBatch(db);

    // Delete existing scenarios
    snap.docs.forEach(d => {
        batch.delete(d.ref);
    });

    // Re-seed initial scenarios
    INITIAL_SCENARIOS.forEach(s => {
        batch.set(doc(db, 'scenarios', s.id), s);
    });

    // Reset global logic
    batch.set(doc(db, 'system_logic', 'globalFacilitator'), { content: GLOBAL_FACILITATOR_CONTRACT });
    batch.set(doc(db, 'system_logic', 'globalAssessor'), { content: GLOBAL_ASSESSMENT_PROTOCOL });
    batch.set(doc(db, 'system_logic', 'microSkillTutor'), { content: MICRO_SKILL_TUTOR_INSTRUCTION });
    batch.set(doc(db, 'system_logic', 'skillLibrary'), MICRO_SKILLS_LIBRARY_V2);

    await batch.commit();
};

export const ensureDbInitialized = () => {
    if (!dbInitializationPromise) {
        dbInitializationPromise = seedDatabase();
    }
    return dbInitializationPromise;
};

// --- Global Logic Fetchers & Savers ---
export const getSkillLibrary = async (): Promise<SkillLibrary> => {
    const snap = await getDoc(doc(db, 'system_logic', 'skillLibrary'));
    return snap.exists() ? snap.data() as SkillLibrary : MICRO_SKILLS_LIBRARY_V2;
};

export const saveSkillLibrary = (library: SkillLibrary) =>
    setDoc(doc(db, 'system_logic', 'skillLibrary'), library);

export const getGlobalFacilitatorContract = async (): Promise<string> => {
    const snap = await getDoc(doc(db, 'system_logic', 'globalFacilitator'));
    const content = snap.exists() ? snap.data().content : null;
    return content || GLOBAL_FACILITATOR_CONTRACT;
};

export const getGlobalAssessorProtocol = async (): Promise<string> => {
    const snap = await getDoc(doc(db, 'system_logic', 'globalAssessor'));
    const content = snap.exists() ? snap.data().content : null;
    return content || GLOBAL_ASSESSMENT_PROTOCOL;
};

export const getMicroSkillTutorInstruction = async (): Promise<string> => {
    const snap = await getDoc(doc(db, 'system_logic', 'microSkillTutor'));
    const content = snap.exists() ? snap.data().content : null;
    return content || MICRO_SKILL_TUTOR_INSTRUCTION;
};

export const saveGlobalFacilitatorContract = (content: string) =>
    setDoc(doc(db, 'system_logic', 'globalFacilitator'), { content });

export const saveGlobalAssessorProtocol = (content: string) =>
    setDoc(doc(db, 'system_logic', 'globalAssessor'), { content });

export const saveMicroSkillTutorInstruction = (content: string) =>
    setDoc(doc(db, 'system_logic', 'microSkillTutor'), { content });

// --- User Management ---
export const getUser = async (uid: string, details?: { email: string }): Promise<User | null> => {
    const docRef = doc(db, 'users', uid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) return docSnap.data() as User;

    if (details?.email) {
        const newUser: User = {
            id: uid,
            email: details.email,
            role: details.email === 'gary@gardenersnotmechanics.com' ? Role.ADMIN : Role.LEARNER,
            skill_mastery: {},
            growth_memory: "",
            reminders_enabled: true,
            retention_map: {}
        };
        await setDoc(docRef, newUser);
        return newUser;
    }
    return null;
}

export const getAllUsers = async (): Promise<User[]> => {
    const snapshot = await getDocs(collection(db, 'users'));
    return snapshot.docs.map(doc => doc.data() as User);
};

export interface AdminUsageRecord {
    id: string;
    userId: string;
    scenarioId: string;
    microSkillId?: string;
    kind: 'scenario' | 'micro-skill';
    timestamp: string;
    completedAt?: string;
    completed: boolean;
    medium?: 'voice' | 'text';
}

// Read existing activity without retaining transcripts or feedback in the usage view.
// Page through every record so the report is not capped at 100 sessions.
export const getAdminUsageRecords = async (): Promise<AdminUsageRecord[]> => {
    const readCollection = async (name: string, kind: AdminUsageRecord['kind']) => {
        const records: AdminUsageRecord[] = [];
        let cursor: Parameters<typeof startAfter>[0] | undefined;
        while (true) {
            const constraints = [orderBy(documentId()), ...(cursor ? [startAfter(cursor)] : []), limit(250)];
            const page = await getDocs(query(collection(db, name), ...constraints));
            page.docs.forEach(snapshot => {
                const data = snapshot.data();
                records.push({
                    id: snapshot.id,
                    userId: data.userId,
                    scenarioId: data.scenarioId,
                    microSkillId: data.microSkillId,
                    kind,
                    timestamp: data.timestamp,
                    completedAt: data.completedAt,
                    completed: kind === 'scenario' ? data.status === 'completed' : !!data.completedAt,
                    medium: data.interactionMedium,
                });
            });
            if (page.size < 250) return records;
            cursor = page.docs[page.docs.length - 1];
        }
    };
    const [sessions, attempts] = await Promise.all([
        readCollection('practiceSessions', 'scenario'),
        readCollection('practiceAttempts', 'micro-skill'),
    ]);
    return [...sessions, ...attempts];
};

export const logEvent = async (userId: string, eventType: string, payload: any) => {
    await addDoc(collection(db, 'events'), {
        userId, eventType, payload, timestamp: new Date().toISOString()
    });
};

export const savePracticeAttempt = async (attempt: Partial<PracticeAttempt>): Promise<PracticeAttempt> => {
    const id = attempt.id || doc(collection(db, 'practiceAttempts')).id;
    const fullAttempt = { ...attempt, id, timestamp: attempt.timestamp || new Date().toISOString() } as PracticeAttempt;
    await setDoc(doc(db, 'practiceAttempts', id), fullAttempt, { merge: true });
    return fullAttempt;
};

export const getPracticeAttempts = async (uid: string): Promise<PracticeAttempt[]> => {
    const q = query(collection(db, 'practiceAttempts'), where('userId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as PracticeAttempt);
};

export const patchOldAttempts = async (uid: string) => {
    const q = query(collection(db, 'practiceAttempts'), where('userId', '==', uid));
    const snap = await getDocs(q);
    let count = 0;
    for (const d of snap.docs) {
        const data = d.data();
        // If it lacks a completedAt but has reflection/snapshot, it basically finished.
        // We'll just backfill completedAt with its initial timestamp so it shows up.
        if (!data.completedAt) {
            await updateDoc(doc(db, 'practiceAttempts', d.id), {
                completedAt: data.timestamp
            });
            count++;
        }
    }
    return count;
};

export const toggleUserReminders = async (userId: string, enabled: boolean) => {
    await updateDoc(doc(db, 'users', userId), { reminders_enabled: enabled });
};

export const updateUserMemory = async (userId: string, feedback: FeedbackAnalysis, scenarioId: string): Promise<User | null> => {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return null;

    const userData = userSnap.data() as User;
    const currentMemory = userData.growth_memory || "";
    const execSummary = feedback.summary?.overall_summary || "Session completed.";
    const updatedMemory = (currentMemory + "\n[Session " + scenarioId + "]: " + execSummary).slice(-2000);

    const updatedMastery = { ...(userData.skill_mastery || {}) };
    const updatedRetention = { ...(userData.retention_map || {}) };

    const now = new Date();
    const nextReview = new Date();
    nextReview.setDate(now.getDate() + (feedback.next_review_days || 7));

    if (feedback.scores) {
        Object.entries(feedback.scores).forEach(([skillId, val]) => {
            const currentScore = updatedMastery[skillId] || 0;
            const newScore = Number(val.score) || 0;
            updatedMastery[skillId] = currentScore === 0 ? newScore : Number(((currentScore * 0.3) + (newScore * 0.7)).toFixed(1));
            updatedRetention[skillId] = {
                last_practiced: now.toISOString(),
                next_review_date: nextReview.toISOString(),
                strength: 'fresh'
            };
        });
    }

    await updateDoc(userRef, {
        growth_memory: updatedMemory,
        skill_mastery: updatedMastery,
        retention_map: updatedRetention
    });

    return { ...userData, growth_memory: updatedMemory, skill_mastery: updatedMastery, retention_map: updatedRetention };
};

// --- App Feedback ---
export const saveAppFeedback = async (userId: string, email: string, content: string) => {
    await addDoc(collection(db, 'app_feedback'), {
        userId,
        userEmail: email,
        content,
        timestamp: new Date().toISOString()
    });
};

export const getAppFeedback = async (): Promise<AppFeedback[]> => {
    const q = query(collection(db, 'app_feedback'), orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AppFeedback));
};

// --- Auth ---
export const loginWithEmail = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const signupWithEmail = async (email, password) => {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(userCredential.user);
    return userCredential.user;
};

export const resendVerificationEmail = async () => {
    const user = auth.currentUser;
    if (user) {
        await sendEmailVerification(user);
    } else {
        throw new Error("No user is currently signed in.");
    }
};

export const loginWithGoogle = () => signInWithPopup(auth, new GoogleAuthProvider()).then(r => r.user);
export const logout = () => signOut(auth);
export const sendPasswordReset = (email: string) => sendPasswordResetEmail(auth, email);

// --- Data Fetching ---
export const getScenarios = () => getDocs(collection(db, 'scenarios')).then(snap => snap.docs.map(d => d.data() as Scenario));
export const getSkills = () => getDocs(collection(db, 'skills')).then(snap => snap.docs.map(d => d.data() as Skill));
export const getPracticeSessions = (uid: string) => getDocs(query(collection(db, 'practiceSessions'), where('userId', '==', uid))).then(snap => snap.docs.map(d => d.data() as PracticeSession));
export const getAllPracticeSessions = (l = 100) => getDocs(query(collection(db, 'practiceSessions'), orderBy('timestamp', 'desc'), limit(l))).then(snap => snap.docs.map(d => d.data() as PracticeSession));

// --- Data Modification ---
export const saveScenario = async (s: Partial<Scenario>) => {
    const id = s.id || `lsb-custom-${doc(collection(db, 'scenarios')).id}`;
    const scenario = { ...s, id } as Scenario;
    await setDoc(doc(db, 'scenarios', id), scenario, { merge: true });
    return scenario;
};
export const deleteScenario = (id: string) => deleteDoc(doc(db, 'scenarios', id));

export const savePracticeSession = async (s: Partial<PracticeSession>) => {
    const id = s.id || doc(collection(db, 'practiceSessions')).id;
    const session = { ...s, id, timestamp: new Date().toISOString() } as PracticeSession;
    await setDoc(doc(db, 'practiceSessions', id), session, { merge: true });
    return session;
};

export const updateSessionRating = async (sessionId: string, rating: number) => {
    await updateDoc(doc(db, 'practiceSessions', sessionId), { learner_rating: rating });
};

export const deletePracticeSession = (id: string) => deleteDoc(doc(db, 'practiceSessions', id));
