import React, { useEffect, useMemo, useState } from 'react';
import { Scenario } from '../types';
import { AdminUsageRecord, getAdminUsageRecords, getAllUsers, getSkillLibrary } from '../services/firebase';

const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-GB');
};
const activityDate = (record?: AdminUsageRecord) => record?.completedAt || record?.timestamp || '';

export const AdminUsage: React.FC<{ scenarios: Scenario[] }> = ({ scenarios }) => {
    const [data, setData] = useState<{
        records: AdminUsageRecord[];
        emails: Record<string, string>;
        microSkills: Record<string, string>;
    } | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [refresh, setRefresh] = useState(0);
    const [email, setEmail] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(false);
        Promise.all([getAdminUsageRecords(), getAllUsers(), getSkillLibrary()])
            .then(([records, users, library]) => {
                if (cancelled) return;
                const microSkills: Record<string, string> = {};
                library?.skill_groups.forEach(group => group.skills.forEach(skill =>
                    skill.micro_skills.forEach(ms => { microSkills[ms.id] = ms.label; })));
                setData({ records, emails: Object.fromEntries(users.map(user => [user.id, user.email])), microSkills });
            })
            .catch(() => { if (!cancelled) setError(true); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [refresh]);

    const invalidRange = !!from && !!to && from > to;
    const rows = useMemo(() => {
        if (!data || invalidRange) return [];
        const start = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
        const endDate = to ? new Date(`${to}T00:00:00`) : null;
        if (endDate) endDate.setDate(endDate.getDate() + 1);
        const end = endDate?.getTime() ?? Infinity;
        const groups = new Map<string, AdminUsageRecord[]>();
        Object.entries<string>(data.emails).forEach(([id, address]) => {
            if (address.toLowerCase().includes(email.trim().toLowerCase())) groups.set(id, []);
        });
        data.records.forEach(record => {
            const address = data.emails[record.userId] || `Unknown user (${record.userId})`;
            if (!address.toLowerCase().includes(email.trim().toLowerCase())) return;
            const time = new Date(activityDate(record)).getTime();
            if ((from || to) && !(time >= start && time < end)) return;
            if (!groups.has(record.userId)) groups.set(record.userId, []);
            groups.get(record.userId)!.push(record);
        });
        return [...groups].map(([id, records]) => {
            records.sort((a, b) => (Date.parse(activityDate(b)) || 0) - (Date.parse(activityDate(a)) || 0));
            return { id, email: data.emails[id] || `Unknown user (${id})`, records };
        }).sort((a, b) => (Date.parse(activityDate(b.records[0])) || 0)
            - (Date.parse(activityDate(a.records[0])) || 0)
            || a.email.localeCompare(b.email));
    }, [data, email, from, to, invalidRange]);
    const records = rows.flatMap(row => row.records);
    const scenarioNames = Object.fromEntries(scenarios.map(scenario => [scenario.id, scenario.title]));
    const fieldClass = 'w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-white';

    return (
        <section className="space-y-6" aria-label="Usage report">
            <div className="flex flex-wrap justify-between items-start gap-4">
                <div>
                    <h3 className="text-xl font-bold text-gray-900">Usage</h3>
                    <p className="text-sm text-gray-600 mt-2">Saved scenario sessions and micro-skill practices. Visits and discarded conversations are not included.</p>
                </div>
                <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)} className="px-4 py-2 rounded-xl bg-gray-900 text-white text-sm disabled:opacity-50">Refresh usage</button>
            </div>
            <div className="grid sm:grid-cols-3 gap-4">
                <label className="text-sm font-medium space-y-2"><span>Email contains</span><input type="search" value={email} onChange={event => setEmail(event.target.value)} className={fieldClass} /></label>
                <label className="text-sm font-medium space-y-2"><span>From</span><input type="date" value={from} onChange={event => setFrom(event.target.value)} className={fieldClass} /></label>
                <label className="text-sm font-medium space-y-2"><span>To</span><input type="date" value={to} onChange={event => setTo(event.target.value)} className={fieldClass} /></label>
            </div>
            <p className="text-xs text-gray-500">Leave dates blank for all saved activity. Dates use your local time and the recorded completion date where available, otherwise the session timestamp. Completion reflects saved status, including legacy records.</p>
            {invalidRange && <p role="alert" className="text-sm text-rose-700">The From date must be on or before the To date.</p>}
            {loading ? <p role="status">Loading usage…</p> : error ? (
                <p role="alert" className="text-sm text-rose-700">Usage could not be loaded. Please refresh to try again. Counts are unavailable until all records have loaded.</p>
            ) : !invalidRange && data && <>
                <div className="grid sm:grid-cols-3 gap-4">
                    {[
                        ['Users with saved activity', rows.filter(row => row.records.length).length],
                        ['Saved scenario sessions', records.filter(record => record.kind === 'scenario').length],
                        ['Saved micro-skill practices', records.filter(record => record.kind === 'micro-skill').length],
                    ].map(([label, count]) => <div key={label} className="rounded-2xl border border-gray-200 p-5 bg-white"><p className="text-sm text-gray-600">{label}</p><p className="text-3xl font-bold mt-2">{count}</p></div>)}
                </div>
                <p className="text-sm text-gray-600">{rows.length} matching accounts, including those with no saved activity in this period. Expand a user to see their activity.</p>
                {rows.map(row => <details key={row.id} className="rounded-2xl border border-gray-200 bg-white">
                    <summary className="cursor-pointer p-4 break-words">
                        <span className="font-semibold text-sm">{row.email}</span>
                        <span className="block text-sm text-gray-600 mt-2">
                            {row.records.filter(record => record.kind === 'scenario').length} scenario sessions · {row.records.filter(record => record.kind === 'micro-skill').length} micro-skill practices
                            {row.records.length > 0 ? ` · Latest in period: ${formatDate(activityDate(row.records[0]))}` : ' · No saved activity in this period'}
                        </span>
                    </summary>
                    {row.records.length > 0 && <div className="overflow-x-auto px-4 pb-4"><table className="w-full text-sm text-left">
                        <caption className="sr-only">Saved activity for {row.email}</caption>
                        <thead><tr>{['Activity', 'Recorded date', 'Medium', 'Saved status'].map(label => <th key={label} scope="col" className="p-3 border-b">{label}</th>)}</tr></thead>
                        <tbody>{row.records.map(record => <tr key={`${record.kind}-${record.id}`}>
                            <td className="p-3 border-b"><span className="block font-medium">{record.kind === 'scenario' ? scenarioNames[record.scenarioId] || record.scenarioId || 'Scenario unavailable' : data.microSkills[record.microSkillId!] || record.microSkillId || 'Micro-skill unavailable'}</span><span className="text-xs text-gray-500">{record.kind === 'scenario' ? 'Scenario' : `Micro-skill · ${scenarioNames[record.scenarioId] || record.scenarioId || 'Scenario unavailable'}`}</span></td>
                            <td className="p-3 border-b whitespace-nowrap">{formatDate(activityDate(record))}</td>
                            <td className="p-3 border-b">{record.medium === 'voice' ? 'Voice' : record.medium === 'text' ? 'Text' : 'Not recorded'}</td>
                            <td className="p-3 border-b">{record.completed ? 'Recorded as completed' : 'Completion not recorded'}</td>
                        </tr>)}</tbody>
                    </table></div>}
                </details>)}
            </>}
        </section>
    );
};
