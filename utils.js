import { MATCH_POINTS, ROUND_BONUS } from './config.js';

export function normalizeTeamName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function createNormalizedLookup(teamsObj) {
    const lookup = {};
    Object.keys(teamsObj).forEach(name => {
        lookup[normalizeTeamName(name)] = { name, ...teamsObj[name] };
    });
    return lookup;
}

export function calculateTeamPoints(teamData) {
    if (!teamData) return 0;
    const matchPts = (teamData.w || 0) * MATCH_POINTS.win +
                     (teamData.d || 0) * MATCH_POINTS.draw;
    const bonusPts = ROUND_BONUS[teamData.round] || 0;
    return matchPts + bonusPts;
}

export function calculateParticipantScore(selectedTeams, normalizedLookup) {
    let total = 0;
    const breakdown = {};
    selectedTeams.forEach(name => {
        const key = normalizeTeamName(name);
        const team = normalizedLookup[key];
        const pts = team ? calculateTeamPoints(team) : 0;
        breakdown[name] = pts;
        total += pts;
    });
    return { total, breakdown };
}
