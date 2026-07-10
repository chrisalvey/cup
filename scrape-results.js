// World Cup 2026 results scraper
// Fetches match data from Wikipedia and updates results.json

const fs = require('fs');
const https = require('https');
const cheerio = require('cheerio');

const GROUP_STAGE_URL = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup';
const KNOCKOUT_URL    = 'https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage';

// Wikipedia name → canonical name used in teams.json
const TEAM_NAME_MAP = {
    'United States':        'USA',
    'United States of America': 'USA',
    'Türkiye':              'Turkey',
    'Turkey':               'Turkey',
    'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
    'Bosnia & Herzegovina': 'Bosnia-Herzegovina',
    "Côte d'Ivoire":        'Ivory Coast',
    "Cote d'Ivoire":        'Ivory Coast',
    'DR Congo':             'Congo DR',
    'Democratic Republic of the Congo': 'Congo DR',
    'Republic of Korea':    'South Korea',
    'Korea Republic':       'South Korea',
    'Czech Republic':       'Czechia',
    'Curaçao':              'Curacao',
};

// Build team → group lookup from teams.json
const TEAM_GROUP = {};
try {
    const teams = JSON.parse(fs.readFileSync('teams.json', 'utf-8'));
    teams.forEach(t => { TEAM_GROUP[t.name] = t.group; });
} catch { /* ignore if file missing */ }

function normalizeTeam(name) {
    if (!name) return name;
    name = name.trim().replace(/\[\w+\]/g, '').trim();
    return TEAM_NAME_MAP[name] || name;
}

function groupForTeam(name) {
    return TEAM_GROUP[name] || null;
}

// Wikipedia's football-box markup renders the date/venue as siblings of the
// score table (both children of the wrapping .footballbox div), not as
// descendants of the table itself — so they have to be looked up via the
// table's parent rather than $t.find(). The visible .fdate text is a
// human date like "June 28, 2026"; the machine-readable ISO date lives in
// a hidden nested span (class "bday"/"dtstart").
function extractDateVenue($, $table) {
    const box = $table.parent();
    const date = box.find('.fdate .bday, .fdate .dtstart').first().text().trim();
    const venue = box.find('.fright [itemprop="location"], .fground').first().text().trim();
    return { date, venue };
}

function fetchHTML(url) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'WorldCup-Fantasy-Bot/1.0 (https://github.com/chrisalvey/cup; chrisalvey@users.noreply.github.com) Node.js'
            }
        };
        https.get(url, options, res => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchHTML(res.headers.location).then(resolve).catch(reject);
            }
            // Buffer raw bytes and decode once at the end — concatenating
            // chunk.toString() per chunk (implicit utf8 decode) corrupts any
            // multi-byte character that happens to straddle a chunk boundary.
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        }).on('error', reject);
    });
}

function parseGroupStage(html) {
    const $ = cheerio.load(html);
    const matches = [];
    const teamStats = {};

    function ensureTeam(name) {
        if (!teamStats[name]) teamStats[name] = { w: 0, d: 0, l: 0, gf: 0, ga: 0, eliminated: false };
    }

    // The main tournament page also includes a knockout-stage summary further
    // down, using the same table markup as the group stage. Track section
    // headings in document order so only matches actually under a "Group X"
    // heading get counted here (mirrors the approach in parseKnockoutStage).
    let inGroupStage = false;
    const content = $('#mw-content-text .mw-parser-output').first();
    const root = content.length ? content : $.root();

    root.find('h2, h3, table.footballbox, table.vevent, table.fevent, table.col1right').each((_, el) => {
        const $el = $(el);
        const tag = el.tagName ? el.tagName.toLowerCase() : '';

        if (tag === 'h2' || tag === 'h3') {
            const headingText = ($el.find('.mw-headline').first().text() || $el.text()).trim();
            inGroupStage = /^Group\s+\w/i.test(headingText);
            return;
        }

        if (!inGroupStage) return;

        const $t = $el;

        // Once a group's individual match report boxes have aged out, Wikipedia
        // condenses them into a single compact results-grid table per group: a
        // lone-<td> row holds the date heading for the fixtures that follow, and
        // each match is a 4-<td> row (home, "score" link, away, venue). This has
        // to be handled as a whole table rather than "one table = one match".
        if ($t.is('table.col1right')) {
            let currentDate = null;
            $t.find('tr').each((_, tr) => {
                const tds = $(tr).find('td');
                if (tds.length === 1) {
                    // Force UTC parsing so the resulting ISO date doesn't shift
                    // depending on the machine's local timezone (Wikipedia gives
                    // only a plain "June 11, 2026" string here, no machine-readable
                    // date, unlike the old .bday-based format).
                    const parsed = new Date(`${$(tds[0]).text().trim()} UTC`);
                    currentDate = isNaN(parsed.getTime()) ? null : parsed.toISOString();
                    return;
                }
                if (tds.length < 4) return;

                const home = normalizeTeam($(tds[0]).text().trim());
                const away = normalizeTeam($(tds[2]).text().trim());
                const scoreText = $(tds[1]).text().trim();
                const venue = $(tds[3]).text().trim();
                if (!home || !away) return;

                const homeGroupCheck = groupForTeam(home);
                const awayGroupCheck = groupForTeam(away);
                if (homeGroupCheck && awayGroupCheck && homeGroupCheck !== awayGroupCheck) return;

                const group = homeGroupCheck || awayGroupCheck || null;
                const scoreParts = scoreText.match(/(\d+)\s*[–\-:]\s*(\d+)/);

                if (!scoreParts) {
                    if (!currentDate) return;
                    matches.push({
                        home, away, homeScore: null, awayScore: null,
                        stage: 'group', group, date: currentDate, venue, played: false
                    });
                    return;
                }

                const homeScore = parseInt(scoreParts[1]);
                const awayScore = parseInt(scoreParts[2]);

                matches.push({
                    home, away, homeScore, awayScore,
                    stage: 'group', group, date: currentDate, venue, played: true
                });

                ensureTeam(home);
                ensureTeam(away);
                if (homeScore > awayScore) {
                    teamStats[home].w++; teamStats[away].l++;
                } else if (homeScore < awayScore) {
                    teamStats[away].w++; teamStats[home].l++;
                } else {
                    teamStats[home].d++; teamStats[away].d++;
                }
                teamStats[home].gf += homeScore; teamStats[home].ga += awayScore;
                teamStats[away].gf += awayScore; teamStats[away].ga += homeScore;
            });
            return;
        }

        const homeEl = $t.find('.fhome, [itemprop="homeTeam"] span, .home').first();
        const awayEl = $t.find('.faway, [itemprop="awayTeam"] span, .away').first();
        const scoreEl = $t.find('.fscore, [itemprop="name"].score, .score').first();

        let home = normalizeTeam(homeEl.text().trim());
        let away = normalizeTeam(awayEl.text().trim());
        const scoreText = scoreEl.text().trim();

        if (!home || !away) return;

        // Safety net: a genuine group match is always between two teams in
        // the same group. Skip anything that slips through mislabeled.
        const homeGroupCheck = groupForTeam(home);
        const awayGroupCheck = groupForTeam(away);
        if (homeGroupCheck && awayGroupCheck && homeGroupCheck !== awayGroupCheck) return;

        const scoreParts = scoreText.match(/(\d+)\s*[–\-:]\s*(\d+)/);
        const played = !!scoreParts;

        const { date, venue } = extractDateVenue($, $t);

        // A match with no score yet and no date is a TBD fixture we can't do
        // anything useful with — skip it rather than record a dateless entry.
        if (!played && !date) return;

        const group = homeGroupCheck || awayGroupCheck || null;

        if (!played) {
            matches.push({
                home, away, homeScore: null, awayScore: null,
                stage: 'group',
                group,
                date,
                venue,
                played: false
            });
            return;
        }

        const homeScore = parseInt(scoreParts[1]);
        const awayScore = parseInt(scoreParts[2]);

        matches.push({
            home, away, homeScore, awayScore,
            stage: 'group',
            group,
            date,
            venue,
            played: true
        });

        ensureTeam(home);
        ensureTeam(away);

        if (homeScore > awayScore) {
            teamStats[home].w++; teamStats[away].l++;
        } else if (homeScore < awayScore) {
            teamStats[away].w++; teamStats[home].l++;
        } else {
            teamStats[home].d++; teamStats[away].d++;
        }
        teamStats[home].gf += homeScore; teamStats[home].ga += awayScore;
        teamStats[away].gf += awayScore; teamStats[away].ga += homeScore;
    });

    return { matches, teamStats };
}

function parseKnockoutStage(html, teamStats) {
    const $ = cheerio.load(html);
    const matches = [];

    // Map knockout table headings to round keys. Matched case-insensitively
    // against the heading with hyphens stripped, since Wikipedia's actual
    // headings are one word ("Quarterfinals", "Semifinals") rather than the
    // hyphenated form, and "Match for third place" uses lowercase "third".
    // Order matters: more specific keys must come before 'final', since
    // "semifinal"/"quarterfinal" both contain "final" as a substring.
    const stageMap = {
        'round of 32':  'round_of_32',
        'round of 16':  'round_of_16',
        'quarterfinal': 'quarterfinal',
        'semifinal':    'semifinal',
        'third place':  'third_place',
        'final':        'final',
    };

    // Track which teams have reached each round
    const roundReached = {};

    // Walk the article in document order, tracking the most recent section
    // heading, so each match table is attributed to the round it actually
    // falls under (headings may be wrapped in a div, e.g. div.mw-heading,
    // so they won't necessarily be a direct previous sibling of the table).
    let stage = 'knockout';
    let stageLabel = 'Knockout Stage';
    const content = $('#mw-content-text .mw-parser-output').first();
    const root = content.length ? content : $.root();

    root.find('h2, h3, table.footballbox, table.vevent, table.fevent').each((_, el) => {
        const $el = $(el);
        const tag = el.tagName ? el.tagName.toLowerCase() : '';

        if (tag === 'h2' || tag === 'h3') {
            const headingText = ($el.find('.mw-headline').first().text() || $el.text()).trim();
            const normalizedHeading = headingText.toLowerCase().replace(/-/g, '');
            const matched = Object.entries(stageMap).find(([key]) => normalizedHeading.includes(key));
            if (matched) {
                stage = matched[1];
                stageLabel = headingText;
            } else if (tag === 'h2') {
                // A genuine new h2 section that isn't a recognized round name
                // (e.g. "Bracket"). Reset to generic — but an h3 sub-heading
                // that doesn't match a round (e.g. a per-match "Team A vs
                // Team B" label within a round's section) shouldn't clobber
                // the round we're already tracking.
                stage = 'knockout';
                stageLabel = headingText || 'Knockout Stage';
            }
            return;
        }

        const $t = $el;
        const homeEl = $t.find('.fhome, [itemprop="homeTeam"] span, .home').first();
        const awayEl = $t.find('.faway, [itemprop="awayTeam"] span, .away').first();
        const scoreEl = $t.find('.fscore, .score').first();

        let home = normalizeTeam(homeEl.text().trim());
        let away = normalizeTeam(awayEl.text().trim());
        const scoreText = scoreEl.text().trim();
        if (!home || !away) return;

        const scoreParts = scoreText.match(/(\d+)\s*[–\-:]\s*(\d+)/);
        const played = !!scoreParts;

        if (played) {
            const homeScore = parseInt(scoreParts[1]);
            const awayScore = parseInt(scoreParts[2]);

            // Knockout matches level after extra time go to a penalty shootout.
            // Wikipedia renders this as a "Penalties" marker row followed by a
            // second .fgoals row whose middle <th> (no class) holds the
            // shootout score, e.g. "3–4" — separate from the .fscore cell
            // above, which only ever shows the 90/120-minute score.
            let penalties = null;
            const hasPenaltiesMarker = $t.find('th').filter((_, th) => $(th).text().trim() === 'Penalties').length > 0;
            if (hasPenaltiesMarker) {
                const penTh = $t.find('tr.fgoals th').filter((_, th) => /^\d+\s*[–\-]\s*\d+$/.test($(th).text().trim()));
                if (penTh.length) {
                    const penMatch = penTh.first().text().trim().match(/(\d+)\s*[–\-]\s*(\d+)/);
                    if (penMatch) penalties = { home: parseInt(penMatch[1]), away: parseInt(penMatch[2]) };
                }
            }

            // Result for w/d/l purposes: the shootout decides the winner when
            // present, otherwise the regulation/extra-time score.
            const decidingHome = penalties ? penalties.home : homeScore;
            const decidingAway = penalties ? penalties.away : awayScore;

            // Both teams reached this round
            [home, away].forEach(t => {
                if (!teamStats[t]) teamStats[t] = { w: 0, d: 0, l: 0, gf: 0, ga: 0, eliminated: false };
                roundReached[t] = stage;
            });

            let loser = null;
            if (decidingHome > decidingAway) {
                teamStats[home].w++; teamStats[away].l++;
                loser = away;
            } else if (decidingHome < decidingAway) {
                teamStats[away].w++; teamStats[home].l++;
                loser = home;
            } else {
                teamStats[home].d++; teamStats[away].d++;
            }
            // Goal difference reflects actual goals scored in play, not penalties.
            teamStats[home].gf += homeScore; teamStats[home].ga += awayScore;
            teamStats[away].gf += awayScore; teamStats[away].ga += homeScore;

            // Single elimination, except a semifinal loser isn't out yet —
            // they still have the third-place match to play. Both teams in
            // that match are done afterward regardless of who wins it.
            if (stage === 'third_place') {
                teamStats[home].eliminated = true;
                teamStats[away].eliminated = true;
            } else if (stage !== 'semifinal' && loser) {
                teamStats[loser].eliminated = true;
            }

            const { date, venue } = extractDateVenue($, $t);
            matches.push({
                home, away, homeScore, awayScore, stage, stageLabel,
                penalties,
                date,
                venue,
                played: true
            });
        } else {
            // Not played yet. Only record it if the matchup is actually
            // determined (both sides are real entrants, not a "Winner of
            // Match N" placeholder) and Wikipedia has a scheduled date —
            // otherwise there's nothing useful to show.
            const { date, venue } = extractDateVenue($, $t);
            if (date && groupForTeam(home) && groupForTeam(away)) {
                matches.push({
                    home, away, homeScore: null, awayScore: null, stage, stageLabel,
                    penalties: null,
                    date,
                    venue,
                    played: false
                });
            }
        }
    });

    // Assign highest round reached to each team
    Object.entries(roundReached).forEach(([team, round]) => {
        if (!teamStats[team]) teamStats[team] = { w: 0, d: 0, l: 0, gf: 0, ga: 0, eliminated: false };
        // Determine if they won the final (champion) vs runner-up
        teamStats[team].round = round;
    });

    // Special case: final winner = champion
    const finalMatch = matches.find(m => m.stage === 'final');
    if (finalMatch) {
        const finalHome = finalMatch.penalties ? finalMatch.penalties.home : finalMatch.homeScore;
        const finalAway = finalMatch.penalties ? finalMatch.penalties.away : finalMatch.awayScore;
        const winner = finalHome > finalAway ? finalMatch.home : finalMatch.away;
        const loser  = finalHome > finalAway ? finalMatch.away : finalMatch.home;
        if (teamStats[winner]) teamStats[winner].round = 'champion';
        if (teamStats[loser])  teamStats[loser].round  = 'runner_up';
    }

    return { matches };
}

async function scrapeResults() {
    console.log('='.repeat(70));
    console.log('WORLD CUP 2026 RESULTS SCRAPER');
    console.log('='.repeat(70));

    let existingData;
    try {
        existingData = JSON.parse(fs.readFileSync('results.json', 'utf-8'));
    } catch {
        existingData = { teams: {}, matches: [], metadata: {} };
    }

    // --- Group Stage ---
    console.log('\n📡 Fetching group stage from Wikipedia…');
    let groupMatches = [];
    let teamStats = {};
    try {
        const html = await fetchHTML(GROUP_STAGE_URL);
        const parsed = parseGroupStage(html);
        groupMatches = parsed.matches;
        teamStats = parsed.teamStats;
        console.log(`   ✓ ${groupMatches.length} group stage matches found`);
    } catch (err) {
        console.error('   ✗ Group stage fetch failed:', err.message);
    }

    // --- Knockout Stage ---
    console.log('\n📡 Fetching knockout stage from Wikipedia…');
    let knockoutMatches = [];
    try {
        const html = await fetchHTML(KNOCKOUT_URL);
        const parsed = parseKnockoutStage(html, teamStats);
        knockoutMatches = parsed.matches;
        console.log(`   ✓ ${knockoutMatches.length} knockout matches found`);
    } catch (err) {
        console.warn('   ⚠ Knockout stage not available yet:', err.message);
    }

    const allMatches = [...groupMatches, ...knockoutMatches];
    const matchesPlayed = allMatches.filter(m => m.played).length;

    if (matchesPlayed === 0) {
        console.log('\n⚠  No match results found yet. Tournament may not have started.');
        return;
    }

    // Teams that never earn a `round` (never appear in a knockout match) are
    // either mid-group-stage or didn't qualify — we can't tell those apart
    // until the round of 32 bracket (32 qualifiers / 16 matches) is fully
    // played, at which point anyone still missing a `round` is confirmed to
    // not have qualified.
    const ROUND_OF_32_MATCH_COUNT = 16;
    const round32Played = allMatches.filter(m => m.stage === 'round_of_32' && m.played).length;
    if (round32Played >= ROUND_OF_32_MATCH_COUNT) {
        Object.values(teamStats).forEach(t => {
            if (!t.round) t.eliminated = true;
        });
    }

    // Print top 10 teams
    console.log('\nTOP 10 TEAMS BY POINTS');
    console.log('-'.repeat(50));
    const sorted = Object.entries(teamStats)
        .map(([name, s]) => ({ name, ...s, pts: s.w * 3 + s.d }))
        .sort((a, b) => b.pts - a.pts || b.w - a.w)
        .slice(0, 10);
    sorted.forEach((t, i) => {
        console.log(`  ${i+1}. ${t.name.padEnd(22)} W:${t.w} D:${t.d} L:${t.l} | ${t.pts} pts ${t.round ? `[${t.round}]` : ''}`);
    });

    const output = {
        teams: teamStats,
        matches: allMatches,
        metadata: {
            lastUpdated: new Date().toISOString(),
            matchesPlayed,
            stage: knockoutMatches.length > 0 ? 'knockout' : 'group',
            source: 'Wikipedia'
        }
    };

    // Sanity check: over the course of a tournament these numbers can only
    // hold steady or grow. A drop means Wikipedia changed its page markup
    // (this has happened at every stage transition — group stage tables
    // getting condensed, knockout rounds restructuring, etc.) and the
    // scraper silently parsed fewer matches than actually exist. Refuse to
    // clobber good data with a bad partial scrape.
    const prevMatchesPlayed = existingData.metadata?.matchesPlayed || 0;
    const prevTeamCount = Object.keys(existingData.teams || {}).length;
    const sumPoints = teams => Object.values(teams).reduce((s, t) => s + (t.w || 0) * 3 + (t.d || 0), 0);
    const prevPoints = sumPoints(existingData.teams || {});
    const newPoints = sumPoints(teamStats);
    const newTeamCount = Object.keys(teamStats).length;

    const problems = [];
    if (matchesPlayed < prevMatchesPlayed) {
        problems.push(`matches played dropped: ${prevMatchesPlayed} -> ${matchesPlayed}`);
    }
    if (newTeamCount < prevTeamCount) {
        problems.push(`team count dropped: ${prevTeamCount} -> ${newTeamCount}`);
    }
    if (newPoints < prevPoints) {
        problems.push(`total team points dropped: ${prevPoints} -> ${newPoints}`);
    }

    if (problems.length > 0) {
        console.error('\n❌ Sanity check failed — refusing to overwrite results.json:');
        problems.forEach(p => console.error(`   - ${p}`));
        console.error('   Wikipedia likely changed its page markup and the scraper is under-counting.');
        console.error('   Leaving the existing results.json in place.');
        process.exit(1);
    }

    fs.writeFileSync('results.json', JSON.stringify(output, null, 2));
    console.log(`\n✅ results.json updated — ${matchesPlayed} matches played`);
}

if (require.main === module) {
    scrapeResults().catch(err => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}

module.exports = { scrapeResults };
