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

// Knockout rounds in order, up to (but not including) the final. A team's
// `round` field is the furthest round it has already completed, so the
// number of wins still needed to reach champion is the count of stages
// after it in this list.
const KNOCKOUT_STAGE_ORDER = ['round_of_32', 'round_of_16', 'quarterfinal', 'semifinal'];

// A semifinal loser isn't eliminated immediately (see scrape-results.js) —
// it still has a third-place match to play, which caps its ceiling well
// below the champion track. Figure out which track a team on 'semifinal'
// is actually on by checking whether it won its semifinal.
function wonSemifinal(teamName, matches) {
    const key = normalizeTeamName(teamName);
    const match = (matches || []).find(m =>
        m.stage === 'semifinal' && m.played &&
        (normalizeTeamName(m.home) === key || normalizeTeamName(m.away) === key)
    );
    if (!match) return true; // semifinal not found (shouldn't happen) — assume best case

    const deciding = match.penalties
        ? [match.penalties.home, match.penalties.away]
        : [match.homeScore, match.awayScore];
    const teamIsHome = normalizeTeamName(match.home) === key;
    return teamIsHome ? deciding[0] > deciding[1] : deciding[1] > deciding[0];
}

// Best-case remaining points for a team: assumes it wins every match it has
// left to play. Requires the knockout bracket to be set (every alive team
// has a `round` reflecting real match results) to be meaningful.
export function calculateMaxPossiblePoints(teamData, teamName, matches) {
    if (!teamData) return 0;
    if (teamData.eliminated) return calculateTeamPoints(teamData);

    const basePts = (teamData.w || 0) * MATCH_POINTS.win + (teamData.d || 0) * MATCH_POINTS.draw;
    const round = teamData.round;

    if (round === 'semifinal' && !wonSemifinal(teamName, matches)) {
        // Third-place match only: bonus is awarded to both participants
        // regardless of the result, so the only thing still in play is the
        // single win.
        return basePts + MATCH_POINTS.win + ROUND_BONUS.third_place;
    }

    const idx = KNOCKOUT_STAGE_ORDER.indexOf(round);
    const remainingWins = idx === -1 ? KNOCKOUT_STAGE_ORDER.length : KNOCKOUT_STAGE_ORDER.length - idx;
    return basePts + remainingWins * MATCH_POINTS.win + ROUND_BONUS.champion;
}

export function calculateParticipantMaxScore(selectedTeams, normalizedLookup, matches) {
    return selectedTeams.reduce((total, name) => {
        const key = normalizeTeamName(name);
        const team = normalizedLookup[key];
        return total + calculateMaxPossiblePoints(team, name, matches);
    }, 0);
}
