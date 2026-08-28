'use strict';

// 评测统计：解题日志聚合、双模型配对比较、样本回放评分。
(function exposeCaptchaStats(root, factory) {
    const api = factory();
    if (typeof module === 'object') module.exports = api;
    root.XynigoCaptchaStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStats() {

    function appendTrim(list, record, cap) {
        const next = Array.isArray(list) ? list.slice() : [];
        next.push(record);
        while (next.length > cap) next.shift();
        return next;
    }

    function average(values) {
        if (!values.length) return null;
        const sum = values.reduce((acc, value) => acc + value, 0);
        return Math.round((sum / values.length) * 10) / 10;
    }

    // 按模型聚合：attempts / pass / fail / error / passRate / avgLatencyMs。
    // role=primary 的记录计入真实解题结果；role=shadow 只有与主模型的答案一致性可看。
    function aggregateSolves(records) {
        const groups = new Map();
        (records || []).forEach((record) => {
            if (!record || record.role !== 'primary') return;
            const key = (record.provider || '?') + '/' + (record.model || '?');
            if (!groups.has(key)) {
                groups.set(key, { model: key, attempts: 0, pass: 0, fail: 0, error: 0, latencies: [] });
            }
            const group = groups.get(key);
            group.attempts += 1;
            if (record.outcome === 'pass') { group.pass += 1; group.latencies.push(record.latencyMs || 0); }
            else if (record.outcome === 'fail') group.fail += 1;
            else group.error += 1;
        });
        const rows = Array.from(groups.values()).map((group) => ({
            model: group.model,
            attempts: group.attempts,
            pass: group.pass,
            fail: group.fail,
            error: group.error,
            passRate: group.attempts ? Math.round((group.pass / group.attempts) * 1000) / 10 : null,
            avgLatencyMs: average(group.latencies),
        }));
        rows.sort((a, b) => b.attempts - a.attempts);
        return rows;
    }

    // 配对比较：同一 puzzleId 下 primary 与 shadow 答案一致率。
    // primary 的通过率 = 真实过验率；shadow 只有"与主模型一致率"可看。
    function pairCompare(records) {
        const byPuzzle = new Map();
        (records || []).forEach((record) => {
            if (!record || !record.puzzleId) return;
            if (!byPuzzle.has(record.puzzleId)) byPuzzle.set(record.puzzleId, {});
            byPuzzle.get(record.puzzleId)[record.role] = record;
        });
        let pairs = 0;
        let agree = 0;
        let primaryPass = 0;
        let primaryCount = 0;
        byPuzzle.forEach((roles) => {
            if (!roles.primary || !roles.shadow) return;
            pairs += 1;
            const a = JSON.stringify(roles.primary.answer || []);
            const b = JSON.stringify(roles.shadow.answer || []);
            if (a === b) agree += 1;
            primaryCount += 1;
            if (roles.primary.outcome === 'pass') primaryPass += 1;
        });
        return {
            pairs,
            agree,
            disagree: pairs - agree,
            agreeRate: pairs ? Math.round((agree / pairs) * 1000) / 10 : null,
            primaryPassRate: primaryCount ? Math.round((primaryPass / primaryCount) * 1000) / 10 : null,
        };
    }

    // 回放评测汇总：samples=[{sample, result:{answer, latencyMs, ok}}]。
    function scoreReplay(entries) {
        const rows = (entries || []).map((entry) => {
            const scored = entry.result && entry.result.ok
                ? scoreAnswerSafe(entry.result.answer, entry.sample.groundTruth)
                : { exact: false, precision: 0, recall: 0 };
            return {
                sampleId: entry.sample.id,
                groundTruth: entry.sample.groundTruth || [],
                answer: entry.result && entry.result.answer ? entry.result.answer : [],
                ok: Boolean(entry.result && entry.result.ok),
                error: entry.result && entry.result.error ? entry.result.error : '',
                latencyMs: entry.result ? entry.result.latencyMs || 0 : 0,
                exact: scored.exact,
                precision: scored.precision,
                recall: scored.recall,
            };
        });
        const n = rows.length;
        const exactCount = rows.filter((row) => row.exact).length;
        return {
            n,
            exactCount,
            exactRate: n ? Math.round((exactCount / n) * 1000) / 10 : null,
            avgPrecision: n ? Math.round((rows.reduce((acc, row) => acc + row.precision, 0) / n) * 1000) / 10 : null,
            avgRecall: n ? Math.round((rows.reduce((acc, row) => acc + row.recall, 0) / n) * 1000) / 10 : null,
            avgLatencyMs: average(rows.filter((row) => row.ok).map((row) => row.latencyMs)),
            rows,
        };
    }

    let scoreAnswerImpl = null;
    function scoreAnswerSafe(answer, groundTruth) {
        if (scoreAnswerImpl) return scoreAnswerImpl(answer, groundTruth);
        // 独立使用本模块时的兜底实现（与 puzzle.scoreAnswer 等价）。
        const pred = new Set((answer || []).map(Number));
        const truth = new Set((groundTruth || []).map(Number));
        let hit = 0;
        truth.forEach((n) => { if (pred.has(n)) hit += 1; });
        return {
            exact: pred.size === truth.size && hit === truth.size,
            precision: pred.size ? hit / pred.size : 0,
            recall: truth.size ? hit / truth.size : 0,
        };
    }
    // 允许宿主（popup/background）注入 puzzle.scoreAnswer，避免重复实现漂移。
    function setScoreAnswer(impl) { scoreAnswerImpl = impl; }

    return { appendTrim, aggregateSolves, pairCompare, scoreReplay, setScoreAnswer };
});
