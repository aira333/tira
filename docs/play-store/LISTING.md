# Google Play listing: Tira

Everything to paste into Play Console, in the order the console asks for it.
Developer account: **UsTechBridge** · Package: **`com.ustechbridge.tira`** · Contact: **ustechbridge@gmail.com**

Public pages (live once GitHub Pages is on, see the README):
- Privacy policy: `https://aira333.github.io/tira/privacy/`
- Account deletion: `https://aira333.github.io/tira/delete-account/`

---

## 1. Create app

| Field | Value |
|---|---|
| App name | `Tira: Voice Day Assistant` |
| Default language | English (United States) |
| App or game | App |
| Free or paid | Free |

## 2. Main store listing (Grow → Store presence → Main store listing)

**App name** (max 30):
```
Tira: Voice Day Assistant
```

**Short description** (max 80):
```
Talk to manage appointments, reminders, shopping lists, to-dos and rides.
```

**Full description** (max 4000):
```
Tira is a friendly voice assistant for your day. Just say "Tira" and ask, in your own words.

Built for people who'd rather talk than tap, including people with low vision, Tira reads every answer aloud, uses large high-contrast text, and works with your phone's screen reader.

WHAT YOU CAN SAY
• "Tira, add an appointment with Dr. Patel tomorrow at 2 PM"
• "What's my day?": hear today's appointments, to-dos and shopping in one sentence
• "What's next?": your next appointment
• "Add milk and eggs to my Costco shopping list"
• "What's on my errands to-do list?"
• "Request a ride to my appointment"
• "Repeat that", "Help", "Cancel"

APPOINTMENTS & REMINDERS
Add, find, reschedule and delete appointments by voice. Choose a reminder 15 minutes, 1 hour or 1 day before, and Tira sends a notification.

SHOPPING & TO-DO LISTS
Keep a list for every store and every project. Check items off by voice, or with a tap on the My Day screen.

RIDES
Save your transport service once. When you need a ride, Tira confirms the details, opens your phone's dialer, and tells you exactly what to say.

HANDS-FREE
Turn on hands-free mode and start any request with "Tira" while the app is open. When Tira asks a question, just answer. No need to say "Tira" again.

YOUR ACCOUNT, YOUR CHOICE
Sign in with Google so Tira remembers your name, appointments and lists on any phone, or continue without an account and keep everything on this phone only. Delete your account and data anytime from Settings.

PRIVATE BY DESIGN
No ads. No tracking. We never sell your data.
```

**Graphics** (all in `docs/play-store/`):

| Asset | File |
|---|---|
| App icon (512×512) | `icon-512.png` |
| Feature graphic (1024×500) | `feature-graphic.png` |
| Phone screenshots (1080×1920, upload 2–8) | `phone-1.png` … `phone-6.png` |

**Category:** Productivity · **Tags:** Personal assistant, Productivity, Calendar
**Contact email:** ustechbridge@gmail.com · **Website:** `https://aira333.github.io/tira/privacy/` (optional)

## 3. App content (Policy → App content)

| Section | Answer |
|---|---|
| Privacy policy | `https://aira333.github.io/tira/privacy/` |
| Ads | **No**, the app doesn't contain ads |
| App access | **All or some functionality is restricted** → add instructions: *"Sign-in is optional. On the first screen tap 'Continue without an account' to use every feature. To test Google sign-in, use any Google account."* |
| Content rating | Fill in the questionnaire: category **Utility, Productivity, Communication or Other**; answer **No** to violence, sexual content, drugs, gambling, profanity, user-to-user chat, and sharing location. Expected result: **Everyone / PEGI 3**. |
| Target audience | **18 and over** (keeps the app out of the Families program) |
| News app | No |
| Government app | No |
| Financial features | None |
| Health apps | If asked, say Tira helps people **manage and get reminded about medical appointments**. It does not diagnose, treat or give medical advice, and doesn't connect to medical devices. |
| Data safety | See section 4 |
| Account deletion | **Yes**, users can create an account → deletion URL `https://aira333.github.io/tira/delete-account/` |

## 4. Data safety form

**Does your app collect or share any of the required user data types?** Yes
**Is all user data encrypted in transit?** Yes
**Do you provide a way for users to request that their data is deleted?** Yes

| Data type | Collected | Shared | Optional? | Purpose |
|---|---|---|---|---|
| Personal info → **Name** | Yes | No | Optional (only with sign-in) | App functionality, Account management |
| Personal info → **Email address** | Yes | No | Optional (only with sign-in) | Account management |
| Personal info → **User IDs** | Yes | No | Optional (only with sign-in) | Account management |
| Personal info → **Phone number** (ride service / callback number) | Yes | No | Optional | App functionality |
| Health and fitness → **Health info** (doctor appointments) | Yes | No | Optional | App functionality |
| App activity → **Other user-generated content** (lists, to-dos) | Yes | No | Optional | App functionality |
| Audio → **Voice or sound recordings** | Yes, **processed ephemerally** (not stored) | No | Optional (you can type instead) | App functionality |

Notes for the form:
- "Collected" here means it leaves the phone when the user signs in (stored in Supabase). Guests' data never leaves the phone. Google asks you to declare the signed-in case.
- Voice is turned into text by the phone's speech recognition service while the user talks; Tira never stores audio.
- Not shared with third parties; Supabase and Google act as service providers, which is not "sharing" under Play's definition.

## 5. Release (Test and release → Production)

1. Build: `npx eas-cli@latest build --platform android --profile production`
2. Download the `.aab` from the EAS link.
3. **Production → Create new release** → upload the `.aab`.
4. Release name: `1.0.0 (1)` · Release notes:
   ```
   First release of Tira: talk to manage appointments, reminders, shopping lists, to-dos and rides.
   ```
5. **Countries / regions:** add United States (or your list).
6. **Review release → Start rollout to Production** → it goes to Google review (usually 1–7 days for a new app).

> If Play Console shows **"Production access: apply"** instead of letting you create a production release, the UsTechBridge account is a personal account made after Nov 2023. Run a **Closed testing** release with at least 12 testers for 14 days first, then apply.
