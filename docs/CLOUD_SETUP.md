# Cloud setup: Google sign-in + customer database

Tira works without this. Until it's set up, the app runs in **on-device mode**: no sign-in, and data stays on the phone.
After setup, customers sign in with Google, and their name, appointments, lists and settings are saved to your
database, so Tira remembers them on any phone.

You need two free accounts: **Supabase** (database + sign-in) and **Google Cloud** (the "Sign in with Google" client).
Allow about 20 minutes.

---

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign in.
2. **New project**. Name it `tira`, choose a database password (save it somewhere), and pick the region closest to your users.
3. When it's ready, open **Project Settings → API** and copy:
   - **Project URL**, like `https://abcdxyz.supabase.co`
   - **anon public** key (a long string starting with `eyJ…`)

## 2. Create the database tables

1. In Supabase, open **SQL Editor → New query**.
2. Paste the whole of [`supabase/schema.sql`](../supabase/schema.sql) and click **Run**.
3. Check **Table Editor**. You should see `profiles` (one row per customer) and `user_data` (each customer's appointments, lists and profile).

Row-level security is on, so each customer can only read and change their own rows.

## 3. Create the Google sign-in client

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a project called `Tira`.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - App name: **Tira**; add your support email and developer email
   - Scopes: add `openid`, `email` and `profile`. These are non-sensitive scopes, so no Google security review is needed.
   - Test users: add your own Gmail and your testers' while the app is in **Testing**
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application** (yes, web, even for the phone app; Supabase handles the redirect)
   - Name: `Tira (Supabase)`
   - **Authorized redirect URIs**: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
     (Supabase shows this exact URL in the next step)
4. Copy the **Client ID** and **Client secret**.

## 4. Turn on Google in Supabase

1. Supabase → **Authentication → Sign In / Providers → Google** → enable it.
2. Paste the Client ID and Client secret from step 3 → **Save**.
3. **Authentication → URL Configuration → Redirect URLs** → add each of these:

   | URL | Used by |
   |---|---|
   | `tira://auth/callback` | The installed app (APK / Play Store) |
   | `exp://**` | Expo Go during development |
   | `http://localhost:8081/**` | `npm run web` |

## 5. Put the keys in the app

In the project folder, copy the example file and fill in the values from step 1:

```bash
copy .env.example .env
```

```
EXPO_PUBLIC_SUPABASE_URL=https://abcdxyz.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

- `.env` is ignored by git, so the keys aren't pushed to GitHub. `.easignore` still uploads the file to EAS cloud builds, so APKs and Play Store builds get the keys.
- The anon key is meant to ship inside apps; row-level security protects the data. **Never** put the `service_role` key in the app.

Restart the dev server so it picks up the new values:

```bash
npx expo start --clear
```

For the installed app, build again:

```bash
npx eas-cli@latest build --platform android --profile preview
```

## 6. Check that it works

1. Open Tira → **Continue with Google** → pick your account.
2. Tira greets you by your first name.
3. Add something: "add milk to my Target list".
4. In Supabase → **Table Editor**:
   - `profiles` has a row with your name and email
   - `user_data` has a `shopping` row containing "milk"
5. Sign out, sign in on another phone, and your list is there.

### Where to see your customers

- **Authentication → Users**: everyone who has signed in, and when.
- **Table Editor → profiles**: name, email, photo and last time they opened Tira.

---

## How it works

```
Phone                                                Supabase
─────                                                ────────
"Continue with Google" ─► browser ─► Google ─► Supabase Auth ─► tira://auth/callback
                                                     │
Tira saves on the phone first (instant, offline) ────┤ upsert user_data (debounced 0.8s)
On sign-in: download the customer's rows ◄───────────┘ select user_data where user_id = me
First sign-in: guest data on the phone moves into the account
```

| Situation | What happens |
|---|---|
| No internet | Everything works; changes upload when the phone is back online (Settings shows "Offline"). |
| New phone | Signing in downloads the customer's data. |
| Two people share a phone | Each account has its own data; signing out removes the account's copy from the phone. |
| Guest who later signs in | Their guest data moves into the new account (only if that account has no data yet). |
| "Delete account" in Settings | Deletes the sign-in and all rows (`delete_my_account()` in the schema). |

## Before publishing to Google Play

With sign-in turned on, these Play Console answers change:

- **Data safety:** you now *collect* personal info (name, email address, user IDs) and app activity (appointments, lists) that is **stored on your servers**. It is encrypted in transit and not shared with third parties. Users can request deletion.
- **Account deletion:** apps with accounts must offer deletion in the app (done: Settings → Delete account) **and** through a web link. A simple page explaining "open Tira → Settings → Delete account, or email us at …" works for the link.
- **OAuth consent screen:** switch it from **Testing** to **In production** in Google Cloud, or only your listed test users can sign in.
