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
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

function parseGroupStage(html) {
    const $ = cheerio.load(html);
    const matches = [];
    const teamStats = {};

    function ensureTeam(name) {
        if (!teamStats[name]) teamStats[name] = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
    }

    // The main tournament page also includes a knockout-stage summary further
    // down, using the same table markup as the group stage. Track section
    // headings in document order so only matches actually under a "Group X"
    // heading get counted here (mirrors the approach in parseKnockoutStage).
    let inGroupStage = false;
    const content = $('#mw-content-text .mw-parser-output').first();
    const root = content.length ? content : $.root();

    root.find('h2, h3, table.footballbox, table.vevent, table.fevent').each((_, el) => {
        const $el = $(el);
        const tag = el.tagName ? el.tagName.toLowerCase() : '';

        if (tag === 'h2' || tag === 'h3') {
            const headingText = ($el.find('.mw-headline').first().text() || $el.text()).trim();
            inGroupStage = /^Group\s+\w/i.test(headingText);
            return;
        }

        if (!inGroupStage) return;

        const $t = $el;
        const homeEl = $t.find('.fhome, [itemprop="homeTeam"] span, .home').first();
        const awayEl = $t.find('.faway, [itemprop="awayTeam"] span, .away').first();
        const scoreEl = $t.find('.fscore, [itemprop="name"].score, .score').first();

        let home = normalizeTeam(homeEl.text().trim());
        let away = normalizeTeam(awayEl.text().trim());
        const scoreText = scoreEl.text().trim();

        if (!home || !away || !scoreText) return;

        const scoreParts = scoreText.match(/(\d+)\s*[–\-:]\s*(\d+)/);
        if (!scoreParts) return; // match not yet played

        // Safety net: a genuine group match is always between two teams in
        // the same group. Skip anything that slips through mislabeled.
        const homeGroupCheck = groupForTeam(home);
        const awayGroupCheck = groupForTeam(away);
        if (homeGroupCheck && awayGroupCheck && homeGroupCheck !== awayGroupCheck) return;

        const homeScore = parseInt(scoreParts[1]);
        const awayScore = parseInt(scoreParts[2]);
        const dateEl = $t.find('.fdate, [itemprop="startDate"]').first();
        const venueEl = $t.find('.fground, [itemprop="location"]').first();

        const group = groupForTeam(home) || groupForTeam(away) || null;

        matches.push({
            home, away, homeScore, awayScore,
            stage: 'group',
            group,
            date: dateEl.attr('datetime') || dateEl.text().trim().slice(0, 10),
            venue: venueEl.text().trim(),
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

    // Map knockout table headings to round keys
    const stageMap = {
        'Round of 32':    'round_of_32',
        'Round of 16':    'round_of_16',
        'Quarter-final':  'quarterfinal',
        'Quarter-finals': 'quarterfinal',
        'Semi-final':     'semifinal',
        'Semi-finals':    'semifinal',
        'Third place':    'third_place',
        'Third-place':    'third_place',
        'Final':          'final',
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
            stage = 'knockout';
            stageLabel = headingText || 'Knockout Stage';
            for (const [key, val] of Object.entries(stageMap)) {
                if (headingText.includes(key)) { stage = val; stageLabel = headingText; break; }
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
                if (!teamStats[t]) teamStats[t] = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
                roundReached[t] = stage;
            });

            if (decidingHome > decidingAway) {
                teamStats[home].w++; teamStats[away].l++;
            } else if (decidingHome < decidingAway) {
                teamStats[away].w++; teamStats[home].l++;
            } else {
                teamStats[home].d++; teamStats[away].d++;
            }
            // Goal difference reflects actual goals scored in play, not penalties.
            teamStats[home].gf += homeScore; teamStats[home].ga += awayScore;
            teamStats[away].gf += awayScore; teamStats[away].ga += homeScore;

            const dateEl = $t.find('.fdate, [itemprop="startDate"]').first();
            const venueEl = $t.find('.fground, [itemprop="location"]').first();
            matches.push({
                home, away, homeScore, awayScore, stage, stageLabel,
                penalties,
                date: dateEl.attr('datetime') || dateEl.text().trim().slice(0, 10),
                venue: venueEl.text().trim(),
                played: true
            });
        }
    });

    // Assign highest round reached to each team
    Object.entries(roundReached).forEach(([team, round]) => {
        if (!teamStats[team]) teamStats[team] = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
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
