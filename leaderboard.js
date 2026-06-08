import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig, FIREBASE_COLLECTION, DRAFT_DEADLINE, TOTAL_MATCHES, MATCH_POINTS, ROUND_BONUS } from './config.js';
import { normalizeTeamName, createNormalizedLookup, calculateTeamPoints, calculateParticipantScore } from './utils.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let participants = [];
let resultsData = null;
let normalizedLookup = null;

function init() {
    // Hide draft link once deadline has passed
    const draftBanner = document.getElementById('draftLinkBanner');
    if (draftBanner && new Date() >= DRAFT_DEADLINE) {
        draftBanner.style.display = 'none';
    }

    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            document.getElementById(tabName + 'Tab').classList.add('active');
        });
    });

    loadData();
    setInterval(loadData, 60000);
}

async function loadData() {
    try {
        const snapshot = await getDocs(collection(db, FIREBASE_COLLECTION));
        participants = [];
        snapshot.forEach(doc => participants.push(doc.data()));

        const res = await fetch(`results.json?t=${Date.now()}`);
        resultsData = await res.json();

        normalizedLookup = createNormalizedLookup(resultsData.teams || {});

        renderParticipants();
        renderStandings();
        updateLastUpdated();
        updateProgress();
    } catch (err) {
        console.error('Load error:', err);
        document.getElementById('participantsContent').innerHTML =
            `<div class="error">Error loading data: ${err.message}</div>`;
    }
}

function renderParticipants() {
    const content = document.getElementById('participantsContent');
    content.classList.remove('loading');

    if (participants.length === 0) {
        content.innerHTML = '<div class="empty-state">No participants yet. Be the first to submit!</div>';
        return;
    }

    const isDraftOpen = new Date() < DRAFT_DEADLINE;

    const withScores = participants.map(p => {
        const { total, breakdown } = calculateParticipantScore(p.teams || [], normalizedLookup);
        return { ...p, score: total, breakdown };
    });

    withScores.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const timeA = a.timestamp?.seconds || 0;
        const timeB = b.timestamp?.seconds || 0;
        return timeA - timeB;
    });

    const matchesPlayed = resultsData?.metadata?.matchesPlayed || 0;
    const hasStarted = matchesPlayed > 0;

    let html = '';
    withScores.forEach((p, index) => {
        const rank = index + 1;
        const rankClass = rank <= 3 ? `rank-${rank}` : '';
        const medalEmoji = hasStarted ? (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '') : '';
        const nameLen = p.teamName?.length || 0;
        const nameLenClass = nameLen > 30 ? 'very-long-name' : nameLen > 20 ? 'long-name' : '';

        // Build per-team score rows for expanded view
        const teamRows = (p.teams || []).map(name => {
            const key = normalizeTeamName(name);
            const team = normalizedLookup[key];
            const pts = team ? calculateTeamPoints(team) : 0;
            const w = team?.w || 0;
            const d = team?.d || 0;
            const l = team?.l || 0;
            const round = team?.round ? `<span class="round-badge">${formatRound(team.round)}</span>` : '';
            return `
                <tr class="${pts > 0 ? 'has-points' : 'no-points'}">
                    <td class="team-name-cell">${name} ${round}</td>
                    <td class="record-cell">${w}W ${d}D ${l}L</td>
                    <td class="points-cell ${pts > 0 ? 'has-pts' : ''}">${pts}</td>
                </tr>
            `;
        }).join('');

        html += `
            <div class="participant-card ${rankClass}">
                <div class="card-header">
                    <div class="card-rank ${rankClass}">${rank}</div>
                    <div class="card-info">
                        <div class="team-name-display ${nameLenClass}">
                            ${medalEmoji ? `<span class="medal-emoji">${medalEmoji}</span>` : ''}
                            <span>${p.teamName || 'Unnamed'}</span>
                        </div>
                        <div class="participant-name">${p.name || ''}</div>
                    </div>
                    <div class="card-score">${p.score}</div>
                </div>
                <div class="teams-summary">${(p.teams || []).map(name => {
                    const key = normalizeTeamName(name);
                    const team = normalizedLookup[key];
                    const pts = team ? calculateTeamPoints(team) : 0;
                    return `${name} (${pts})`;
                }).join(' • ')}</div>
                ${!isDraftOpen ? `
                <button class="expand-btn" data-idx="${index}">
                    <span class="expand-text">View Details</span>
                    <span class="expand-icon">▼</span>
                </button>
                <div class="team-breakdown" data-idx="${index}" style="display:none;">
                    <div class="breakdown-header">Team Performance</div>
                    <table class="breakdown-table">
                        <thead><tr><th>Team</th><th>Record</th><th>Pts</th></tr></thead>
                        <tbody>${teamRows}</tbody>
                    </table>
                </div>` : ''}
            </div>
        `;
    });

    content.innerHTML = html;

    document.querySelectorAll('.expand-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const idx = this.dataset.idx;
            const breakdown = document.querySelector(`.team-breakdown[data-idx="${idx}"]`);
            const icon = this.querySelector('.expand-icon');
            const text = this.querySelector('.expand-text');
            const isOpen = breakdown.style.display !== 'none';
            breakdown.style.display = isOpen ? 'none' : 'block';
            icon.textContent = isOpen ? '▼' : '▲';
            text.textContent = isOpen ? 'View Details' : 'Hide Details';
            this.classList.toggle('expanded', !isOpen);
        });
    });
}

function renderStandings() {
    const content = document.getElementById('standingsContent');
    content.classList.remove('loading');

    const teams = Object.entries(resultsData?.teams || {});
    if (teams.length === 0) {
        content.innerHTML = '<div class="empty-state">No results yet. Tournament starts June 11!</div>';
        return;
    }

    const sorted = teams.map(([name, data]) => ({
        name, ...data, pts: calculateTeamPoints(data)
    })).sort((a, b) => b.pts - a.pts || b.w - a.w || (b.gf - b.ga) - (a.gf - a.ga));

    let html = `
        <div class="standings-wrapper">
            <table class="standings-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Team</th>
                        <th>W</th><th>D</th><th>L</th>
                        <th>GF</th><th>GA</th>
                        <th>Pts</th>
                    </tr>
                </thead>
                <tbody>
    `;

    sorted.forEach((t, i) => {
        const rankClass = i < 3 ? `rank-${i + 1}` : '';
        html += `
            <tr class="standings-row ${rankClass}">
                <td class="rank-cell ${rankClass}">${i + 1}</td>
                <td class="team-cell">${t.name} ${t.round ? `<span class="round-badge">${formatRound(t.round)}</span>` : ''}</td>
                <td>${t.w || 0}</td>
                <td>${t.d || 0}</td>
                <td>${t.l || 0}</td>
                <td>${t.gf || 0}</td>
                <td>${t.ga || 0}</td>
                <td class="pts-cell">${t.pts}</td>
            </tr>
        `;
    });

    html += '</tbody></table></div>';
    content.innerHTML = html;
}

function formatRound(round) {
    const labels = {
        round_of_32: 'R32',
        round_of_16: 'R16',
        quarterfinal: 'QF',
        semifinal: 'SF',
        third_place: '3rd',
        runner_up: 'Final',
        champion: 'Champion'
    };
    return labels[round] || round;
}

function updateLastUpdated() {
    const lu = resultsData?.metadata?.lastUpdated;
    document.getElementById('lastUpdated').textContent = lu
        ? `Updated: ${new Date(lu).toLocaleString()}`
        : '';
}

function updateProgress() {
    const played = resultsData?.metadata?.matchesPlayed || 0;
    const pct = Math.min((played / TOTAL_MATCHES) * 100, 100);
    const el = document.getElementById('progressStats');
    if (el) el.textContent = `${played} / ${TOTAL_MATCHES} matches played (${pct.toFixed(1)}%)`;
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
