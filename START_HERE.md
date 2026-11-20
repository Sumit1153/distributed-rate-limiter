# Start here — Windows / VS Code (5 easy steps)

You have already installed **Docker Desktop** and **VS Code** for your previous project. **No extra npm packages are required.**

1. Download the project ZIP, right-click it, and choose **Extract All**.
2. In VS Code, choose **File → Open Folder** and open the extracted `distributed-rate-limiter` folder.
3. Open **Terminal → New Terminal**. Make sure Docker Desktop is open and shows **Engine running**.
4. Type this **one command** (only the command, not the `PS C:\...>` prompt):

   ```powershell
   docker compose up -d --build
   ```

5. In Chrome, type exactly `http://127.0.0.1:8080` in the address bar and press Enter. (Do not add `**`.)

**Try it:** Click **Send request burst**. With the defaults (5 requests per 10 seconds), some calls should return 200 and others 429. Select another algorithm and compare.

**Check tests:** Open a *new terminal* and run:

```powershell
node --version
npm test
node scripts/verify.js
```

**Stop Redis on purpose:**

```powershell
docker compose stop redis
node scripts/verify.js
```

The dashboard should show fallback mode. Recover with:

```powershell
docker compose start redis
node scripts/verify.js
```

**When finished:** `docker compose down`. Your project files remain saved.

**Next:** Publish this extracted folder to GitHub as `distributed-rate-limiter`, not the ZIP. Your project includes `.gitignore` and `.github/workflows/ci.yml`. Do not upload `.env` or private credentials.

Read [README.md](README.md) for details and [docs/VERIFICATION.md](docs/VERIFICATION.md) for real Redis evidence.
