// Shared configuration for World Cup 2026 Fantasy Draft

export const firebaseConfig = {
    apiKey: "AIzaSyCtj1xbEbFkBbE2KSW7EudwItJjf2-HqN8",
    authDomain: "fantasy-olympics-cb09d.firebaseapp.com",
    projectId: "fantasy-olympics-cb09d",
    storageBucket: "fantasy-olympics-cb09d.firebasestorage.app",
    messagingSenderId: "757292812325",
    appId: "1:757292812325:web:1dc9d1e98f2fc3599017cc"
};

export const FIREBASE_COLLECTION = 'worldcup2026';

// Draft deadline: June 11, 2026 at 3:00 PM Central (first match kickoff is 5 PM CT)
export const DRAFT_DEADLINE = new Date('2026-06-11T20:00:00Z'); // 3 PM CDT = 20:00 UTC

// After deadline, draft.html redirects to leaderboard
export const REDIRECT_TIME = new Date('2026-06-12T02:00:00Z');

// Draft constraints
export const MAX_TEAMS = 15;
export const MIN_TEAMS = 5;
export const MAX_BUDGET = 100;

// Scoring
export const MATCH_POINTS = { win: 3, draw: 1, loss: 0 };

// Round advancement bonus points
export const ROUND_BONUS = {
    'round_of_32':    2,
    'round_of_16':    3,
    'quarterfinal':   5,
    'semifinal':      8,
    'third_place':    9,
    'runner_up':     10,
    'champion':      15
};

// Total matches in the tournament: 104
export const TOTAL_MATCHES = 104;
