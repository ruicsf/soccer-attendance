# ⚽ Team Attendance

A simple page for tracking who's coming to each week's game. Anyone with the link can:

- add, rename, and remove players
- add, edit, and delete games (date, time, opponent/field)
- mark each player as **Attending**, **Maybe**, or **Not attending**

Changes are saved to Firebase and show up live for everyone.

## One-time setup

### 1. Create a Firebase project
1. Go to <https://console.firebase.google.com> and click **Add project** (Google Analytics can be turned off).
2. In the left menu, open **Build → Firestore Database** and click **Create database**. Pick a location near you and choose **production mode**.

### 2. Set the database rules
1. In Firestore, open the **Rules** tab.
2. Replace everything there with the contents of [`firestore.rules`](firestore.rules) and click **Publish**.

### 3. Connect the app to Firebase
1. Click the ⚙️ gear next to **Project Overview**, then **Project settings**.
2. Under **Your apps**, click the web icon **`</>`**, give it any nickname, and click **Register app**. You don't need Firebase Hosting.
3. Firebase shows a `firebaseConfig = { ... }` block. Copy those values into [`firebase-config.js`](firebase-config.js). You can edit that file right on GitHub with the pencil icon.

### 4. Turn on GitHub Pages
1. In this repo on GitHub, go to **Settings → Pages**.
2. Under **Source**, choose **Deploy from a branch**, select `main` and `/ (root)`, and click **Save**.
3. After a minute or so, the site is live at `https://<your-username>.github.io/soccer-attendance/`. Share that link with the team.

## Notes

- The Firebase `apiKey` is meant to be public in web apps, so committing it is fine. Access is controlled by the rules in step 2.
- Those rules let anyone who has the link edit anything. Share it only with the team.
- Files: `index.html` (the page), `app.js` (the logic), `style.css`, and `firebase-config.js`. There's no build step.
