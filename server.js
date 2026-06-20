// Static file server for the Momentum app.
//
// All data and auth now live in Firebase (Firestore + Firebase Auth) and are
// accessed directly from the browser — there is no longer a backend API or
// local database here. This server only serves the static files in /public,
// both locally (`npm start`) and on Vercel.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

// Serve the app shell for any unmatched route (deep links / refreshes).
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Momentum Goal Tracker (Firebase)`);
    console.log(`  Running at: http://localhost:${PORT}\n`);
  });
}

module.exports = app;
