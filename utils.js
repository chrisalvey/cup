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

// Best case for a team eliminated in a specific (not-yet-played) match: no
// more wins, but it still banks the bonus for the round that match is in
// (both sides get credit for reaching a round regardless of who wins it —
// see scrape-results.js), except the final, where the loser is runner-up
// rather than champion, and the semifinal, where the loser still has a
// third-place match left to potentially win.
function ceilingIfEliminatedAt(teamData, stage) {
    const basePts = (teamData.w || 0) * MATCH_POINTS.win + (teamData.d || 0) * MATCH_POINTS.draw;
    if (stage === 'final') return basePts + ROUND_BONUS.runner_up;
    if (stage === 'semifinal') return basePts + MATCH_POINTS.win + ROUND_BONUS.third_place;
    return basePts + (ROUND_BONUS[stage] || 0);
}

// Scheduled-but-unplayed matches where both sides are on the same roster —
// only one of the two can actually advance, so their independent ceilings
// can't both be banked. A knockout bracket means a team is in at most one
// unplayed match at a time, so these pairs are always disjoint.
export function findRosterCollisions(selectedTeams, matches) {
    const keySet = new Set(selectedTeams.map(normalizeTeamName));
    return (matches || []).filter(m => {
        if (m.played) return false;
        return keySet.has(normalizeTeamName(m.home || '')) && keySet.has(normalizeTeamName(m.away || ''));
    });
}

// The round bonus is banked for *reaching* a round, win or lose (see
// scrape-results.js) — so a team that has won its way to round R is
// guaranteed to bank at least the bonus for playing round R+1, even if it
// loses that match outright. A semifinal loss doesn't end a run (there's
// still a third-place match), so the guaranteed floor after a quarterfinal
// win skips straight to third-place rather than stopping at semifinal.
const WORST_CASE_BONUS_IF_WON = {
    round_of_32: ROUND_BONUS.round_of_16,
    round_of_16: ROUND_BONUS.quarterfinal,
    quarterfinal: ROUND_BONUS.third_place,
    semifinal: ROUND_BONUS.runner_up,
};

// Guaranteed minimum remaining points for a team: assumes it loses at the
// very first opportunity (after already-guaranteed round bonuses land).
export function calculateMinPossiblePoints(teamData, teamName, matches) {
    if (!teamData) return 0;
    if (teamData.eliminated) return calculateTeamPoints(teamData);

    const basePts = (teamData.w || 0) * MATCH_POINTS.win + (teamData.d || 0) * MATCH_POINTS.draw;
    const round = teamData.round;

    if (round === 'semifinal' && !wonSemifinal(teamName, matches)) {
        return basePts + ROUND_BONUS.third_place;
    }

    return basePts + (WORST_CASE_BONUS_IF_WON[round] ?? ROUND_BONUS.round_of_32);
}

// Same idea as calculateMinPossiblePoints, but for a team that is about to
// play (not already past) the match at `stage` and is assumed to win it —
// used when resolving roster collisions below, where teamData.round is
// still one stage stale until that specific match is actually played.
function minIfWinsMatch(teamData, stage) {
    const basePts = (teamData.w || 0) * MATCH_POINTS.win + (teamData.d || 0) * MATCH_POINTS.draw + MATCH_POINTS.win;
    return basePts + (WORST_CASE_BONUS_IF_WON[stage] ?? ROUND_BONUS.round_of_32);
}

// Guaranteed value for a team that loses the not-yet-played match at
// `stage` — deterministic except for a semifinal, where a loss doesn't
// eliminate the team (third-place match still ahead), so its own floor
// applies there instead of a single fixed number.
function floorIfEliminatedAt(teamData, stage) {
    const basePts = (teamData.w || 0) * MATCH_POINTS.win + (teamData.d || 0) * MATCH_POINTS.draw;
    if (stage === 'final') return basePts + ROUND_BONUS.runner_up;
    if (stage === 'semifinal') return basePts + ROUND_BONUS.third_place;
    return basePts + (ROUND_BONUS[stage] || 0);
}

export function calculateParticipantMinScore(selectedTeams, normalizedLookup, matches) {
    const collisions = findRosterCollisions(selectedTeams, matches);
    const resolvedKeys = new Set();
    let total = 0;

    collisions.forEach(m => {
        const homeKey = normalizeTeamName(m.home);
        const awayKey = normalizeTeamName(m.away);
        const homeTeam = normalizedLookup[homeKey];
        const awayTeam = normalizedLookup[awayKey];
        // Exactly one of the two wins — we don't get to pick which, so the
        // guaranteed combined floor is the smaller of the two possible
        // worlds, not the larger (that's the max-score calculation's job).
        const homeWins = minIfWinsMatch(homeTeam, m.stage) + floorIfEliminatedAt(awayTeam, m.stage);
        const awayWins = minIfWinsMatch(awayTeam, m.stage) + floorIfEliminatedAt(homeTeam, m.stage);
        total += Math.min(homeWins, awayWins);
        resolvedKeys.add(homeKey);
        resolvedKeys.add(awayKey);
    });

    selectedTeams.forEach(name => {
        const key = normalizeTeamName(name);
        if (resolvedKeys.has(key)) return;
        const team = normalizedLookup[key];
        total += calculateMinPossiblePoints(team, name, matches);
    });

    return total;
}

export function calculateParticipantMaxScore(selectedTeams, normalizedLookup, matches) {
    const collisions = findRosterCollisions(selectedTeams, matches);
    const resolvedKeys = new Set();
    let total = 0;

    collisions.forEach(m => {
        const homeKey = normalizeTeamName(m.home);
        const awayKey = normalizeTeamName(m.away);
        const homeTeam = normalizedLookup[homeKey];
        const awayTeam = normalizedLookup[awayKey];
        const homeWins = calculateMaxPossiblePoints(homeTeam, m.home, matches) + ceilingIfEliminatedAt(awayTeam, m.stage);
        const awayWins = calculateMaxPossiblePoints(awayTeam, m.away, matches) + ceilingIfEliminatedAt(homeTeam, m.stage);
        total += Math.max(homeWins, awayWins);
        resolvedKeys.add(homeKey);
        resolvedKeys.add(awayKey);
    });

    selectedTeams.forEach(name => {
        const key = normalizeTeamName(name);
        if (resolvedKeys.has(key)) return;
        const team = normalizedLookup[key];
        total += calculateMaxPossiblePoints(team, name, matches);
    });

    return total;
}

// Best (lowest-numbered) rank a participant could still finish at: assumes
// they hit their ceiling while everyone else hits their own guaranteed
// floor (minScore, not just their current score — a team with a scheduled
// next match is guaranteed to bank at least that round's bonus even if it
// loses, so current score alone understates what others are locked into).
// Ties broken the same way as the leaderboard sort — earlier submission wins.
export function calculateBestPossibleRank(target, allParticipants) {
    let ahead = 0;
    allParticipants.forEach(other => {
        if (other === target) return;
        const otherFloor = other.minScore ?? other.score;
        if (otherFloor > target.maxScore) { ahead++; return; }
        if (otherFloor === target.maxScore) {
            const otherTime = other.timestamp?.seconds || 0;
            const targetTime = target.timestamp?.seconds || 0;
            if (otherTime < targetTime) ahead++;
        }
    });
    return ahead + 1;
}
