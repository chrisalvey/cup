// Fixed Round-of-32 bracket draw for the 2026 World Cup knockout stage, in
// bracket order (not chronological order): consecutive pairs meet in Round
// of 16, winners of consecutive Round-of-16 pairs meet in the Quarterfinal,
// and so on up to the Final. This is standard single-elimination bracket
// numbering, verified against Wikipedia's knockout-stage bracket diagram
// (en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage) and cross-checked
// against already-played rounds in results.json. Team names match the
// canonical spellings used in teams.json / results.json.
//
// Unlike the Round of 32 pairings themselves (fixed at the draw), who plays
// whom from the Round of 16 onward isn't "scheduled" until both sides are
// actually determined — but the STRUCTURE (which bracket branch feeds which
// slot) is fixed from the start, which is what this lets us predict.
export const BRACKET_ROUND_OF_32_ORDER = [
    'Germany', 'Paraguay',
    'France', 'Sweden',
    'South Africa', 'Canada',
    'Netherlands', 'Morocco',
    'Portugal', 'Croatia',
    'Spain', 'Austria',
    'USA', 'Bosnia-Herzegovina',
    'Belgium', 'Senegal',
    'Brazil', 'Japan',
    'Ivory Coast', 'Norway',
    'Mexico', 'Ecuador',
    'England', 'Congo DR',
    'Argentina', 'Cape Verde',
    'Australia', 'Egypt',
    'Switzerland', 'Algeria',
    'Colombia', 'Ghana',
];

// Stage a team is playing in at a given "block size" depth: 2 teams share a
// Round of 32 match, 4 share a Round of 16 branch, 8 a Quarterfinal branch,
// 16 a Semifinal branch, all 32 the Final.
const MEETING_STAGES = [
    { blockSize: 2, stage: 'round_of_32' },
    { blockSize: 4, stage: 'round_of_16' },
    { blockSize: 8, stage: 'quarterfinal' },
    { blockSize: 16, stage: 'semifinal' },
    { blockSize: 32, stage: 'final' },
];

function normalize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SLOT_INDEX = new Map(BRACKET_ROUND_OF_32_ORDER.map((name, i) => [normalize(name), i]));

// Earliest round two teams would meet if both keep winning, based purely on
// the fixed bracket draw — independent of results, so it holds even before
// either team's actual next opponent has been determined. Returns null if
// either team isn't in the Round of 32 field (e.g. didn't qualify).
export function earliestMeetingStage(teamNameA, teamNameB) {
    const i = SLOT_INDEX.get(normalize(teamNameA));
    const j = SLOT_INDEX.get(normalize(teamNameB));
    if (i === undefined || j === undefined || i === j) return null;

    for (const { blockSize, stage } of MEETING_STAGES) {
        if (Math.floor(i / blockSize) === Math.floor(j / blockSize)) return stage;
    }
    return 'final';
}
