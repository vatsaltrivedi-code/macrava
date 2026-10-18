# Turning on login (Supabase + Google)

About 15 minutes. Everything here is free.

## 1. Create the Supabase project

1. Sign in at supabase.com, then click **New project**.
2. Fill in:
   - Name: `macro-planner`
   - Database password: generate one and save it somewhere safe. The app never uses it.
   - Region: **South Asia (Mumbai)**
3. Wait for the project to finish setting up (about 2 minutes).
4. Open **SQL Editor**, then **New query**. Paste in all of `supabase/schema.sql` and click **Run**. You should see "Success. No rows returned".

## 2. Create the Google login client

1. Go to console.cloud.google.com and create a project (e.g. `macro-planner`).
2. Open **Google Auth Platform**. Under **Branding**, fill in the app name `Macro Budget Planner` and your email as the support email. Set **Audience** to **External**.
3. Under **Data Access**, check that these scopes are there: `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. Add `openid` by hand if it's missing.
4. Under **Clients**, click **Create client** and choose **Web application**.
5. Fill in:
   - **Authorized JavaScript origins:** your app's address, e.g. `https://macro-budget.pages.dev`
   - **Authorized redirect URIs:** the callback URL shown in Supabase under **Authentication → Sign In / Providers → Google**. It looks like `https://<your-ref>.supabase.co/auth/v1/callback`.
6. Copy the **Client ID** and **Client secret**.
7. While **Audience** is in *Testing* mode, only the test users you list there can sign in (up to 100). Add your testers' Gmail addresses there, or click **Publish app**.

## 3. Turn on Google in Supabase

1. Go to **Authentication → Sign In / Providers → Google**. Turn it on, paste in the Client ID and Client secret, and click **Save**.
2. Go to **Authentication → URL Configuration**:
   - **Site URL:** your app's address, e.g. `https://macro-budget.pages.dev`
   - **Redirect URLs:** add the address followed by `/**`, e.g. `https://macro-budget.pages.dev/**` (covers every page of the app).

## 4. Send Claude two values

From **Project Settings → API Keys**, send:

- **Project URL** (e.g. `https://abcd1234.supabase.co`)
- **Publishable key** (starts with `sb_publishable_`, or the legacy **anon** key)

Both are designed to be public and safe to put in the app.

⚠️ **Never send or commit the `service_role` / secret key.** It bypasses all the security rules.

## Email + password login

The app's "Continue with email" uses an email and a password. In Supabase, go to **Authentication → Sign In / Providers → Email** and:

- keep **Email** turned on
- turn **Confirm email** off (the built-in sender can't reach testers, so a confirmation email would never arrive)
- set **Minimum password length** to 8

Trade-offs while there's no email sender:

- No "forgot password" emails. People can use Google instead, or email you.
- Emails aren't verified, so someone could sign up with an address that isn't theirs. Add a custom SMTP sender (Resend plus your own domain, about ₹100–900 a year) and turn **Confirm email** back on before a wide launch.
