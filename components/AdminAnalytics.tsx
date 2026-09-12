
import React, { useMemo, useState, useEffect } from 'react';
import { User, PracticeSession, Scenario, Skill, FeedbackAnalysis, AppFeedback, SkillLibrary, SkillGroup, MicroSkill } from '../types';
import {
    saveScenario,
    deleteScenario,
    getGlobalFacilitatorContract,
    getGlobalAssessorProtocol,
    getMicroSkillTutorInstruction,
    saveGlobalFacilitatorContract,
    saveGlobalAssessorProtocol,
    saveMicroSkillTutorInstruction,
    getAppFeedback,
    getSkillLibrary,
    saveSkillLibrary
} from '../services/firebase';
import { ScenarioForm } from './ScenarioForm';
import { INITIAL_SKILLS } from '../constants';
import { AdminUsage } from './AdminUsage';

interface AdminAnalyticsProps {
    users: User[];
    sessions: PracticeSession[];
    scenarios: Scenario[];
    skills: Skill[];
    onRefresh: () => void;
}

export const AdminAnalytics: React.FC<AdminAnalyticsProps> = ({ users, sessions, scenarios, skills, onRefresh }) => {
    const [activeTab, setActiveTab] = useState<'analytics' | 'usage' | 'scenarios' | 'global' | 'users' | 'feedback' | 'library'>('analytics');
    const [editingScenario, setEditingScenario] = useState<Partial<Scenario> | null>(null);

    const [globalFacilitator, setGlobalFacilitator] = useState("");
    const [globalAssessor, setGlobalAssessor] = useState("");
    const [microSkillTutor, setMicroSkillTutor] = useState("");
    const [isSavingGlobal, setIsSavingGlobal] = useState(false);
    const [isLoadingGlobal, setIsLoadingGlobal] = useState(false);
    const [feedbackList, setFeedbackList] = useState<AppFeedback[]>([]);
    const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);

    const [library, setLibrary] = useState<SkillLibrary | null>(null);
    const [editingMicroSkill, setEditingMicroSkill] = useState<{ groupId: string, skillId: string, ms: MicroSkill } | null>(null);

    useEffect(() => {
        if (activeTab === 'global') {
            setIsLoadingGlobal(true);
            Promise.all([
                getGlobalFacilitatorContract(),
                getGlobalAssessorProtocol(),
                getMicroSkillTutorInstruction()
            ]).then(([fac, ass, tut]) => {
                setGlobalFacilitator(fac);
                setGlobalAssessor(ass);
                setMicroSkillTutor(tut);
            }).finally(() => {
                setIsLoadingGlobal(false);
            });
        } else if (activeTab === 'feedback') {
            setIsLoadingFeedback(true);
            getAppFeedback().then(res => {
                setFeedbackList(res);
                setIsLoadingFeedback(false);
            });
        } else if (activeTab === 'library') {
            getSkillLibrary().then(setLibrary);
        }
    }, [activeTab]);

    const handleSaveGlobal = async () => {
        setIsSavingGlobal(true);
        try {
            await Promise.all([
                saveGlobalFacilitatorContract(globalFacilitator),
                saveGlobalAssessorProtocol(globalAssessor),
                saveMicroSkillTutorInstruction(microSkillTutor)
            ]);
            alert("Global Logic Synchronized Successfully.");
        } catch (e) {
            alert("Sync failed: " + (e as Error).message);
        } finally {
            setIsSavingGlobal(false);
        }
    };

    const handleSaveLibrary = async (updatedLib: SkillLibrary) => {
        setLibrary(updatedLib);
        await saveSkillLibrary(updatedLib);
    };

    const handleUpdateMicroSkill = () => {
        if (!editingMicroSkill || !library) return;
        const newLib = { ...library };
        const group = newLib.skill_groups.find(g => g.id === editingMicroSkill.groupId);
        const skill = group?.skills.find(s => s.id === editingMicroSkill.skillId);
        if (skill) {
            skill.micro_skills = skill.micro_skills.map(m => m.id === editingMicroSkill.ms.id ? editingMicroSkill.ms : m);
            handleSaveLibrary(newLib);
            setEditingMicroSkill(null);
        }
    };

    const stats = useMemo(() => {
        const completed = sessions.filter(s => s.status === 'completed');
        const scoreMap: Record<string, { total: number, count: number }> = {};

        completed.forEach(s => {
            if (!s.feedback) return;
            try {
                const fb: FeedbackAnalysis = JSON.parse(s.feedback);
                if (!fb.scores) return;
                Object.entries(fb.scores).forEach(([skillId, scoreObj]) => {
                    if (!scoreMap[skillId]) scoreMap[skillId] = { total: 0, count: 0 };
                    scoreMap[skillId].total += scoreObj.score;
                    scoreMap[skillId].count += 1;
                });
            } catch (e) { }
        });

        const averageMastery = skills.map(skill => {
            const data = scoreMap[skill.id] || { total: 0, count: 0 };
            return {
                name: skill.name,
                score: data.count > 0 ? (data.total / data.count).toFixed(1) : '0.0'
            };
        });

        return {
            totalLearners: users.length,
            totalSessions: sessions.length,
            avgMastery: averageMastery,
            activeUsers: users.filter(u => Object.keys(u.skill_mastery || {}).length > 0).length
        };
    }, [users, sessions, skills]);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 border-b border-gray-100 pb-6">
                <nav className="flex space-x-1 bg-gray-100 p-1 rounded-2xl border border-gray-200 overflow-x-auto max-w-full">
                    {['analytics', 'usage', 'scenarios', 'library', 'global', 'users', 'feedback'].map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab as any)}
                            className={`px-4 md:px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === tab ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            {tab.replace('_', ' ')}
                        </button>
                    ))}
                </nav>
            </div>

            {activeTab === 'usage' && <AdminUsage scenarios={scenarios} />}

            {activeTab === 'library' && library && (
                <div className="bg-white rounded-[3rem] p-10 border border-gray-100 shadow-sm animate-in fade-in duration-500 space-y-12">
                    <div className="flex justify-between items-center">
                        <h3 className="text-xl font-black tracking-tight">Master Skill Library</h3>
                        <p className="text-[10px] font-black uppercase text-gray-400">Verbatim Schema Management</p>
                    </div>

                    <div className="space-y-10">
                        {library.skill_groups.map(group => (
                            <div key={group.id} className="space-y-6">
                                <div className="flex items-center gap-4">
                                    <h4 className="text-lg font-black text-indigo-600 uppercase tracking-widest">{group.label}</h4>
                                    <div className="h-px flex-grow bg-gray-100"></div>
                                </div>

                                <div className="grid grid-cols-1 gap-8">
                                    {group.skills.map(skill => (
                                        <div key={skill.id} className="bg-gray-50 rounded-3xl p-8 space-y-6 border border-gray-100">
                                            <h5 className="font-black text-gray-900 tracking-tight">{skill.name}</h5>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                {skill.micro_skills.map(ms => (
                                                    <div key={ms.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm group hover:border-black transition-all">
                                                        <div className="flex justify-between items-start mb-4">
                                                            <span className="text-[9px] font-black text-gray-400 uppercase font-mono">{ms.id}</span>
                                                            <button
                                                                onClick={() => setEditingMicroSkill({ groupId: group.id, skillId: skill.id, ms: { ...ms } })}
                                                                className="text-[10px] font-black uppercase text-indigo-500 hover:text-indigo-700"
                                                            >
                                                                Edit Scaffold
                                                            </button>
                                                        </div>
                                                        <p className="text-xs font-bold text-gray-900 mb-3 leading-relaxed">{ms.label}</p>
                                                        <div className="space-y-2 pt-3 border-t border-gray-50">
                                                            <p className="text-[9px] font-black uppercase text-gray-400">Success Cue: <span className="text-indigo-600">"{ms.cue}"</span></p>
                                                            <p className="text-[9px] font-black uppercase text-gray-400">Common Trap: <span className="text-rose-500">"{ms.trap}"</span></p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    {editingMicroSkill && (
                        <div className="fixed inset-0 bg-black/50 backdrop-blur-md z-[100] flex items-center justify-center p-6">
                            <div className="bg-white rounded-[3rem] p-10 max-w-2xl w-full shadow-2xl border border-gray-100 space-y-8 animate-in zoom-in-95 duration-300">
                                <div>
                                    <h3 className="text-xl font-black tracking-tight">Edit Micro-Skill</h3>
                                    <p className="text-gray-400 text-xs font-medium uppercase tracking-widest mt-1">Institutional Scaffolding</p>
                                </div>

                                <div className="space-y-6">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-gray-400">Label (The Target Behavior)</label>
                                        <textarea
                                            value={editingMicroSkill.ms.label}
                                            onChange={(e) => setEditingMicroSkill({ ...editingMicroSkill, ms: { ...editingMicroSkill.ms, label: e.target.value } })}
                                            className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 focus:ring-4 focus:ring-black/5 outline-none transition-all text-sm font-bold"
                                            rows={2}
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-gray-400">Success Cue</label>
                                            <input
                                                value={editingMicroSkill.ms.cue}
                                                onChange={(e) => setEditingMicroSkill({ ...editingMicroSkill, ms: { ...editingMicroSkill.ms, cue: e.target.value } })}
                                                className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 focus:ring-4 focus:ring-black/5 outline-none transition-all text-sm font-black text-indigo-600"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase text-gray-400">Common Trap</label>
                                            <input
                                                value={editingMicroSkill.ms.trap}
                                                onChange={(e) => setEditingMicroSkill({ ...editingMicroSkill, ms: { ...editingMicroSkill.ms, trap: e.target.value } })}
                                                className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 focus:ring-4 focus:ring-black/5 outline-none transition-all text-sm font-black text-rose-500"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black uppercase text-gray-400">Success Criteria (One per line)</label>
                                        <textarea
                                            value={editingMicroSkill.ms.criteria?.join('\n')}
                                            onChange={(e) => setEditingMicroSkill({ ...editingMicroSkill, ms: { ...editingMicroSkill.ms, criteria: e.target.value.split('\n') } })}
                                            className="w-full p-4 bg-gray-50 rounded-2xl border border-gray-100 focus:ring-4 focus:ring-black/5 outline-none transition-all text-sm font-medium"
                                            rows={3}
                                        />
                                    </div>
                                </div>

                                <div className="flex justify-end gap-3 pt-6 border-t border-gray-50">
                                    <button onClick={() => setEditingMicroSkill(null)} className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-gray-400 hover:text-black">Cancel</button>
                                    <button onClick={handleUpdateMicroSkill} className="px-8 py-3 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-800 shadow-xl transition-all">Save Changes</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'global' && (
                <div className="space-y-8 animate-in fade-in duration-500">
                    <div className="bg-white rounded-[3rem] p-10 border border-gray-100 shadow-sm space-y-8">
                        <div className="flex justify-between items-end border-b border-gray-50 pb-8">
                            <div>
                                <h3 className="text-xl font-black tracking-tight">Global Assessment Logic</h3>
                                <p className="text-gray-400 text-xs font-medium mt-1 uppercase tracking-widest">The "Operating System" for all interactions.</p>
                            </div>
                            <button
                                onClick={handleSaveGlobal}
                                disabled={isSavingGlobal || isLoadingGlobal}
                                className="bg-black text-white px-8 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-800 disabled:opacity-50 transition-all shadow-xl"
                            >
                                {isSavingGlobal ? 'Synchronizing...' : 'Save & Deploy Logic'}
                            </button>
                        </div>

                        {isLoadingGlobal ? (
                            <div className="py-24 flex flex-col items-center justify-center gap-4">
                                <div className="w-8 h-8 border-4 border-gray-100 border-t-black rounded-full animate-spin"></div>
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Fetching logic layers...</p>
                            </div>
                        ) : (
                            <div className="space-y-12">
                                <div className="space-y-4">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-500">Layer 1: Global Facilitator</label>
                                    <p className="text-xs text-gray-500 italic leading-relaxed">Defines the Assessor persona and general interaction flow for diagnostic labs.</p>
                                    <textarea
                                        value={globalFacilitator}
                                        onChange={(e) => setGlobalFacilitator(e.target.value)}
                                        className="w-full h-[32rem] p-6 bg-gray-50 border border-gray-100 rounded-3xl font-mono text-sm leading-relaxed focus:ring-4 focus:ring-indigo-500/5 focus:border-indigo-500 outline-none transition-all"
                                        placeholder="Enter global AI instructions..."
                                    />
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">Layer 1: Global Assessor</label>
                                    <p className="text-xs text-gray-500 italic leading-relaxed">The shared rubric and JSON schema for behavioral assessment.</p>
                                    <textarea
                                        value={globalAssessor}
                                        onChange={(e) => setGlobalAssessor(e.target.value)}
                                        className="w-full h-[32rem] p-6 bg-gray-50 border border-gray-100 rounded-3xl font-mono text-sm leading-relaxed focus:ring-4 focus:ring-emerald-500/5 focus:border-emerald-500 outline-none transition-all"
                                        placeholder="Enter global assessment protocol..."
                                    />
                                </div>

                                <div className="space-y-4">
                                    <label className="text-[10px] font-black uppercase tracking-[0.2em] text-purple-500">Layer 1: Micro-Skill Tutor</label>
                                    <p className="text-xs text-gray-500 italic leading-relaxed">The logic for micro-skill tutorial practice loops.</p>
                                    <textarea
                                        value={microSkillTutor}
                                        onChange={(e) => setMicroSkillTutor(e.target.value)}
                                        className="w-full h-[32rem] p-6 bg-gray-50 border border-gray-100 rounded-3xl font-mono text-sm leading-relaxed focus:ring-4 focus:ring-purple-500/5 focus:border-purple-500 outline-none transition-all"
                                        placeholder="Enter tutor instructions..."
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'analytics' && (
                <div className="space-y-12 animate-in fade-in duration-500">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Total Learners</p>
                            <p className="text-4xl font-black text-gray-900">{stats.totalLearners}</p>
                        </div>
                        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Active Profiles</p>
                            <p className="text-4xl font-black text-gray-900">{stats.activeUsers}</p>
                        </div>
                        <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Total Sessions</p>
                            <p className="text-4xl font-black text-gray-900">{stats.totalSessions}</p>
                        </div>
                        <div className="bg-black p-8 rounded-3xl shadow-xl text-white">
                            <p className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1">Active Reminders</p>
                            <p className="text-4xl font-black">{users.length > 0 ? Math.round((users.filter(u => u.reminders_enabled).length / users.length) * 100) : 0}%</p>
                        </div>
                    </div>
                    {/* Heatmap Section */}
                    <div className="bg-gray-50 rounded-[3rem] p-10 border border-gray-200/50">
                        <h3 className="text-xl font-black tracking-tight mb-8">Cohort Capability <span className="text-gray-400">Heatmap</span></h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
                            {stats.avgMastery.map(skill => (
                                <div key={skill.name} className="space-y-3 p-6 bg-white rounded-2xl border border-gray-100">
                                    <span className="text-[10px] font-bold uppercase text-gray-400 block">{skill.name}</span>
                                    <div className="flex items-end gap-1">
                                        <span className="text-2xl font-black">{skill.score}</span>
                                        <span className="text-[10px] font-black text-gray-300 mb-1">/ 5.0</span>
                                    </div>
                                    <div className="h-1 w-full bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-black rounded-full transition-all duration-1000"
                                            style={{ width: `${(parseFloat(skill.score) / 5) * 100}%` }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'scenarios' && (
                <div className="bg-white rounded-[3rem] p-10 border border-gray-100 shadow-sm animate-in fade-in duration-500">
                    <div className="flex justify-between items-center mb-10">
                        <h3 className="text-xl font-black tracking-tight">Skill Catalog</h3>
                        <button
                            onClick={() => setEditingScenario({})}
                            className="px-6 py-3 bg-black text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-800 transition-all active:scale-[0.98]"
                        >
                            + Create Lab
                        </button>
                    </div>
                    <div className="grid grid-cols-1 gap-4">
                        {scenarios.map(scenario => (
                            <div key={scenario.id} className="flex items-center justify-between p-6 border border-gray-50 rounded-2xl hover:border-gray-200 transition-all">
                                <div className="flex flex-col">
                                    <span className="text-sm font-bold text-gray-900">{scenario.title}</span>
                                    <span className="text-[10px] text-gray-400 font-mono">{scenario.id}</span>
                                </div>
                                <div className="flex gap-4">
                                    <button onClick={() => setEditingScenario(scenario)} className="text-[10px] font-black uppercase text-indigo-500">Edit</button>
                                    <button onClick={() => deleteScenario(scenario.id).then(onRefresh)} className="text-[10px] font-black uppercase text-rose-500">Delete</button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'users' && (
                <div className="bg-white rounded-[3rem] p-10 border border-gray-100 shadow-sm animate-in fade-in duration-500">
                    <h3 className="text-xl font-black tracking-tight mb-8">Learner Directory</h3>
                    <div className="divide-y divide-gray-50">
                        {users.map(user => (
                            <div key={user.id} className="py-6 flex justify-between items-center">
                                <span className="text-sm font-bold text-gray-900">{user.email}</span>
                                <div className="flex gap-1">
                                    {INITIAL_SKILLS.map((s, i) => (
                                        <div key={i} className="w-2 h-6 bg-gray-100 rounded-full relative overflow-hidden" title={s.name}>
                                            <div className="absolute bottom-0 w-full bg-indigo-500" style={{ height: `${((user.skill_mastery?.[s.id] || 0) / 5) * 100}%` }}></div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'feedback' && (
                <div className="bg-white rounded-[3rem] p-10 border border-gray-100 shadow-sm animate-in fade-in duration-500">
                    <h3 className="text-xl font-black tracking-tight mb-8">User Experience Feedback</h3>
                    {isLoadingFeedback ? (
                        <p className="text-sm text-gray-400">Loading feedback data...</p>
                    ) : feedbackList.length === 0 ? (
                        <p className="text-sm text-gray-400">No feedback submitted yet.</p>
                    ) : (
                        <div className="space-y-6">
                            {feedbackList.map((f) => (
                                <div key={f.id} className="p-6 bg-gray-50 rounded-2xl border border-gray-100">
                                    <div className="flex justify-between items-baseline mb-3">
                                        <span className="text-xs font-black text-gray-900">{f.userEmail}</span>
                                        <span className="text-[10px] text-gray-400 font-mono">{new Date(f.timestamp).toLocaleString()}</span>
                                    </div>
                                    <p className="text-sm text-gray-700 leading-relaxed font-medium">"{f.content}"</p>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {editingScenario && (
                <ScenarioForm
                    scenario={editingScenario}
                    skills={skills}
                    onSave={async (s) => { await saveScenario(s); setEditingScenario(null); onRefresh(); }}
                    onCancel={() => setEditingScenario(null)}
                />
            )}
        </div>
    );
};
