// Firebase initialization + auth guard (compat SDK — exposes the global
// `firebase`, so this and the page inline scripts stay classic, non-module
// scripts). Load order on every page:
//   firebase-app-compat.js → firebase-auth-compat.js → firebase-firestore-compat.js
//   → js/firebase.js → js/api.js → page script
//
// Pages defer their initial data load until `authReady` resolves, e.g.
//   authReady.then(loadDashboard).catch(console.error);

const firebaseConfig = {
  apiKey: "AIzaSyA_xgQKpDMlKpdNYOcZutv4GxENnvuztMk",
  authDomain: "goal-tracker-1263b.firebaseapp.com",
  projectId: "goal-tracker-1263b",
  storageBucket: "goal-tracker-1263b.firebasestorage.app",
  messagingSenderId: "93084775928",
  appId: "1:93084775928:web:176dd08185f81765ea120d",
  measurementId: "G-FHJ4DQ39BJ"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

const _isLoginPage = window.location.pathname.endsWith('/login.html');

// Resolves with the signed-in user. On a protected page with no user it
// redirects to the login screen (and never resolves, halting page setup). On
// the login page with a user already signed in it bounces to the dashboard.
window.authReady = new Promise((resolve) => {
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      if (!_isLoginPage) window.location.replace('/login.html');
      return;
    }
    if (_isLoginPage) { window.location.replace('/index.html'); return; }

    window.currentUid = user.uid;
    try {
      if (typeof seedIfEmpty === 'function') await seedIfEmpty();
    } catch (e) {
      console.error('Seed failed:', e);
    }

    const label = user.email || 'User';
    document.querySelectorAll('[data-user-email]').forEach(el => { el.textContent = label; });
    document.querySelectorAll('[data-user-initial]').forEach(el => { el.textContent = label[0].toUpperCase(); });
    document.querySelectorAll('[data-logout]').forEach(el => {
      el.onclick = () => auth.signOut().then(() => window.location.replace('/login.html'));
    });

    resolve(user);
  });
});
