// Schedule / results page for World Cup 2026

let resultsData = null;
let activeGroup = 'all';

async function init() {
    try {
        const res = await fetch(`results.json?t=${Date.now()}`);
        resultsData = await res.json();
        renderSchedule();
        updateLastUpdated();
    } catch (err) {
        document.getElementById('scheduleContent').innerHTML =
            `<div class="error">Error loading data: ${err.message}</div>`;
    }
}

document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', function() {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        activeGroup = this.dataset.group;
        renderSchedule();
    });
});

function renderSchedule() {
    const content = document.getElementById('scheduleContent');
    const matches = resultsData?.matches || [];

    if (matches.length === 0) {
        content.innerHTML = '<div class="empty-state">No match results yet. Tournament starts June 11!</div>';
        return;
    }

    let filtered = matches;
    if (activeGroup === 'knockout') {
        filtered = matches.filter(m => m.stage !== 'group');
    } else if (activeGroup !== 'all') {
        filtered = matches.filter(m => m.group === activeGroup);
    }

    if (filtered.length === 0) {
        content.innerHTML = '<div class="empty-state">No matches for this filter yet.</div>';
        return;
    }

    // Group by stage/date label
    const byStage = {};
    filtered.forEach(m => {
        const label = m.stageLabel || (m.stage === 'group' ? `Group ${m.group}` : formatStage(m.stage));
        if (!byStage[label]) byStage[label] = [];
        byStage[label].push(m);
    });

    let html = '';
    Object.entries(byStage).forEach(([label, ms]) => {
        html += `<div class="stage-section"><h2 class="stage-header">${label}</h2>`;
        ms.forEach(m => {
            const played = m.played;
            const homeWin = played && m.homeScore > m.awayScore;
            const awayWin = played && m.awayScore > m.homeScore;
            html += `
                <div class="match-card ${played ? 'played' : 'upcoming'}">
                    <div class="match-date">${m.date || ''}</div>
                    <div class="match-teams">
                        <span class="match-team ${homeWin ? 'winner' : ''}">${m.home}</span>
                        <span class="match-score">${played ? `${m.homeScore} – ${m.awayScore}` : 'vs'}</span>
                        <span class="match-team away ${awayWin ? 'winner' : ''}">${m.away}</span>
                    </div>
                    ${m.venue ? `<div class="match-venue">${m.venue}</div>` : ''}
                    ${m.note ? `<div class="match-note">${m.note}</div>` : ''}
                </div>
            `;
        });
        html += '</div>';
    });

    content.innerHTML = html;
}

function formatStage(stage) {
    const labels = {
        round_of_32: 'Round of 32',
        round_of_16: 'Round of 16',
        quarterfinal: 'Quarterfinal',
        semifinal: 'Semifinal',
        third_place: 'Third Place',
        final: 'Final'
    };
    return labels[stage] || stage;
}

function updateLastUpdated() {
    const lu = resultsData?.metadata?.lastUpdated;
    document.getElementById('lastUpdated').textContent = lu
        ? `Updated: ${new Date(lu).toLocaleString()}`
        : '';
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
