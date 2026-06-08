// Draft form logic for World Cup 2026 Fantasy
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';
import { firebaseConfig, FIREBASE_COLLECTION, DRAFT_DEADLINE, REDIRECT_TIME, MAX_TEAMS, MIN_TEAMS, MAX_BUDGET } from './config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let allTeams = [];
let selectedTeams = new Set();
let sortMode = 'name';

async function init() {
    const now = new Date();

    if (now >= REDIRECT_TIME) {
        window.location.href = 'index.html';
        return;
    }

    if (now >= DRAFT_DEADLINE) {
        showDraftClosed();
        return;
    }

    startCountdown();

    const response = await fetch('teams.json');
    allTeams = await response.json();

    renderTeamGrid();
    setupEventListeners();
}

function showDraftClosed() {
    document.getElementById('draftClosedBanner').style.display = 'block';
    document.getElementById('draftForm').style.display = 'none';
    document.getElementById('countdownTimer').style.display = 'none';

    // Auto-redirect after 5 seconds
    setTimeout(() => { window.location.href = 'index.html'; }, 5000);
}

function startCountdown() {
    function update() {
        const now = new Date();
        const diff = DRAFT_DEADLINE - now;
        if (diff <= 0) { showDraftClosed(); return; }
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        document.getElementById('days').textContent = String(d).padStart(2, '0');
        document.getElementById('hours').textContent = String(h).padStart(2, '0');
        document.getElementById('minutes').textContent = String(m).padStart(2, '0');
        document.getElementById('seconds').textContent = String(s).padStart(2, '0');
    }
    update();
    setInterval(update, 1000);
}

function renderTeamGrid() {
    const search = (document.getElementById('searchInput')?.value || '').toLowerCase();
    let filtered = allTeams.filter(t => t.name.toLowerCase().includes(search));

    if (sortMode === 'priceHigh') filtered.sort((a, b) => b.price - a.price);
    else if (sortMode === 'priceLow') filtered.sort((a, b) => a.price - b.price);
    else filtered.sort((a, b) => a.name.localeCompare(b.name));

    const grid = document.getElementById('teamGrid');
    grid.innerHTML = filtered.map(team => {
        const selected = selectedTeams.has(team.name);
        const spent = getSpent();
        const canAfford = spent + team.price <= MAX_BUDGET;
        const disabled = !selected && (!canAfford || selectedTeams.size >= MAX_TEAMS);
        return `
            <div class="team-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}"
                 data-name="${team.name}" data-price="${team.price}">
                <div class="team-name">${team.name}</div>
                <div class="team-meta">Group ${team.group}</div>
                <div class="team-price">${team.price} pts</div>
                ${selected ? '<div class="selected-check">✓</div>' : ''}
            </div>
        `;
    }).join('');

    grid.querySelectorAll('.team-card:not(.disabled)').forEach(card => {
        card.addEventListener('click', () => toggleTeam(card.dataset.name, parseInt(card.dataset.price)));
    });
}

function toggleTeam(name, price) {
    if (selectedTeams.has(name)) {
        selectedTeams.delete(name);
    } else {
        if (selectedTeams.size >= MAX_TEAMS) return;
        if (getSpent() + price > MAX_BUDGET) return;
        selectedTeams.add(name);
    }
    updateStatus();
    renderTeamGrid();
    renderSelected();
}

function getSpent() {
    return allTeams.filter(t => selectedTeams.has(t.name)).reduce((sum, t) => sum + t.price, 0);
}

function updateStatus() {
    const spent = getSpent();
    const remaining = MAX_BUDGET - spent;
    const count = selectedTeams.size;
    document.getElementById('pointsSpent').textContent = spent;
    document.getElementById('pointsRemaining').textContent = remaining;
    document.getElementById('teamsCount').textContent = count;

    const fill = document.getElementById('progressFill');
    const pct = (spent / MAX_BUDGET) * 100;
    fill.style.width = pct + '%';
    fill.textContent = `${spent} / ${MAX_BUDGET}`;
    fill.className = 'progress-bar-fill' + (pct > 90 ? ' danger' : pct > 70 ? ' warning' : '');

    const valid = count >= MIN_TEAMS && count <= MAX_TEAMS;
    document.getElementById('submitBtn').className = valid ? 'btn-submit' : 'btn-disabled';
    document.getElementById('clearAllBtn').disabled = count === 0;
    document.getElementById('warningMessage').style.display = valid ? 'none' : 'block';
}

function renderSelected() {
    const container = document.getElementById('selectedTeams');
    if (selectedTeams.size === 0) {
        container.innerHTML = '<div class="empty-selection">No teams selected yet</div>';
        container.className = 'selected-teams empty';
        return;
    }
    container.className = 'selected-teams';
    const teamList = allTeams.filter(t => selectedTeams.has(t.name));
    container.innerHTML = teamList.map(t => `
        <div class="selected-tag">
            <span>${t.name} (${t.price})</span>
            <button type="button" class="remove-tag" data-name="${t.name}">×</button>
        </div>
    `).join('');

    container.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedTeams.delete(btn.dataset.name);
            updateStatus();
            renderTeamGrid();
            renderSelected();
        });
    });
}

function setupEventListeners() {
    document.getElementById('searchInput').addEventListener('input', renderTeamGrid);

    document.querySelectorAll('input[name="sort"]').forEach(radio => {
        radio.addEventListener('change', e => { sortMode = e.target.value; renderTeamGrid(); });
    });

    document.getElementById('clearAllBtn').addEventListener('click', () => {
        selectedTeams.clear();
        updateStatus();
        renderTeamGrid();
        renderSelected();
    });

    document.getElementById('generateNameBtn').addEventListener('click', () => {
        const names = [
            // Classic style
            'Flying Eagles', 'Golden Lions', 'Mighty Wolves', 'Electric Thunder', 'Blazing Sharks',
            'Fearless Dragons', 'Legendary Warriors', 'Unstoppable Titans', 'Epic Rockets', 'Stellar Vipers',
            // Soccer puns
            'Messi Around', 'Ronaldo Coaster', 'Kickin\' It Old School', 'The Own Goalers',
            'Penalty of the Century', 'Offsides Again', 'Yellow Card Collectors',
            'VAR We There Yet', 'Net Gains Only', 'Goooooal Diggers',
            'The Hand of Gob', 'Pitch Please', 'In It to Win It (Hopefully)',
            'Red Card Redemption', 'Park the Bus FC', 'Total Foxtal',
            'Throw In the Towel', 'Not in My Box', 'Extra Time Enjoyers',
            'Bend It Like Beckham\'s Accountant', 'The Nil-Nil Thrillers',
            'Keeper of the Dream', 'Ball Possession Issues', 'Studs Up FC',
            'No Goalkeeper No Problem', 'The Stoppage Time Heroes',
            'Bicycle Kick Fantasies', 'Corner Flag Celebrators',
            'We Thought It Was Wide', 'Pub League All-Stars',
            'Shin Guards Not Included', 'The Diving Champions',
        ];
        document.getElementById('teamName').value = names[Math.floor(Math.random() * names.length)];
    });

    document.getElementById('draftForm').addEventListener('submit', handleSubmit);

    document.getElementById('cancelConfirm').addEventListener('click', () => {
        document.getElementById('confirmationOverlay').style.display = 'none';
    });

    document.getElementById('confirmSubmit').addEventListener('click', submitDraft);
}

function handleSubmit(e) {
    e.preventDefault();
    const errors = [];
    const name = document.getElementById('name').value.trim();
    const teamName = document.getElementById('teamName').value.trim();
    if (!name) errors.push('Your name is required');
    if (!teamName) errors.push('Team name is required');
    if (selectedTeams.size < MIN_TEAMS) errors.push(`Select at least ${MIN_TEAMS} teams`);
    if (selectedTeams.size > MAX_TEAMS) errors.push(`Select at most ${MAX_TEAMS} teams`);

    if (errors.length > 0) {
        const errDiv = document.getElementById('validationError');
        document.getElementById('validationErrorList').innerHTML = errors.map(e => `<li>${e}</li>`).join('');
        errDiv.style.display = 'flex';
        errDiv.scrollIntoView({ behavior: 'smooth' });
        return;
    }

    document.getElementById('validationError').style.display = 'none';

    // Show confirmation dialog
    document.getElementById('confirmTeamName').textContent = teamName;
    document.getElementById('confirmTotalPoints').textContent = getSpent();
    const teamList = allTeams.filter(t => selectedTeams.has(t.name));
    document.getElementById('confirmTeamList').innerHTML = teamList
        .map(t => `<div class="confirm-team">⚽ ${t.name} <span class="confirm-price">${t.price} pts</span></div>`)
        .join('');
    document.getElementById('confirmationOverlay').style.display = 'flex';
}

async function submitDraft() {
    document.getElementById('confirmationOverlay').style.display = 'none';
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.textContent = 'Submitting...';
    submitBtn.disabled = true;

    try {
        const name = document.getElementById('name').value.trim();
        const teamName = document.getElementById('teamName').value.trim();
        await addDoc(collection(db, FIREBASE_COLLECTION), {
            name,
            teamName,
            teams: Array.from(selectedTeams),
            totalSpent: getSpent(),
            timestamp: serverTimestamp()
        });

        document.getElementById('successTeamName').textContent = teamName;
        document.getElementById('successMessage').style.display = 'block';
        document.getElementById('draftForm').style.display = 'none';
        document.getElementById('countdownTimer').style.display = 'none';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        console.error('Submit error:', err);
        alert('Submission failed. Please try again.');
        submitBtn.textContent = 'Submit Draft';
        submitBtn.disabled = false;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
